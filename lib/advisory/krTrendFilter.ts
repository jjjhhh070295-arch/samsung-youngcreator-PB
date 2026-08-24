/**
 * 국장 추세 필터 — 가격/이동평균/양봉/손익비는 전부 결정론. LLM 미사용.
 * 장중 미완성 일봉은 기술조건에서 제외한다.
 */

export interface OhlcBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ma20AboveResult {
  passed: boolean;
  daysAbove: number;
  lookback: number;
  ratioLabel: string;
}

export interface BullishCountResult {
  passed: boolean;
  bullishDays: number;
  lookback: number;
  ratioLabel: string;
}

export interface ConsecutiveBullishResult {
  passed: boolean;
  consecutive: number;
  required: number;
  /** UI 표기: 정통 적삼봉이 아닌 간소화 정의 */
  label: string;
}

export interface TechnicalFilterResult {
  ma20Above10d: Ma20AboveResult;
  bullish20d: BullishCountResult;
  consecutiveBullish: ConsecutiveBullishResult;
  passed: boolean;
  usedCompletedBarsOnly: boolean;
  barCount: number;
}

export interface RiskRewardInput {
  seedWon: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  /** 최근 20거래일 양봉 일수 (0~20) */
  bullishDays20: number;
  feeRate?: number;
  sellTaxRate?: number;
  slippageRate?: number;
}

export interface RiskRewardResult {
  ok: boolean;
  shares: number;
  riskPerShare: number;
  rewardPerShare: number;
  maxLossWon: number;
  targetProfitWon: number;
  /** 목표수익 / 최대손실 — UI: 위험 1 대비 보상 X */
  rewardRiskRatio: number | null;
  bullishRatio: number;
  proxyExpectedProfitWon: number;
  proxyExpectedLossWon: number;
  proxyNetExpectedWon: number;
  estimatedCostWon: number;
  /** 통계 검증 승률 — 표본 부족 시 null → UI N/A */
  historicalWinRate: number | null;
  currency: "KRW";
  notes: string[];
  disclaimer: string;
}

export function isBullish(bar: OhlcBar): boolean {
  return bar.close > bar.open;
}

export function isBearish(bar: OhlcBar): boolean {
  return bar.close < bar.open;
}

export function isDoji(bar: OhlcBar): boolean {
  return bar.close === bar.open;
}

/** Asia/Seoul 기준 오늘 YYYY-MM-DD */
export function seoulTodayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * 완료된 일봉만 남긴다.
 * - 날짜 오름차순, 중복 날짜 제거(마지막 유지)
 * - 장중 당일 봉(date === todaySeoul)은 제외
 */
export function completedBarsOnly(bars: OhlcBar[], todaySeoul = seoulTodayKey()): OhlcBar[] {
  const byDate = new Map<string, OhlcBar>();
  for (const bar of bars) {
    if (!bar?.date || !(bar.close > 0) || !(bar.open > 0)) continue;
    byDate.set(bar.date, bar);
  }
  return Array.from(byDate.values())
    .filter((b) => b.date < todaySeoul)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 최근 lookback거래일 종가가 각 시점 MA20 위 — 10/10만 통과. 최소 29개 완료 일봉 필요. */
export function countClosesAboveMa20(bars: OhlcBar[], lookback = 10, maPeriod = 20): Ma20AboveResult {
  const minBars = maPeriod + lookback - 1; // 29
  if (bars.length < minBars) {
    return {
      passed: false,
      daysAbove: 0,
      lookback,
      ratioLabel: `0/${lookback} (데이터 부족, 필요≥${minBars})`,
    };
  }
  let daysAbove = 0;
  const start = bars.length - lookback;
  for (let i = start; i < bars.length; i++) {
    const window = bars.slice(i - maPeriod + 1, i + 1);
    const ma = window.reduce((s, b) => s + b.close, 0) / maPeriod;
    if (bars[i].close > ma) daysAbove += 1;
  }
  return {
    passed: daysAbove === lookback,
    daysAbove,
    lookback,
    ratioLabel: `${daysAbove}/${lookback}`,
  };
}

/** 최근 lookback거래일 양봉 수. 도지(close===open)는 양봉 아님. */
export function countBullishDays(bars: OhlcBar[], lookback = 20, minBullish = 10): BullishCountResult {
  if (bars.length < lookback) {
    return {
      passed: false,
      bullishDays: 0,
      lookback,
      ratioLabel: `0/${lookback} (데이터 부족)`,
    };
  }
  const slice = bars.slice(-lookback);
  const bullishDays = slice.filter(isBullish).length;
  return {
    passed: bullishDays >= minBullish,
    bullishDays,
    lookback,
    ratioLabel: `${bullishDays}/${lookback}`,
  };
}

/** 최근 연속 양봉 (간소화 적삼봉: 3일 이상 연속 close>open). */
export function countConsecutiveBullish(bars: OhlcBar[], required = 3): ConsecutiveBullishResult {
  let consecutive = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (!isBullish(bars[i])) break;
    consecutive += 1;
  }
  return {
    passed: consecutive >= required,
    consecutive,
    required,
    label: "3일 이상 연속 양봉인 간소화 적삼봉",
  };
}

