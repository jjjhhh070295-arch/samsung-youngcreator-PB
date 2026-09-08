/**
 * IPS 승인 후 보유종목 동기화 — 멱등·재시도 가능.
 * 브로커 주문 없음. source = "IPS 확정 기준".
 * 시세 스냅샷 기반 수량만 반영하며, 부분 성공으로 완료 표시하지 않는다.
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";
import { loadManualPortfolioDraft } from "../manualPortfolioDraft";
import {
  buildIpsPurchasePlan,
  weightedAveragePrice,
  type PriceSnapshot,
  type PurchasePlanLine,
} from "./ipsPurchasePlan";
import { canonicalHoldingTicker, symbolsEquivalent } from "../pricing/instrumentIdentity";
import { updateClient, getClient } from "@/lib/store";

export type IpsHoldingsSyncStatus = "idle" | "pending" | "applied" | "failed";

export interface IpsHoldingLot {
  id: string;
  clientId: string;
  ipsHash: string;
  symbol: string;
  exchange: string;
  currency: string;
  assetClass: string;
  quantity: number;
  costLocal: number;
  costKrw: number;
  designatedPrice: number;
  snapshotPrice: number;
  fxRate: number;
  appliedAt: string;
  source: "IPS 확정 기준";
  priceSnapshot?: PriceSnapshot;
}

export interface IpsHoldingsSyncState {
  clientId: string;
  ipsHash: string;
  status: IpsHoldingsSyncStatus;
  appliedAt?: string;
  error?: string;
  lotIds: string[];
  linesApplied: number;
  snapshots?: PriceSnapshot[];
}

const SYNC_LS = "pb-ips-holdings-sync-v1";
const LOTS_LS = "pb-ips-holding-lots-v1";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function getIpsHoldingsSyncState(clientId: string, ipsHash: string): IpsHoldingsSyncState | null {
  const all = readJson<Record<string, IpsHoldingsSyncState>>(SYNC_LS, {});
  return all[`${clientId}:${ipsHash}`] ?? null;
}

function setIpsHoldingsSyncState(state: IpsHoldingsSyncState): void {
  const all = readJson<Record<string, IpsHoldingsSyncState>>(SYNC_LS, {});
  all[`${state.clientId}:${state.ipsHash}`] = state;
  writeJson(SYNC_LS, all);
}

function appendLots(lots: IpsHoldingLot[]): void {
  const all = readJson<IpsHoldingLot[]>(LOTS_LS, []);
  writeJson(LOTS_LS, [...all, ...lots]);
}

export function listIpsHoldingLots(clientId: string): IpsHoldingLot[] {
  return readJson<IpsHoldingLot[]>(LOTS_LS, []).filter((l) => l.clientId === clientId);
}

async function persistAppToClient(clientId: string, state: IpsHoldingsSyncState): Promise<void> {
  try {
    await updateClient(clientId, {
      ipsPurchaseApps: {
        [state.ipsHash]: {
          status: state.status === "idle" ? "pending" : state.status,
          appliedAt: state.appliedAt,
          error: state.error,
          linesApplied: state.linesApplied,
          snapshots: state.snapshots,
        },
      },
    });
  } catch (e) {
    console.warn("[ipsHoldingsSync] stages 멱등 기록 저장 실패 — LS만 유지:", e);
  }
}

async function loadDurableState(
  clientId: string,
  ipsHash: string,
): Promise<IpsHoldingsSyncState | null> {
  const local = getIpsHoldingsSyncState(clientId, ipsHash);
  if (local?.status === "applied") return local;
  try {
    const client = await getClient(clientId);
    const remote = client?.ipsPurchaseApps?.[ipsHash];
    if (remote?.status === "applied") {
      const state: IpsHoldingsSyncState = {
        clientId,
        ipsHash,
        status: "applied",
        appliedAt: remote.appliedAt,
        lotIds: [],
        linesApplied: remote.linesApplied ?? 0,
        snapshots: remote.snapshots,
      };
      setIpsHoldingsSyncState(state);
      return state;
    }
  } catch {
    /* ignore */
  }
  return local;
}

interface ExistingHoldingRow {
  id: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
  source?: string | null;
}

