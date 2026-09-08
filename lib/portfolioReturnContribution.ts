// 자산군별 수익률 기여도 — 확정 포트폴리오 비중 × 자산군 적용수익률.
// 합계가 확정 포트폴리오의 예상수익률과 일치하도록 스케일해 KPI와 정합을 맞춘다.
// expectedReturn 이 없거나 0 위장 불가(unavailable)이면 빈 배열을 돌려 차트를 숨긴다.

import type { AssetAllocation } from "./types";
import {
  FALLBACK_PROXY_RETURN_ESTIMATES,
  type ProxyAssetKey,
  type ProxyReturnEstimate,
} from "./proxyReturns";
import { contributionsAgreeWithReturn } from "./formatPercent";

export interface AssetReturnContribution {
  name: string;
  weightPct: number;
  appliedReturnPct: number;
  contributionPct: number;
}

export interface ReturnContributionResult {
  status: "ok" | "unavailable";
  rows: AssetReturnContribution[];
  sumContributionPct: number | null;
  agreesWithExpected: boolean;
  note: string | null;
}

function appliedReturnForLabel(label: string, rate: (key: ProxyAssetKey) => number): number {
  const l = label.trim();
  if (/주식|etf/i.test(l)) return rate("sp500") * 0.6 + rate("kospi") * 0.4;
  if (/채권/.test(l)) return rate("bond");
  if (/mmf|rp|현금/i.test(l)) return rate("mmf");
  if (/금|gold/i.test(l)) return rate("gold");
  if (/달러|dollar/i.test(l)) return rate("dollar");
  if (/원자재|대체|raw|commodity/i.test(l)) return rate("raw");
  return rate("bond");
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * @param expectedReturnPct null/undefined → 산출 불가(빈 결과).
 *   유한 0 은 "진짜 0%"로 취급한다(스케일만 생략).
 * @param allowFallbackProxy false 이면 proxy 추정치로 기여도를 만들지 않는다.
 */
export function buildReturnContributionsFromPortfolio(
  allocations: AssetAllocation[],
  expectedReturnPct: number | null | undefined,
  proxyReturns?: ProxyReturnEstimate[],
  opts?: { allowFallbackProxy?: boolean },
): AssetReturnContribution[] {
  return buildReturnContributionResult(allocations, expectedReturnPct, proxyReturns, opts).rows;
}

export function buildReturnContributionResult(
  allocations: AssetAllocation[],
  expectedReturnPct: number | null | undefined,
  proxyReturns?: ProxyReturnEstimate[],
  opts?: { allowFallbackProxy?: boolean },
): ReturnContributionResult {
  const allowFallback = opts?.allowFallbackProxy !== false;

  if (expectedReturnPct == null || !Number.isFinite(expectedReturnPct)) {
    return {
      status: "unavailable",
      rows: [],
      sumContributionPct: null,
      agreesWithExpected: false,
      note: "예상수익률이 없어 기여도를 표시하지 않습니다.",
    };
  }

  if (!allowFallback && (!proxyReturns || proxyReturns.length === 0)) {
    return {
      status: "unavailable",
      rows: [],
      sumContributionPct: null,
      agreesWithExpected: false,
      note: "시장 수익률 자료가 없어 기여도를 산출하지 않았습니다.",
    };
  }

  const byKey = new Map((proxyReturns ?? []).map((e) => [e.key, e.annualizedReturnPct] as const));
  const rate = (key: ProxyAssetKey) => {
    if (byKey.has(key)) return byKey.get(key)!;
    if (!allowFallback) return Number.NaN;
    return FALLBACK_PROXY_RETURN_ESTIMATES[key];
  };

  const rowsRaw = allocations
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

  if (rowsRaw.some((r) => !Number.isFinite(r.rawApplied))) {
    return {
      status: "unavailable",
      rows: [],
      sumContributionPct: null,
      agreesWithExpected: false,
      note: "일부 자산군의 적용수익률을 확인할 수 없습니다.",
    };
  }

  const rawTotal = rowsRaw.reduce((sum, r) => sum + r.rawContribution, 0);
  const scale =
    rawTotal > 0 && expectedReturnPct !== 0 ? expectedReturnPct / rawTotal : expectedReturnPct === 0 ? 0 : 1;

  const rows = rowsRaw.map((r) => {
    const appliedReturnPct = round2(r.rawApplied * scale);
    return {
      name: r.name,
      weightPct: r.weightPct,
      appliedReturnPct,
      contributionPct: round2((r.weightPct / 100) * appliedReturnPct),
    };
  });

  const sumContributionPct = rows.reduce((s, r) => s + r.contributionPct, 0);
  const agrees = contributionsAgreeWithReturn(sumContributionPct, expectedReturnPct);

  return {
    status: "ok",
    rows,
    sumContributionPct,
    agreesWithExpected: agrees,
    note: agrees
      ? null
      : "기여도 합과 예상수익률 표시값의 차이가 허용 범위를 넘습니다. 확인이 필요합니다.",
  };
}