export function evaluateTechnicalFilters(
  bars: OhlcBar[],
  options?: { todaySeoul?: string; excludeIntraday?: boolean },
): TechnicalFilterResult {
  const excludeIntraday = options?.excludeIntraday !== false;
  const completed = excludeIntraday ? completedBarsOnly(bars, options?.todaySeoul) : [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const ma20Above10d = countClosesAboveMa20(completed, 10, 20);
  const bullish20d = countBullishDays(completed, 20, 10);
  const consecutiveBullish = countConsecutiveBullish(completed, 3);
  return {
    ma20Above10d,
    bullish20d,
    consecutiveBullish,
    passed: ma20Above10d.passed && bullish20d.passed && consecutiveBullish.passed,
    usedCompletedBarsOnly: excludeIntraday,
    barCount: completed.length,
  };
}

/**
 * 손익비 계산 (결정론).
 * 양봉비율 ≠ 상승확률. 프록시 기댓값만 별도 표기.
 */
export function calculateRiskReward(input: RiskRewardInput): RiskRewardResult {
  const notes: string[] = [];
  const disclaimer =
    "양봉비율을 사용한 단순 참고값이며 통계적으로 검증된 승률이 아님";
  const entry = input.entryPrice;
  const stop = input.stopLossPrice;
  const take = input.takeProfitPrice;
  const seed = input.seedWon;
  const feeRate = Math.max(0, input.feeRate ?? 0);
  const sellTaxRate = Math.max(0, input.sellTaxRate ?? 0);
  const slippageRate = Math.max(0, input.slippageRate ?? 0);

  const empty = (extra: string[]): RiskRewardResult => ({
    ok: false,
    shares: 0,
    riskPerShare: 0,
    rewardPerShare: 0,
    maxLossWon: 0,
    targetProfitWon: 0,
    rewardRiskRatio: null,
    bullishRatio: 0,
    proxyExpectedProfitWon: 0,
    proxyExpectedLossWon: 0,
    proxyNetExpectedWon: 0,
    estimatedCostWon: 0,
    historicalWinRate: null,
    currency: "KRW",
    notes: [...notes, ...extra],
    disclaimer,
  });

  if (!(seed > 0)) return empty(["투입금액은 0보다 커야 합니다."]);
  if (!(entry > 0)) return empty(["진입가가 유효하지 않습니다."]);
  if (!(stop > 0 && take > 0)) return empty(["손절가·익절가가 유효하지 않습니다."]);
  if (!(stop < entry && entry < take)) {
    return empty(["손절가 < 진입가 < 익절가 조건을 만족해야 합니다."]);
  }

  const shares = Math.floor(seed / entry);
  if (shares < 1) return empty(["계산된 매수수량이 1주 미만입니다."]);

  const riskPerShare = entry - stop;
  const rewardPerShare = take - entry;
  const maxLossWon = riskPerShare * shares;
  const targetProfitWon = rewardPerShare * shares;
  const rewardRiskRatio = maxLossWon > 0 ? targetProfitWon / maxLossWon : null;

  const bullishRatio = Math.min(1, Math.max(0, input.bullishDays20 / 20));
  const notional = entry * shares;
  const estimatedCostWon = notional * (feeRate * 2 + sellTaxRate + slippageRate);

  const proxyExpectedProfitWon = targetProfitWon * bullishRatio;
  const proxyExpectedLossWon = maxLossWon * (1 - bullishRatio);
  const proxyNetExpectedWon = proxyExpectedProfitWon - proxyExpectedLossWon - estimatedCostWon;

  return {
    ok: true,
    shares,
    riskPerShare,
    rewardPerShare,
    maxLossWon,
    targetProfitWon,
    rewardRiskRatio,
    bullishRatio,
    proxyExpectedProfitWon,
    proxyExpectedLossWon,
    proxyNetExpectedWon,
    estimatedCostWon,
    historicalWinRate: null,
    currency: "KRW",
    notes,
    disclaimer,
  };
}
