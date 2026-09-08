/**
 * IPS 승인 후 보유종목 동기화 — 멱등·재시도 가능.
 * 브로커 주문 없음. source = "IPS 확정 기준".
 */

import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";
import { loadManualPortfolioDraft } from "../manualPortfolioDraft";
import {
  buildIpsPurchasePlan,
  weightedAveragePrice,
  type PurchasePlanLine,
} from "./ipsPurchasePlan";

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
  fxRate: number;
  appliedAt: string;
  source: "IPS 확정 기준";
}

export interface IpsHoldingsSyncState {
  clientId: string;
  ipsHash: string;
  status: IpsHoldingsSyncStatus;
  appliedAt?: string;
  error?: string;
  lotIds: string[];
  linesApplied: number;
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
  const sym = line.symbol.trim().toUpperCase();
  return rows.find((r) => {
    const t = (r.ticker || "").trim().toUpperCase();
    const n = (r.name || "").trim().toUpperCase();
    const cur = (r.currency || "KRW").toUpperCase();
    if (cur !== line.currency.toUpperCase()) return false;
    if (t && t === sym) return true;
    if (n === line.name.trim().toUpperCase()) return true;
    return false;
  });
}

/**
 * IPS 승인 직후 호출. 동일 ipsHash 재호출 시 이미 applied면 no-op.
 * 승인 취소해도 적용된 보유·lot 이력은 삭제하지 않는다.
 */
export async function applyIpsHoldingsSync(input: {
  clientId: string;
  pbId: string;
  ipsHash: string;
  investableWon: number;
  fxUsdKrw: number;
  draft?: ManualPortfolioDraft | null;
}): Promise<IpsHoldingsSyncState> {
  const { clientId, ipsHash, investableWon, fxUsdKrw } = input;
  const existingState = getIpsHoldingsSyncState(clientId, ipsHash);
  if (existingState?.status === "applied") {
    return existingState;
  }

  const pending: IpsHoldingsSyncState = {
    clientId,
    ipsHash,
    status: "pending",
    lotIds: [],
    linesApplied: 0,
  };
  setIpsHoldingsSyncState(pending);

  try {
    const draft = input.draft ?? loadManualPortfolioDraft(clientId);
    if (!draft) {
      const failed = { ...pending, status: "failed" as const, error: "포트폴리오 초안이 없습니다." };
      setIpsHoldingsSyncState(failed);
      return failed;
    }

    const existing = await loadExistingHoldings(clientId);

    const plan = buildIpsPurchasePlan(draft, {
      investableWon,
      fxUsdKrw,
    });

    if (!plan.ok && plan.lines.length === 0) {
      const failed = {
        ...pending,
        status: "failed" as const,
        error: plan.errors.join("\n") || "매수 계획을 만들 수 없습니다.",
      };
      setIpsHoldingsSyncState(failed);
      return failed;
    }

    const lots: IpsHoldingLot[] = [];
    let linesApplied = 0;

    for (const line of plan.lines) {
      if (line.quantity <= 0) continue;
      const matched = matchExisting(existing, line);
      const buyQty = line.quantity;
      // 단위원가: 채권 %호가 보정은 plan에서 purchaseCostLocal/qty 로 반영됨
      const unitPrice =
        buyQty > 0 ? line.purchaseCostLocal / buyQty : line.designatedPrice;

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
      } else {
        if (isSupabaseConfigured && supabase) {
          const { data, error } = await supabase
            .from("client_holdings")
            .insert([
              {
                client_id: clientId,
                owner_party_id: clientId,
                name: line.name,
                ticker: line.symbol,
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
              ticker: line.symbol,
              market: line.exchange,
              currency: line.currency,
              quantity: buyQty,
              avg_price: unitPrice,
              source: "IPS 확정 기준",
            });
          }
        } else {
          // 로컬 폴백: lots만 기록 (데모)
        }
      }

      const lotId = `lot-${clientId}-${ipsHash.slice(0, 8)}-${line.symbol}-${lots.length}`;
      lots.push({
        id: lotId,
        clientId,
        ipsHash,
        symbol: line.symbol,
        exchange: line.exchange,
        currency: line.currency,
        assetClass: line.assetClass,
        quantity: buyQty,
        costLocal: line.purchaseCostLocal,
        costKrw: line.purchaseCostKrw,
        designatedPrice: line.designatedPrice,
        fxRate: line.fxRate,
        appliedAt: new Date().toISOString(),
        source: "IPS 확정 기준",
      });
      linesApplied += 1;
    }

    // 현금 이중계상 방지: CMA/현금성 보유가 있으면 매수 원가만큼 수량(평가액) 축소
    if (plan.totalPurchaseKrw > 0 && isSupabaseConfigured && supabase) {
      const cashRow = existing.find((r) => {
        const m = (r.market || "").toUpperCase();
        const n = (r.name || "").toUpperCase();
        return m === "CASH" || n.includes("CMA") || n.includes("현금") || n.includes("예수금");
      });
      if (cashRow && cashRow.avg_price && cashRow.avg_price > 0) {
        const cashValue = cashRow.quantity * cashRow.avg_price;
        const nextValue = Math.max(0, cashValue - plan.totalPurchaseKrw);
        const nextQty =
          cashRow.quantity === 1
            ? 1
            : nextValue / cashRow.avg_price;
        const nextAvg =
          cashRow.quantity === 1 ? nextValue : cashRow.avg_price;
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
      error: plan.errors.length ? plan.errors.join("\n") : undefined,
    };
    setIpsHoldingsSyncState(applied);
    return applied;
  } catch (e: any) {
    const failed: IpsHoldingsSyncState = {
      clientId,
      ipsHash,
      status: "failed",
      error: e?.message || String(e),
      lotIds: [],
      linesApplied: 0,
    };
    setIpsHoldingsSyncState(failed);
    return failed;
  }
}
