/**
 * 기대수익률 단위 어댑터.
 * 분석 엔진: decimal 0.08 = 8%
 * Portfolio.expectedReturn / tax *Pct: percentage points 8 = 8%
 */

import { identityKeyForSymbol } from "@/lib/pricing/instrumentIdentity";

export type ReturnBasisKind = "total_return" | "price_only" | "unknown";

export type InstrumentReturnAssumptionPct = {
  totalReturnPct?: number | null;
  priceReturnPct?: number | null;
  dividendYieldPct?: number | null;
  couponPct?: number | null;
  returnBasis?: ReturnBasisKind;
  expensesAlreadyInReturn?: boolean;
  method?: string;
  source?: string[];
  calculationDate?: string;
  ytmPct?: number | null;
  expenseRatioPct?: number | null;
  effectiveDurationYears?: number | null;
  spreadDurationYears?: number | null;
  rateChangeBp?: number;
  spreadChangeBp?: number;
  carryRollPct?: number | null;
  expenseDragPct?: number | null;
  ratePriceEffectPct?: number | null;
  spreadPriceEffectPct?: number | null;
  factsAsOf?: string | null;
  factsSourceLabel?: string | null;
  factsSourceUrl?: string | null;
};

/** decimal 0.08 → percent points 8 */
export function decimalReturnToPctPoints(decimal: number | null | undefined): number | null {
  if (decimal == null || !Number.isFinite(decimal)) return null;
  return Math.round(decimal * 10000) / 100; // 2dp percent
}

/** percent points 8 → decimal 0.08 */
export function pctPointsToDecimalReturn(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return pct / 100;
}

export function assumptionKeysForSymbol(symbol: string): string[] {
  const raw = symbol.trim();
  const upper = raw.toUpperCase();
  const key = identityKeyForSymbol(raw);
  return Array.from(new Set([raw, upper, key, key.toUpperCase()].filter(Boolean)));
}

export function getAssumptionForSymbol(
  map: Map<string, InstrumentReturnAssumptionPct> | Record<string, InstrumentReturnAssumptionPct> | null | undefined,
  symbol: string,
): InstrumentReturnAssumptionPct | undefined {
  if (!map) return undefined;
  const getter =
    map instanceof Map
      ? (k: string) => map.get(k)
      : (k: string) => (map as Record<string, InstrumentReturnAssumptionPct>)[k];
  for (const k of assumptionKeysForSymbol(symbol)) {
    const hit = getter(k);
    if (hit) return hit;
  }
  return undefined;
}

export type PortfolioAnalyticsSnapshot = {
  /** composition identity — allocation+symbols */
  compositionKey: string;
  asOf: string;
  /** decimal 0.08 */
  expectedReturnDecimal: number | null;
  expectedRiskDecimal: number | null;
  returnStatus: "ok" | "unavailable";
  riskStatus: "ok" | "unavailable";
  /** portfolio-level basis when only aggregate is known */
  portfolioReturnBasis: ReturnBasisKind;
  /** percent-point assumptions keyed by symbol */
  instrumentAssumptionsPct: Record<string, InstrumentReturnAssumptionPct>;
};

export function buildReturnAssumptionsMap(
  snapshot: PortfolioAnalyticsSnapshot | null | undefined,
): Map<string, InstrumentReturnAssumptionPct> | undefined {
  if (!snapshot?.instrumentAssumptionsPct) return undefined;
  const m = new Map<string, InstrumentReturnAssumptionPct>();
  for (const [sym, a] of Object.entries(snapshot.instrumentAssumptionsPct)) {
    for (const k of assumptionKeysForSymbol(sym)) m.set(k, a);
  }
  return m;
}