async function loadExistingHoldings(clientId: string): Promise<ExistingHoldingRow[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("client_holdings")
      .select("id, name, ticker, market, currency, quantity, avg_price, source")
      .eq("client_id", clientId);
    if (!error && data) {
      return data.map((r: any) => ({
        id: String(r.id),
        name: r.name,
        ticker: r.ticker ?? null,
        market: r.market ?? null,
        currency: r.currency ?? "KRW",
        quantity: Number(r.quantity ?? 0),
        avg_price: r.avg_price == null ? null : Number(r.avg_price),
        source: r.source ?? null,
      }));
    }
  }
  return [];
}

function matchExisting(
  rows: ExistingHoldingRow[],
  line: PurchasePlanLine,
): ExistingHoldingRow | undefined {
  return rows.find((r) => {
    const cur = (r.currency || "KRW").toUpperCase();
    if (cur !== line.currency.toUpperCase()) return false;
    if (r.ticker && symbolsEquivalent(r.ticker, line.symbol, cur)) return true;
    if ((r.name || "").trim().toUpperCase() === line.name.trim().toUpperCase()) return true;
    return false;
  });
}

/**
 * IPS 승인 직후 호출. 동일 ipsHash 재호출 시 이미 applied면 no-op(스냅샷 재사용).
 * 승인 취소해도 적용된 보유·lot 이력은 삭제하지 않는다.
 */
