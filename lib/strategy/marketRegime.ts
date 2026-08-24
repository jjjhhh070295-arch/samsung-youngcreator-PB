/**
 * 시장 국면(상승/횡보/하락)에 따른 전략 정책.
 * 지수·종목 판단은 완료된 일봉만 사용 (장중 미완성 봉 제외는 호출측 책임).
 */

import type { CompletedBar } from "./threeBullTwoBear";
import {
  MAX_STRATEGY_POSITIONS,
  canOpenNewPosition,
  computeOrderQty,
  detectBuySignal,
  countTrailingBullStreak,
  isBullishBar,
} from "./threeBullTwoBear";

export type MarketRegime = "bull" | "sideways" | "bear";

export interface RegimePolicy {
  regime: MarketRegime;
  /** 신규 매수 허용 */
  allowNewBuys: boolean;
  maxPositions: number;
  /** 주문수량 배율 (하락=0, 횡보=0.5, 상승=1) */
  qtyMultiplier: number;
  /** 과열 종목 제외 */
  excludeOverheated: boolean;
  labelKo: string;
  reason: string;
}

export interface OverheatCheck {
  overheated: boolean;
  reasons: string[];
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * KOSPI(또는 벤치) 완료 일봉으로 국면 판정.
 * - 상승: 종가 > MA20 이고 MA20 > MA60(가능 시) 이며 최근 20일 수익률 > 0
 * - 하락: 종가 < MA20 이고 최근 20일 수익률 < 0
 * - 횡보: 그 외
 */
export function detectMarketRegime(indexBars: CompletedBar[]): {
  regime: MarketRegime;
  asOf: string | null;
  ma20: number | null;
  ma60: number | null;
  ret20Pct: number | null;
  reason: string;
} {
  if (indexBars.length < 21) {
    return {
      regime: "sideways",
      asOf: indexBars.at(-1)?.date ?? null,
      ma20: null,
      ma60: null,
      ret20Pct: null,
      reason: "지수 일봉 부족 — 보수적으로 횡보 취급",
    };
  }

  const closes = indexBars.map((b) => b.close);
  const last = closes[closes.length - 1]!;
  const ma20 = sma(closes, 20);
  const ma60 = closes.length >= 60 ? sma(closes, 60) : null;
  const close20Ago = closes[closes.length - 21]!;
  const ret20Pct = close20Ago > 0 ? ((last / close20Ago) - 1) * 100 : null;
  const asOf = indexBars[indexBars.length - 1]!.date;

  if (ma20 != null && last > ma20 && ret20Pct != null && ret20Pct > 0 && (ma60 == null || ma20 >= ma60)) {
    return {
      regime: "bull",
      asOf,
      ma20,
      ma60,
      ret20Pct,
      reason: "종가>MA20 · 20일 수익률>0 · MA20≥MA60(또는 MA60 미가용)",
    };
  }

  if (ma20 != null && last < ma20 && ret20Pct != null && ret20Pct < 0) {
    return {
      regime: "bear",
      asOf,
      ma20,
      ma60,
      ret20Pct,
      reason: "종가<MA20 · 20일 수익률<0",
    };
  }

  return {
    regime: "sideways",
    asOf,
    ma20,
    ma60,
    ret20Pct,
    reason: "상승/하락 조건 미충족 — 횡보",
  };
}

export function policyForRegime(regime: MarketRegime): RegimePolicy {
  if (regime === "bull") {
    return {
      regime,
      allowNewBuys: true,
      maxPositions: MAX_STRATEGY_POSITIONS,
      qtyMultiplier: 1,
      excludeOverheated: false,
      labelKo: "상승장 — 기존 3양봉 전략",
      reason: "최대 3종목 · 수량 100%",
    };
  }
  if (regime === "bear") {
    return {
      regime,
      allowNewBuys: false,
      maxPositions: 0,
      qtyMultiplier: 0,
      excludeOverheated: true,
      labelKo: "하락장 — 신규매수 중단 · 현금 대기",
      reason: "신규 매수 금지",
    };
  }
  return {
    regime: "sideways",
    allowNewBuys: true,
    maxPositions: 1,
    qtyMultiplier: 0.5,
    excludeOverheated: true,
    labelKo: "횡보장 — 최대 1종목 · 과열 제외 · 수량 축소",
    reason: "최대 1종목 · 수량 50% · 과열 종목 제외",
  };
}

/**
 * 과열 판정 (횡보 시 제외용, 결정론):
 * - 당일(최근 완료봉) 등락률 ≥ 7%, 또는
 * - 종가 > MA20 × 1.12, 또는
 * - 연속 양봉 ≥ 5일
 */
export function isOverheatedStock(
  stockBars: CompletedBar[],
  options?: { dayChangePct?: number | null },
): OverheatCheck {
  const reasons: string[] = [];
  if (stockBars.length < 2) {
    return { overheated: false, reasons: [] };
  }

  const last = stockBars[stockBars.length - 1]!;
  const prev = stockBars[stockBars.length - 2]!;
  const dayChangePct =
    options?.dayChangePct != null && Number.isFinite(options.dayChangePct)
      ? options.dayChangePct
      : prev.close > 0
        ? ((last.close / prev.close) - 1) * 100
        : null;

  if (dayChangePct != null && dayChangePct >= 7) {
    reasons.push(`당일 등락률 ${dayChangePct.toFixed(1)}% ≥ 7%`);
  }

  const closes = stockBars.map((b) => b.close);
  const ma20 = sma(closes, 20);
  if (ma20 != null && ma20 > 0 && last.close > ma20 * 1.12) {
    reasons.push(`종가>MA20×1.12 (${((last.close / ma20 - 1) * 100).toFixed(1)}%)`);
  }

  const bullStreak = countTrailingBullStreak(stockBars);
  if (bullStreak >= 5) {
    reasons.push(`연속 양봉 ${bullStreak}일 ≥ 5`);
  }

  // 최근 3봉 모두 양봉이면서 누적 +12% 이상
  if (stockBars.length >= 4) {
    const a = stockBars[stockBars.length - 4]!.close;
    const b = last.close;
    if (a > 0 && isBullishBar(stockBars[stockBars.length - 1]!) && (b / a - 1) * 100 >= 12) {
      const streak3 = stockBars.slice(-3).every((bar) => isBullishBar(bar));
      if (streak3) reasons.push("최근 3일 누적 +12% 이상 급등");
    }
  }

  return { overheated: reasons.length > 0, reasons: Array.from(new Set(reasons)) };
}

export interface RegimeEntryDecision {
  allow: boolean;
  regime: MarketRegime;
  policy: RegimePolicy;
  buySignal: boolean;
  bullStreak: number;
  overheated: boolean;
  overheatReasons: string[];
  maxPositions: number;
  openCount: number;
  qty: number;
  allocatedWonEffective: number;
  reasons: string[];
}

/**
 * 국면 반영 신규 진입 판정.
 * 상승: 기존 3양봉 / 횡보: max1+과열제외+수량50% / 하락: 매수 중단
 */
export function evaluateRegimeEntry(input: {
  indexBars: CompletedBar[];
  stockBars: CompletedBar[];
  openCount: number;
  allocatedWon: number;
  closePrice: number;
  dayChangePct?: number | null;
}): RegimeEntryDecision {
  const detected = detectMarketRegime(input.indexBars);
  const policy = policyForRegime(detected.regime);
  const buy = detectBuySignal(input.stockBars);
  const heat = policy.excludeOverheated
    ? isOverheatedStock(input.stockBars, { dayChangePct: input.dayChangePct })
    : { overheated: false, reasons: [] as string[] };

  const reasons: string[] = [`국면: ${policy.labelKo}`];
  if (!policy.allowNewBuys) {
    reasons.push("하락장 — 신규매수 중단, 현금 대기");
    return {
      allow: false,
      regime: policy.regime,
      policy,
      buySignal: buy.signal,
      bullStreak: buy.bullStreak,
      overheated: heat.overheated,
      overheatReasons: heat.reasons,
      maxPositions: policy.maxPositions,
      openCount: input.openCount,
      qty: 0,
      allocatedWonEffective: 0,
      reasons,
    };
  }

  if (!buy.signal) {
    reasons.push(buy.reason ?? "3양봉 매수 신호 없음");
    return {
      allow: false,
      regime: policy.regime,
      policy,
      buySignal: false,
      bullStreak: buy.bullStreak,
      overheated: heat.overheated,
      overheatReasons: heat.reasons,
      maxPositions: policy.maxPositions,
      openCount: input.openCount,
      qty: 0,
      allocatedWonEffective: 0,
      reasons,
    };
  }

  if (heat.overheated) {
    reasons.push(`과열 제외: ${heat.reasons.join(" · ")}`);
    return {
      allow: false,
      regime: policy.regime,
      policy,
      buySignal: true,
      bullStreak: buy.bullStreak,
      overheated: true,
      overheatReasons: heat.reasons,
      maxPositions: policy.maxPositions,
      openCount: input.openCount,
      qty: 0,
      allocatedWonEffective: 0,
      reasons,
    };
  }

  if (!canOpenNewPosition(input.openCount, policy.maxPositions)) {
    reasons.push(`포지션 한도(${policy.maxPositions}) 도달 — openCount=${input.openCount}`);
    return {
      allow: false,
      regime: policy.regime,
      policy,
      buySignal: true,
      bullStreak: buy.bullStreak,
      overheated: false,
      overheatReasons: [],
      maxPositions: policy.maxPositions,
      openCount: input.openCount,
      qty: 0,
      allocatedWonEffective: 0,
      reasons,
    };
  }

  const allocatedWonEffective = Math.floor(input.allocatedWon * policy.qtyMultiplier);
  const qty = computeOrderQty(allocatedWonEffective, input.closePrice);
  if (qty < 1) {
    reasons.push("수량 축소 후 1주 미만 — 주문 안 함");
    return {
      allow: false,
      regime: policy.regime,
      policy,
      buySignal: true,
      bullStreak: buy.bullStreak,
      overheated: false,
      overheatReasons: [],
      maxPositions: policy.maxPositions,
      openCount: input.openCount,
      qty: 0,
      allocatedWonEffective,
      reasons,
    };
  }

  reasons.push(`진입 허용 · 수량 ${qty}주 (배율 ${policy.qtyMultiplier})`);
  return {
    allow: true,
    regime: policy.regime,
    policy,
    buySignal: true,
    bullStreak: buy.bullStreak,
    overheated: false,
    overheatReasons: [],
    maxPositions: policy.maxPositions,
    openCount: input.openCount,
    qty,
    allocatedWonEffective,
    reasons,
  };
}
