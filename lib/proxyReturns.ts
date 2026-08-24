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
  returnBasis: "price_cagr" | "income_proxy";
  displayRange?: string;
  displayNote?: string;
}

export interface ProxyReturnContribution {
  assetGroup: string;
  weight: number;
  appliedReturn: number;
  contribution: number;
  source: string;
}

/** Used only when the market-data endpoint cannot supply a usable series. */
export const FALLBACK_PROXY_RETURN_ESTIMATES: Record<ProxyAssetKey, number> = {
  sp500: 12,
  kospi: 12,
  bond: 3.25,
  mmf: 2.75,
  gold: 5,
  dollar: 2,
  raw: 3.6,
};

export const RETURN_ESTIMATE_LABEL = "시장 proxy 기반 참고 수익률 구성";

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
  return { key, label, proxy, source: "fallback", startDate: null, endDate: null, usedYears: 0, annualizedReturnPct: FALLBACK_PROXY_RETURN_ESTIMATES[key], fallback: true, returnBasis: "price_cagr" };
}

export function incomeProxyEstimate(key: "bond" | "mmf", label: string, proxy: string): ProxyReturnEstimate {
  const isBond = key === "bond";
  return {
    key, label, proxy,
    source: isBond ? "채권형 이자수익 proxy (fallback)" : "현금성·단기금리 proxy (fallback)",
    startDate: null, endDate: null, usedYears: 0,
    annualizedReturnPct: FALLBACK_PROXY_RETURN_ESTIMATES[key], fallback: true,
    returnBasis: "income_proxy",
    displayRange: isBond ? "3.0~3.5%" : "2.5~3.0%",
    displayNote: isBond ? "이자수익 proxy" : "단기금리 proxy",
  };
}

export function calculatePortfolioProxyReturn(weights: SetWeights, estimates: ProxyReturnEstimate[], etfHoldings?: EtfHolding[]) {
  const byKey = new Map(estimates.map((estimate) => [estimate.key, estimate]));
  const estimateFor = (key: ProxyAssetKey) => byKey.get(key);
  const ratePct = (key: ProxyAssetKey) => estimateFor(key)?.annualizedReturnPct ?? FALLBACK_PROXY_RETURN_ESTIMATES[key];
  const sourceFor = (key: ProxyAssetKey) => estimateFor(key)?.source ?? "fallback";
  const indices = convertSetToIndices(weights, etfHoldings);
  const components: Array<{ assetGroup: string; weight: number; key: ProxyAssetKey }> = [
    { assetGroup: "주식/ETF (S&P500)", weight: indices.sp500, key: "sp500" },
    { assetGroup: "주식/ETF (KOSPI)", weight: indices.kospi, key: "kospi" },
    { assetGroup: "bond", weight: indices.treasury, key: "bond" },
    { assetGroup: "cash/MMF/RP", weight: indices.hedge.mmf, key: "mmf" },
    { assetGroup: "gold", weight: indices.hedge.gold, key: "gold" },
    { assetGroup: "dollar", weight: indices.hedge.dollar, key: "dollar" },
    { assetGroup: "commodity", weight: indices.hedge.raw, key: "raw" },
  ];
  const contributions: ProxyReturnContribution[] = components
    .filter((component) => component.weight > 0)
    .map((component) => {
      const appliedReturn = ratePct(component.key);
      return {
        assetGroup: component.assetGroup,
        weight: component.weight,
        appliedReturn,
        contribution: (component.weight / 100) * appliedReturn,
        source: sourceFor(component.key),
      };
    });
  const annualizedReturnPct = contributions.reduce((sum, item) => sum + item.contribution, 0);
  return {
    annualizedReturnPct: Math.round(annualizedReturnPct * 10) / 10,
    fallbackUsed: estimates.some((estimate) => estimate.fallback),
    estimates,
    contributions: contributions.map((item) => ({ ...item, contribution: Math.round(item.contribution * 1000) / 1000 })),
  };
}
