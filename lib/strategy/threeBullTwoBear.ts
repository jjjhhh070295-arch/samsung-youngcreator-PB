export const STRATEGY_ID = "KR_THREE_BULL_TWO_BEAR" as const;

export const MAX_STRATEGY_POSITIONS = 3;

export type ExitFallbackPolicy = "MANUAL" | "NEXT_OPEN";

export type StrategyState =
  | "WATCHING"
  | "BUY_SIGNAL"
  | "BUY_SUBMITTED"
  | "PARTIALLY_FILLED"
  | "OPEN"
  | "SELL_SIGNAL"
  | "SELL_SUBMITTED"
  | "EXIT_PARTIALLY_FILLED"
  | "CLOSED"
  | "MISSED_ENTRY"
  | "EXIT_UNFILLED"
  | "HALTED"
  | "ERROR";

export interface CompletedBar {
  date: string;
  open: number;
  close: number;
}

export interface BuySignalResult {
  signal: boolean;
  bullStreak: number;
  reason?: string;
}

export interface SellSignalResult {
  signal: boolean;
  bearStreak: number;
  reason?: string;
}

export function isBullishBar(bar: CompletedBar): boolean {
  return bar.close > bar.open;
}

export function isBearishBar(bar: CompletedBar): boolean {
  return bar.close < bar.open;
}

export function isDojiBar(bar: CompletedBar): boolean {
  return bar.close === bar.open;
}

/** Count consecutive bullish bars at the end; doji breaks the streak. */
export function countTrailingBullStreak(completedBars: CompletedBar[]): number {
  let streak = 0;
  for (let i = completedBars.length - 1; i >= 0; i -= 1) {
    const bar = completedBars[i];
    if (isDojiBar(bar)) break;
    if (!isBullishBar(bar)) break;
    streak += 1;
  }
  return streak;
}

/** Count consecutive bearish bars at the end; doji breaks the streak. */
export function countTrailingBearStreak(completedBars: CompletedBar[]): number {
  let streak = 0;
  for (let i = completedBars.length - 1; i >= 0; i -= 1) {
    const bar = completedBars[i];
    if (isDojiBar(bar)) break;
    if (!isBearishBar(bar)) break;
    streak += 1;
  }
  return streak;
}

/**
 * Buy when exactly 3 consecutive bullish completed bars appear.
 * Day 4+ (streak > 3) does not re-fire — avoids duplicate entries.
 */
export function detectBuySignal(completedBars: CompletedBar[]): BuySignalResult {
  if (completedBars.length < 3) {
    return { signal: false, bullStreak: countTrailingBullStreak(completedBars), reason: "insufficient bars" };
  }

  const bullStreak = countTrailingBullStreak(completedBars);
  if (bullStreak === 3) {
    return { signal: true, bullStreak };
  }
  if (bullStreak > 3) {
    return { signal: false, bullStreak, reason: "duplicate entry blocked on day 4+" };
  }
  return { signal: false, bullStreak, reason: "need 3 consecutive bullish bars" };
}

/**
 * Sell when holding a position and >= 2 consecutive bearish completed bars.
 * Doji resets the bear streak.
 */
export function detectSellSignal(
  completedBars: CompletedBar[],
  hasPosition: boolean,
): SellSignalResult {
  if (!hasPosition) {
    return { signal: false, bearStreak: countTrailingBearStreak(completedBars), reason: "no position" };
  }

  const bearStreak = countTrailingBearStreak(completedBars);
  if (bearStreak >= 2) {
    return { signal: true, bearStreak };
  }
  return { signal: false, bearStreak, reason: "need 2 consecutive bearish bars" };
}

/** OPEN, BUY_SUBMITTED, and PARTIALLY_FILLED count toward capacity. */
export function countOpenLikePositions(states: StrategyState[]): number {
  const openLike: StrategyState[] = ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED"];
  return states.filter((state) => openLike.includes(state)).length;
}

export function canOpenNewPosition(openCount: number, max = MAX_STRATEGY_POSITIONS): boolean {
  return openCount < max;
}

export function computeOrderQty(allocatedWon: number, closePrice: number): number {
  if (!Number.isFinite(allocatedWon) || allocatedWon <= 0) return 0;
  if (!Number.isFinite(closePrice) || closePrice <= 0) return 0;
  return Math.floor(allocatedWon / closePrice);
}

export const EXIT_FALLBACK_POLICY: ExitFallbackPolicy =
  (process.env.STRATEGY_EXIT_FALLBACK as ExitFallbackPolicy | undefined) ?? "MANUAL";

export function nextStateOnBuySignal(current: StrategyState, openCount: number): StrategyState {
  if (!canOpenNewPosition(openCount)) return "MISSED_ENTRY";
  if (current === "WATCHING" || current === "BUY_SIGNAL") return "BUY_SIGNAL";
  return current;
}

export function nextStateOnPartialFill(current: StrategyState): StrategyState {
  if (current === "BUY_SUBMITTED") return "PARTIALLY_FILLED";
  if (current === "SELL_SUBMITTED") return "EXIT_PARTIALLY_FILLED";
  return current;
}

export function remainingUnfilledQty(totalQty: number, filledQty: number): number {
  return Math.max(0, totalQty - filledQty);
}
