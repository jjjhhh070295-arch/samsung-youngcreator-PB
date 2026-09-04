import type { AnalyticsResult, Holding } from "./types";

export interface PBAssumption { value: number; reason: string; calculationDate: string }
export type PBAssumptions = Record<string, PBAssumption>;
export const assumptionKey = (h: Holding) => JSON.stringify([h.ticker, h.currency, h.assetType, h.subType]);
export function parsePBAssumption(rate: string, reason: string, date = new Date().toISOString()): PBAssumption {
  const value = rate.trim() === "" ? NaN : Number(rate);
  if (!Number.isFinite(value) || value < -100 || value > 1000) throw new Error("연 기대수익률은 -100%~1000% 범위의 숫자로 입력하세요.");
  if (!reason.trim() || reason.trim().length > 500) throw new Error("가정 근거를 1~500자로 입력하세요.");
  return { value: value / 100, reason: reason.trim(), calculationDate: date };
}
/** A separate PB scenario; never mutates the provider result or historical NAV.
 * Only unsupported holdings can use PB overrides; weights are never renormalized. */
export function calculatePBScenario(result: AnalyticsResult, assumptions: PBAssumptions) {
  const holdings = result.holdings.map(h => {
    const assumption = h.expectedReturn.value == null ? assumptions[assumptionKey(h)] : undefined;
    const valid = assumption && Number.isFinite(assumption.value) && assumption.value >= -1 && assumption.value <= 10 &&
      typeof assumption.reason === "string" && assumption.reason.trim().length > 0 && assumption.reason.length <= 500 &&
      Number.isFinite(Date.parse(assumption.calculationDate));
    const pb = valid ? assumption : undefined;
    const value = h.expectedReturn.value ?? pb?.value ?? null;
    return { ...h, scenarioValue: value, method: pb ? "pb_assumption" : h.expectedReturn.method,
      assumption: pb, contribution: value == null ? null : h.weight * value };
  });
  const missing = holdings.filter(h => h.scenarioValue == null);
  return { method: "pb_assumption" as const,
    value: missing.length ? null : holdings.reduce((sum, h) => sum + h.contribution!, 0),
    missing, holdings, assumedWeight: holdings.reduce((sum, h) => sum + (h.assumption ? h.weight : 0), 0) };
}
