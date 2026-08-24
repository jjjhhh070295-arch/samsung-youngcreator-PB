// 자산군별 수익률 기여도 — 확정 포트폴리오 비중 × 자산군 적용수익률.
// 합계가 확정 포트폴리오의 예상수익률과 일치하도록 스케일해 KPI와 정합을 맞춘다.

import type { AssetAllocation } from "./types";
import {
  FALLBACK_PROXY_RETURN_ESTIMATES,
  type ProxyAssetKey,
  type ProxyReturnEstimate,
} from "./proxyReturns";

export interface AssetReturnContribution {
  name: string;            // SET 라벨 (도넛과 동일)
  weightPct: number;       // 비중 %
  appliedReturnPct: number; // 해당 자산군 적용 연수익률 % (스케일 후)
  contributionPct: number;  // 기여도 %p = weight × appliedReturn / 100 (스케일 후)
}

// SET 라벨(도넛과 동일) → proxy 수익률. ETF는 S&P500 60% : KOSPI 40% 블렌드(추천 패널과 동일 기준).
// 레거시 4분류(채권/현금/대체투자) 라벨도 별칭으로 흡수.
function appliedReturnForLabel(label: string, rate: (key: ProxyAssetKey) => number): number {
  const l = label.trim();
  if (/주식|etf/i.test(l)) return rate("sp500") * 0.6 + rate("kospi") * 0.4;
  if (/채권/.test(l)) return rate("bond");
  if (/mmf|rp|현금/i.test(l)) return rate("mmf");
  if (/금|gold/i.test(l)) return rate("gold");
  if (/달러|dollar/i.test(l)) return rate("dollar");
  if (/원자재|대체|raw|commodity/i.test(l)) return rate("raw");
  return rate("bond"); // 미상 라벨은 보수적으로 채권 수익률
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function buildReturnContributionsFromPortfolio(
  allocations: AssetAllocation[],
  expectedReturnPct: number,
  proxyReturns?: ProxyReturnEstimate[],
): AssetReturnContribution[] {
  const byKey = new Map((proxyReturns ?? []).map((e) => [e.key, e.annualizedReturnPct] as const));
  const rate = (key: ProxyAssetKey) => byKey.get(key) ?? FALLBACK_PROXY_RETURN_ESTIMATES[key];

  const rows = allocations
    .filter((a) => a.weight > 0)
    .map((a) => {
      const rawApplied = appliedReturnForLabel(a.assetClass, rate);
      return {
        name: a.assetClass,
        weightPct: a.weight,
        rawApplied,
        rawContribution: (a.weight / 100) * rawApplied,
      };
    });

  const rawTotal = rows.reduce((sum, r) => sum + r.rawContribution, 0);
  // 기여도 합계 = 확정 예상수익률이 되도록 적용수익률을 스케일 (KPI 정합)
  const scale = rawTotal > 0 && expectedReturnPct > 0 ? expectedReturnPct / rawTotal : 1;

  return rows.map((r) => {
    const appliedReturnPct = round2(r.rawApplied * scale);
    return {
      name: r.name,
      weightPct: r.weightPct,
      appliedReturnPct,
      contributionPct: round2((r.weightPct / 100) * appliedReturnPct),
    };
  });
}
