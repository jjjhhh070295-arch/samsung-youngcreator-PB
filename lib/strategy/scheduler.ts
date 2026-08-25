/**
 * Scheduler helpers — 세션은 lib/market/sessions 로 이전.
 * 기존 after_close(15:40–18:00) 근사는 제거됨.
 */

import { seoulParts } from "@/lib/market/sessions";

export {
  detectMarketSessions,
  isAfterCloseSessionOpen,
  isRegularSessionOpen,
  sessionLabel,
  seoulParts,
  type MarketSession,
  type SessionSnapshot,
} from "@/lib/market/sessions";

export { seoulDateKey } from "@/lib/market/calendar";

export interface SchedulerReadiness {
  ready: boolean;
  reason?: string;
}

export function describeSchedulerReadiness(): SchedulerReadiness {
  const enabled = process.env.STRATEGY_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (enabled === "1" || enabled === "true" || enabled === "yes") {
    return { ready: true };
  }
  return {
    ready: false,
    reason: "STRATEGY_SCHEDULER_ENABLED 꺼짐 — 독립 Worker(npm run worker)를 사용하세요",
  };
}

/** 월~금만 — 주문 게이트에는 calendar.resolveTradingCalendar 사용 */
export function isSeoulTradingDay(date: Date = new Date()): boolean {
  const { weekday } = seoulParts(date);
  return weekday >= 1 && weekday <= 5;
}
