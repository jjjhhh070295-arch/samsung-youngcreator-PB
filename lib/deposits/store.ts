/**
 * 예·적금 CRUD — 제품별 upsert/삭제 (delete-all 제거).
 */

import { supabase, isSupabaseConfigured } from "../supabase";
import type { DepositProduct } from "../tax/depositInterest";

const LS_KEY = "pb-client-deposits-v1";
const TABLE = "client_deposit_products";

type SaveResult = {
  ok: boolean;
  source: "db" | "local";
  error?: string;
};

function loadLocalAll(): Record<string, DepositProduct[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalAll(map: Record<string, DepositProduct[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function rowToProduct(r: any): DepositProduct {
  return {
    id: String(r.id),
    institution: r.institution ?? "",
    productName: r.product_name ?? "",
    productType: r.product_type === "installment" ? "installment" : "deposit",
    currency: r.currency ?? "KRW",
    principalWon: r.principal_won == null ? null : Number(r.principal_won),
    annualRatePct: r.annual_rate_pct == null ? null : Number(r.annual_rate_pct),
    openedAt: r.opened_at ?? null,
    termYears: r.term_years == null ? null : Number(r.term_years),
    maturesAt: r.matures_at ?? null,
    interestSchedule: r.interest_schedule ?? null,
    convention: r.convention === "compound_annual" ? "compound_annual" : "simple",
    taxStatus: (r.tax_status as DepositProduct["taxStatus"]) || "taxable",
    contributionAmountWon:
      r.contribution_amount_won == null ? null : Number(r.contribution_amount_won),
    contributionFrequency: r.contribution_frequency ?? null,
    contributionDates: Array.isArray(r.contribution_dates) ? r.contribution_dates : null,
    includeInManagedPreview: r.include_in_managed_preview !== false,
    identifiedInCashBalance: !!r.identified_in_cash_balance,
    source: r.source ?? null,
    asOf: r.as_of ?? null,
  };
}

function productToRow(clientId: string, p: DepositProduct) {
  return {
    id: p.id,
    client_id: clientId,
    institution: p.institution,
    product_name: p.productName,
    product_type: p.productType,
    currency: p.currency,
    principal_won: p.principalWon,
    annual_rate_pct: p.annualRatePct,
    opened_at: p.openedAt,
    term_years: p.termYears ?? null,
    matures_at: p.maturesAt,
    interest_schedule: p.interestSchedule,
    convention: p.convention,
    tax_status: p.taxStatus,
    contribution_amount_won: p.contributionAmountWon ?? null,
    contribution_frequency: p.contributionFrequency ?? null,
    contribution_dates: p.contributionDates ?? null,
    include_in_managed_preview: p.includeInManagedPreview,
    identified_in_cash_balance: p.identifiedInCashBalance,
    source: p.source,
    as_of: p.asOf,
    updated_at: new Date().toISOString(),
  };
}

export async function listDepositProducts(
  clientId: string,
  opts?: { preferLocalIfPresent?: boolean },
): Promise<DepositProduct[]> {
  if (!clientId) return [];
  const local = loadLocalAll()[clientId];

  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.from(TABLE).select("*").eq("client_id", clientId);
      if (!error && Array.isArray(data)) {
        const products = data.map(rowToProduct);
        // Dirty local newer revision: do not clobber unsynced local with empty remote mid-write
        if (opts?.preferLocalIfPresent && local?.length && products.length === 0) {
          return local;
        }
        const map = loadLocalAll();
        map[clientId] = products;
        saveLocalAll(map);
        return products;
      }
      if (error) {
        if (local) return local;
        throw new Error(error.message || "예·적금 조회 실패");
      }
    } catch (e: any) {
      if (local) return local;
      throw e;
    }
  }
  return local ?? [];
}

/**
 * 제품별 upsert + 제거된 id만 삭제. delete-all 사용하지 않음.
 */
export async function saveDepositProducts(
  clientId: string,
  products: DepositProduct[],
): Promise<SaveResult> {
  if (!clientId) return { ok: false, source: "local", error: "clientId 없음" };

  const map = loadLocalAll();
  const previousLocal = map[clientId] ?? [];
  map[clientId] = products;
  saveLocalAll(map);

  if (isSupabaseConfigured && supabase) {
    try {
      const { data: existing, error: listErr } = await supabase
        .from(TABLE)
        .select("id")
        .eq("client_id", clientId);
      if (listErr) {
        return {
          ok: true,
          source: "local",
          error: `DB 조회 실패 — 로컬만 저장됨: ${listErr.message}`,
        };
      }
      const keep = new Set(products.map((p) => p.id));
      const remoteIds = (existing ?? []).map((r: any) => String(r.id));
      const toDelete = remoteIds.filter((id) => !keep.has(id));
      if (toDelete.length) {
        const { error: delErr } = await supabase.from(TABLE).delete().in("id", toDelete);
        if (delErr) {
          // restore previous local on hard failure? keep new local; report error
          return {
            ok: false,
            source: "local",
            error: `삭제 실패 — 로컬 초안은 유지: ${delErr.message}`,
          };
        }
      }
      if (products.length) {
        const { error: upErr } = await supabase
          .from(TABLE)
          .upsert(products.map((p) => productToRow(clientId, p)));
        if (upErr) {
          // keep local draft; do not wipe remote further
          return {
            ok: false,
            source: "local",
            error: `저장 실패 — 이전 DB 행은 유지·로컬 초안 보존: ${upErr.message}`,
          };
        }
      }
      return { ok: true, source: "db" };
    } catch (e: any) {
      return {
        ok: true,
        source: "local",
        error: e?.message ? `DB 오류 — 로컬만 저장: ${e.message}` : "DB 오류 — 로컬만 저장",
      };
    }
  }

  void previousLocal;
  return { ok: true, source: "local" };
}

export async function upsertDepositProduct(
  clientId: string,
  product: DepositProduct,
): Promise<SaveResult> {
  const current = await listDepositProducts(clientId, { preferLocalIfPresent: true });
  const idx = current.findIndex((p) => p.id === product.id);
  const next = [...current];
  if (idx >= 0) next[idx] = product;
  else next.push(product);
  return saveDepositProducts(clientId, next);
}

export async function removeDepositProduct(
  clientId: string,
  productId: string,
): Promise<SaveResult> {
  const current = await listDepositProducts(clientId, { preferLocalIfPresent: true });
  return saveDepositProducts(
    clientId,
    current.filter((p) => p.id !== productId),
  );
}

export function newDepositProductId(): string {
  return `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
