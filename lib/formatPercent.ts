/**
 * 표시용 퍼센트 포맷 — 저장·계산은 전체 정밀도, 화면만 소수 1자리.
 */

export function formatPercent1(
  value: number | null | undefined,
  opts?: { suffix?: "%" | "%p" | ""; signed?: boolean },
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const suffix = opts?.suffix ?? "%";
  const rounded = Math.round(value * 10) / 10;
  const body = rounded.toFixed(1);
  if (opts?.signed && rounded > 0) return `+${body}${suffix}`;
  return `${body}${suffix}`;
}

export function formatPercentPoint1(value: number | null | undefined): string {
  return formatPercent1(value, { suffix: "%p" });
}

/** 기여도 합과 포트폴리오 수익률 정합 허용오차 (%p) */
export const CONTRIBUTION_RETURN_TOLERANCE_PP = 0.15;

export function contributionsAgreeWithReturn(
  contributionSumPp: number,
  expectedReturnPct: number,
  tolerance = CONTRIBUTION_RETURN_TOLERANCE_PP,
): boolean {
  if (!Number.isFinite(contributionSumPp) || !Number.isFinite(expectedReturnPct)) return false;
  return Math.abs(contributionSumPp - expectedReturnPct) <= tolerance;
}
