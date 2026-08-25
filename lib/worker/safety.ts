/**
 * 실매매 활성화는 모든 조건이 맞아야 함. 기본 fail-closed.
 */

import { isLiveTradingEnabled } from "@/lib/kis/config";
import { isTraderDbConfigured } from "@/lib/db/client";
import type { CalendarSnapshot } from "@/lib/market/calendar";
import { isCalendarUsable } from "@/lib/market/calendar";

export interface SafetyInput {
  liveArmedDb: boolean;
  emergencyStop: boolean;
  heartbeatOk: boolean;
  calendar: CalendarSnapshot | null;
  accountSynced: boolean;
  reconciliationRequired: boolean;
  maxDailyLossWon: number;
  maxOrderWon: number;
  maxDailyOrders: number;
}

export interface SafetyResult {
  allowLiveOrders: boolean;
  reasons: string[];
}

export function evaluateLiveSafety(input: SafetyInput): SafetyResult {
  const reasons: string[] = [];
  if (!isLiveTradingEnabled()) reasons.push("KIS_LIVE_TRADING_ENABLED=false");
  if (!input.liveArmedDb) reasons.push("DB live_armed=false");
  if (input.emergencyStop) reasons.push("비상정지 ON");
  if (!input.heartbeatOk) reasons.push("Worker heartbeat 만료/없음");
  if (!isCalendarUsable(input.calendar) || !input.calendar?.isTradingDay) {
    reasons.push(input.calendar?.reason || "거래일 검증 실패");
  }
  if (!input.accountSynced) reasons.push("계좌 동기화 미완료");
  if (input.reconciliationRequired) reasons.push("RECONCILIATION_REQUIRED 미해결");
  if (!(input.maxDailyLossWon > 0)) reasons.push("일일 최대손실 미설정");
  if (!(input.maxOrderWon > 0)) reasons.push("종목당 최대주문금액 미설정");
  if (!(input.maxDailyOrders > 0)) reasons.push("일일 최대주문횟수 미설정");
  if (!isTraderDbConfigured()) reasons.push("Trader DB 미설정");

  return { allowLiveOrders: reasons.length === 0, reasons };
}
