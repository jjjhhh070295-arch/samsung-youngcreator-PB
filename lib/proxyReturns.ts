import { convertSetToIndices, type EtfHolding, type SetWeights } from "./assetMapping";

export type ProxyAssetKey = "sp500" | "kospi" | "bond" | "mmf" | "gold" | "dollar" | "raw";

export interface ProxyReturnEstimate {
  key: ProxyAssetKey;
  label: string;
  proxy: string;
  source: string;
  startDate: string | null;
  endDate: string | null;
  usedYears: number;
  annualizedReturnPct: number;
  fallback: boolean;
}

/** Used only when the market-data endpoint cannot supply a usable series. */
export const FALLBACK_PROXY_RETURN_ESTIMATES: Record<ProxyAssetKey, number> = {
  sp500: 12,
  kospi: 12,
  bond: 4.5,
  mmf: 3.5,
  gold: 5,
  dollar: 2,
  raw: 3.6,
};

export const RETURN_ESTIMATE_LABEL = "최근 5년 시장 proxy 기반 연율화 참고 수익률";

export function annualizedReturnFromPrices(rows: Array<{ close: number; localDate: string }>): { annualizedReturnPct: number; usedYears: number; startDate: string | null; endDate: string | null } | null {
  const usable = rows.filter((row) => Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.localDate.localeCompare(b.localDate));
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable.at(-1)!;
  const elapsedDays = (new Date(last.localDate).getTime() - new Date(first.localDate).getTime()) / 86_400_000;
  const usedYears = elapsedDays / 365.25;
  if (!Number.isFinite(usedYears) || usedYears <= 0) return null;
  const totalReturn = last.close / first.close - 1;
  const annualizedReturnPct = (Math.pow(Math.max(1 + totalReturn, 0.000001), 1 / usedYears) - 1) * 100;
  return { annualizedReturnPct, usedYears, startDate: first.localDate, endDate: last.localDate };
}

export function fallbackProxyEstimate(key: ProxyAssetKey, label: string, proxy: string): ProxyReturnEstimate {
  return { key, label, proxy, source: "fallback", startDate: null, endDate: null, usedYears: 0, annualizedReturnPct: FALLBACK_PROXY_RETURN_ESTIMATES[key], fallback: true };
}

export function calculatePortfolioProxyReturn(weights: SetWeights, estimates: ProxyReturnEstimate[], etfHoldings?: EtfHolding[]) {
  const byKey = new Map(estimates.map((estimate) => [estimate.key, estimate]));
  const rate = (key: ProxyAssetKey) => (byKey.get(key)?.annualizedReturnPct ?? FALLBACK_PROXY_RETURN_ESTIMATES[key]) / 100;
  const indices = convertSetToIndices(weights, etfHoldings);
  const annualizedReturnPct =
    indices.sp500 * rate("sp500") +
    indices.kospi * rate("kospi") +
    indices.treasury * rate("bond") +
    indices.hedge.mmf * rate("mmf") +
    indices.hedge.gold * rate("gold") +
    indices.hedge.dollar * rate("dollar") +
    indices.hedge.raw * rate("raw");
  return {
    annualizedReturnPct: Math.round(annualizedReturnPct * 10) / 10,
    fallbackUsed: estimates.some((estimate) => estimate.fallback),
    estimates,
  };
}
