/** 국장 추세 필터 — 가격/이동평균/양봉/손익비는 전부 결정론. LLM 미사용. */

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
  ratioLabel: string; // e.g. "8/10"
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
}

export interface TechnicalFilterResult {
  ma20Above10d: Ma20AboveResult;
  bullish20d: BullishCountResult;
  consecutiveBullish: ConsecutiveBullishResult;
  passed: boolean;
}

export interface RiskRewardInput {
  seedWon: number;
  currentPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  /** 최근 20거래일 양봉 일수 (0~20) */
  bullishDays20: number;
}

export interface RiskRewardResult {
  shares: number;
  winRate: number;
  lossRate: number;
  lossPerShare: number;
  profitPerShare: number;
  expectedLossWon: number;
  expectedProfitWon: number;
  riskRewardRatio: number | null;
  currency: "KRW";
  notes: string[];
}

function isBullish(bar: OhlcBar): boolean {
  return bar.close > bar.open;
}

/** 최근 `lookback`거래일 종가가 각 시점의 20일 이동평균 위에 있는 일수. */
export function countClosesAboveMa20(bars: OhlcBar[], lookback = 10, maPeriod = 20): Ma20AboveResult {
  if (bars.length < maPeriod + lookback - 1) {
    return {
      passed: false,
      daysAbove: 0,
      lookback,
      ratioLabel: `0/${lookback} (데이터 부족)`,
    };
  }
  let daysAbove = 0;
  const start = bars.length - lookback;
  for (let i = start; i < bars.length; i++) {
    const window = bars.slice(i - maPeriod + 1, i + 1);
    if (window.length < maPeriod) continue;
    const ma = window.reduce((s, b) => s + b.close, 0) / maPeriod;
    if (bars[i].close > ma) daysAbove += 1;
  }
  const passed = daysAbove === lookback;
  return {
    passed,
    daysAbove,
    lookback,
    ratioLabel: `${daysAbove}/${lookback}`,
  };
}

/** 최근 `lookback`거래일 양봉 일수. */
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

/** 최근 연속 양봉 일수 (가장 최근 봉부터). */
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
  };
}

export function evaluateTechnicalFilters(bars: OhlcBar[]): TechnicalFilterResult {
  const ma20Above10d = countClosesAboveMa20(bars, 10, 20);
  const bullish20d = countBullishDays(bars, 20, 10);
  const consecutiveBullish = countConsecutiveBullish(bars, 3);
  return {
    ma20Above10d,
    bullish20d,
    consecutiveBullish,
    passed: ma20Above10d.passed && bullish20d.passed && consecutiveBullish.passed,
  };
}

/**
 * 손익비 계산.
 * 상승확률 = 20일 양봉 비율, 하락확률 = 1 - 상승확률
 * 매수수량 = floor(시드 / 현재가)
 */
export function calculateRiskReward(input: RiskRewardInput): RiskRewardResult {
  const notes: string[] = [];
  const { seedWon, currentPrice, stopLossPrice, takeProfitPrice, bullishDays20 } = input;

  if (!(currentPrice > 0)) {
    return {
      shares: 0,
      winRate: 0,
      lossRate: 1,
      lossPerShare: 0,
      profitPerShare: 0,
      expectedLossWon: 0,
      expectedProfitWon: 0,
      riskRewardRatio: null,
      currency: "KRW",
      notes: ["현재가가 유효하지 않습니다."],
    };
  }

  const shares = Math.floor(seedWon / currentPrice);
  if (shares <= 0) notes.push("시드가 현재가보다 작아 매수수량이 0입니다.");

  const winRate = Math.min(1, Math.max(0, bullishDays20 / 20));
  const lossRate = 1 - winRate;
  const lossPerShare = currentPrice - stopLossPrice;
  const profitPerShare = takeProfitPrice - currentPrice;

  if (!(stopLossPrice > 0) || stopLossPrice >= currentPrice) {
    notes.push("손절가는 현재가보다 낮아야 합니다.");
  }
  if (!(takeProfitPrice > 0) || takeProfitPrice <= currentPrice) {
    notes.push("익절가는 현재가보다 높아야 합니다.");
  }

  const expectedLossWon = shares * Math.max(0, lossPerShare) * lossRate;
  const expectedProfitWon = shares * Math.max(0, profitPerShare) * winRate;
  const riskRewardRatio =
    expectedLossWon > 0 ? expectedProfitWon / expectedLossWon : expectedProfitWon > 0 ? null : null;

  if (expectedLossWon <= 0 && expectedProfitWon > 0) {
    notes.push("예상 손실이 0이라 손익비를 정의할 수 없습니다 (무한대).");
  }

  return {
    shares,
    winRate,
    lossRate,
    lossPerShare,
    profitPerShare,
    expectedLossWon,
    expectedProfitWon,
    riskRewardRatio,
    currency: "KRW",
    notes,
  };
}
