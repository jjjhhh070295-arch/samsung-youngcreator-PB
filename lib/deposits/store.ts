/**
 * 예·적금 CRUD — Supabase 우선, localStorage 폴백.
 */

import { supabase, isSupabaseConfigured } from "../supabase";
import type { DepositProduct } from "../tax/depositInterest";

const LS_KEY = "pb-client-deposits-v1";
const TABLE = "client_deposit_products";

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

export async function listDepositProducts(clientId: string): Promise<DepositProduct[]> {
  if (!clientId) return [];
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.from(TABLE).select("*").eq("client_id", clientId);
      if (!error && Array.isArray(data)) {
        const products = data.map(rowToProduct);
        const map = loadLocalAll();
        map[clientId] = products;
        saveLocalAll(map);
        return products;
      }
    } catch {
      /* fall through */
    }
  }
  return loadLocalAll()[clientId] ?? [];
}

export async function saveDepositProducts(
  clientId: string,
  products: DepositProduct[],
): Promise<{ ok: boolean; source: "db" | "local" }> {
  const map = loadLocalAll();
  map[clientId] = products;
  saveLocalAll(map);

  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.from(TABLE).delete().eq("client_id", clientId);
      if (products.length) {
        const { error } = await supabase.from(TABLE).upsert(products.map((p) => productToRow(clientId, p)));
        if (!error) return { ok: true, source: "db" };
      } else {
        return { ok: true, source: "db" };
      }
    } catch {
      /* local ok */
    }
  }
  return { ok: true, source: "local" };
}

export function newDepositProductId(): string {
  return `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