export async function applyIpsHoldingsSync(input: {
  clientId: string;
  pbId: string;
  ipsHash: string;
  /** 신규 배분 가능 자금(allocatableWon). 0이면 매수 없음. */
  availableFundsWon: number;
  /** @deprecated */
  investableWon?: number;
  fxUsdKrw: number;
  draft?: ManualPortfolioDraft | null;
  priceSnapshots: PriceSnapshot[];
}): Promise<IpsHoldingsSyncState> {
  const { clientId, ipsHash, fxUsdKrw, priceSnapshots } = input;
  const availableFundsWon =
    input.availableFundsWon != null
      ? input.availableFundsWon
      : Math.max(0, input.investableWon || 0);

  const existingState = await loadDurableState(clientId, ipsHash);
  if (existingState?.status === "applied") {
    return existingState;
  }

  const pending: IpsHoldingsSyncState = {
    clientId,
    ipsHash,
    status: "pending",
    lotIds: [],
    linesApplied: 0,
    snapshots: priceSnapshots,
  };
  setIpsHoldingsSyncState(pending);
  await persistAppToClient(clientId, pending);

  try {
    const draft = input.draft ?? loadManualPortfolioDraft(clientId);
    if (!draft) {
      const failed = { ...pending, status: "failed" as const, error: "포트폴리오 초안이 없습니다." };
      setIpsHoldingsSyncState(failed);
      await persistAppToClient(clientId, failed);
      return failed;
    }

    // 재시도 시 이미 커밋된 스냅샷이 있으면 취득원가 재사용(후속 시세는 평가만)
    const snapshotsForPlan =
      existingState?.snapshots && existingState.snapshots.length > 0
        ? existingState.snapshots
        : priceSnapshots;

    const plan = buildIpsPurchasePlan(draft, {
      availableFundsWon,
      fxUsdKrw,
      priceSnapshots: snapshotsForPlan,
    });

    // 한 줄이라도 실패하면 부분 적용하지 않는다.
    if (!plan.ok) {
      const failed = {
        ...pending,
        status: "failed" as const,
        error: plan.errors.join("\n") || "매수 계획을 만들 수 없습니다.",
        snapshots: snapshotsForPlan,
      };
      setIpsHoldingsSyncState(failed);
      await persistAppToClient(clientId, failed);
      return failed;
    }

    const existing = await loadExistingHoldings(clientId);
    const lots: IpsHoldingLot[] = [];
    let linesApplied = 0;

    for (const line of plan.lines) {
      if (line.quantity <= 0) continue;
      const matched = matchExisting(existing, line);
      const buyQty = line.quantity;
      const unitPrice = buyQty > 0 ? line.purchaseCostLocal / buyQty : line.snapshotPrice;
      const storeTicker = canonicalHoldingTicker(line.symbol, line.currency);

      if (matched) {
        const newQty = matched.quantity + buyQty;
        const newAvg = weightedAveragePrice(
          matched.quantity,
          matched.avg_price,
          buyQty,
          unitPrice,
        );
        if (isSupabaseConfigured && supabase) {
          const { error } = await supabase
            .from("client_holdings")
            .update({
              quantity: newQty,
              avg_price: newAvg,
              ticker: matched.ticker || storeTicker,
              source: matched.source?.includes("IPS")
                ? matched.source
                : `${matched.source || "manual"}+IPS 확정 기준`,
            })
            .eq("id", matched.id)
            .eq("client_id", clientId);
          if (error) throw new Error(error.message);
        }
        matched.quantity = newQty;
        matched.avg_price = newAvg;
        if (!matched.ticker) matched.ticker = storeTicker;
      } else {
        if (isSupabaseConfigured && supabase) {
          const { data, error } = await supabase
            .from("client_holdings")
            .insert([
              {
                client_id: clientId,
                owner_party_id: clientId,
                name: line.name,
                ticker: storeTicker,
                market: line.exchange,
                currency: line.currency,
                quantity: buyQty,
                avg_price: unitPrice,
                source: "IPS 확정 기준",
                confidence: "high",
              },
            ])
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          if (data?.id) {
            existing.push({
              id: String(data.id),
              name: line.name,
              ticker: storeTicker,
              market: line.exchange,
              currency: line.currency,
              quantity: buyQty,
              avg_price: unitPrice,
              source: "IPS 확정 기준",
            });
          }
        }
      }

      const lotId = `lot-${clientId}-${ipsHash.slice(0, 8)}-${storeTicker}-${lots.length}`;
      lots.push({
        id: lotId,
        clientId,
        ipsHash,
        symbol: storeTicker,
        exchange: line.exchange,
        currency: line.currency,
        assetClass: line.assetClass,
        quantity: buyQty,
        costLocal: line.purchaseCostLocal,
        costKrw: line.purchaseCostKrw,
        designatedPrice: line.snapshotPrice,
        snapshotPrice: line.snapshotPrice,
        fxRate: line.fxRate,
        appliedAt: new Date().toISOString(),
        source: "IPS 확정 기준",
        priceSnapshot: line.priceSnapshot,
      });
      linesApplied += 1;
    }

    if (plan.totalPurchaseKrw > 0 && isSupabaseConfigured && supabase) {
      const cashRow = existing.find((r) => {
        const m = (r.market || "").toUpperCase();
        const n = (r.name || "").toUpperCase();
        return m === "CASH" || n.includes("CMA") || n.includes("현금") || n.includes("예수금");
      });
      if (cashRow && cashRow.avg_price && cashRow.avg_price > 0) {
        const cashValue = cashRow.quantity * cashRow.avg_price;
        const nextValue = Math.max(0, cashValue - plan.totalPurchaseKrw);
        const nextQty = cashRow.quantity === 1 ? 1 : nextValue / cashRow.avg_price;
        const nextAvg = cashRow.quantity === 1 ? nextValue : cashRow.avg_price;
        await supabase
          .from("client_holdings")
          .update({
            quantity: cashRow.quantity === 1 ? 1 : nextQty,
            avg_price: nextAvg,
          })
          .eq("id", cashRow.id)
          .eq("client_id", clientId);
      }
    }

    appendLots(lots);
    const applied: IpsHoldingsSyncState = {
      clientId,
      ipsHash,
      status: "applied",
      appliedAt: new Date().toISOString(),
      lotIds: lots.map((l) => l.id),
      linesApplied,
      snapshots: snapshotsForPlan,
    };
    setIpsHoldingsSyncState(applied);
    await persistAppToClient(clientId, applied);
    return applied;
  } catch (e: any) {
    const failed: IpsHoldingsSyncState = {
      clientId,
      ipsHash,
      status: "failed",
      error: e?.message || String(e),
      lotIds: [],
      linesApplied: 0,
      snapshots: priceSnapshots,
    };
    setIpsHoldingsSyncState(failed);
    await persistAppToClient(clientId, failed);
    return failed;
  }
}
