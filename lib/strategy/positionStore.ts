/**
 * 자동매매 포지션/런 상태 (인메모리).
 * 프로세스 재시작 시 초기화 — 실서비스는 DB 마이그레이션 테이블로 교체.
 */

import type { MarketRegime } from "@/lib/strategy/marketRegime";
import type { StrategyState } from "@/lib/strategy/threeBullTwoBear";

export interface AutoPosition {
  id: string;
  ticker: string;
  name: string;
  qty: number;
  entryPrice: number;
  state: StrategyState;
  openedAt: string;
  updatedAt: string;
  regimeAtEntry: MarketRegime;
  dryRun: boolean;
  kisOrderId?: string;
}

export interface AutoTradeLog {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

export interface AutoTraderState {
  armed: boolean;
  /** 실주문까지 허용 (KIS_LIVE + 이 플래그) */
  liveArmed: boolean;
  lastRunAt: string | null;
  lastCycleSummary: string | null;
  regime: MarketRegime | null;
  positions: AutoPosition[];
  logs: AutoTradeLog[];
  running: boolean;
}

const g = globalThis as typeof globalThis & {
  __autoTraderState?: AutoTraderState;
};

function freshState(): AutoTraderState {
  return {
    armed: false,
    liveArmed: false,
    lastRunAt: null,
    lastCycleSummary: null,
    regime: null,
    positions: [],
    logs: [],
    running: false,
  };
}

export function getAutoTraderState(): AutoTraderState {
  if (!g.__autoTraderState) g.__autoTraderState = freshState();
  return g.__autoTraderState;
}

export function resetAutoTraderStateForTests(): void {
  g.__autoTraderState = freshState();
}

export function appendLog(
  level: AutoTradeLog["level"],
  message: string,
  meta?: Record<string, unknown>,
): void {
  const state = getAutoTraderState();
  state.logs.unshift({ at: new Date().toISOString(), level, message, meta });
  state.logs = state.logs.slice(0, 200);
}

export function setArmed(armed: boolean, liveArmed = false): AutoTraderState {
  const state = getAutoTraderState();
  state.armed = armed;
  state.liveArmed = armed ? liveArmed : false;
  appendLog("info", armed ? `자동매매 무장 (live=${state.liveArmed})` : "자동매매 해제");
  return state;
}

export function listOpenPositions(): AutoPosition[] {
  return getAutoTraderState().positions.filter((p) =>
    ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED", "SELL_SUBMITTED", "EXIT_PARTIALLY_FILLED"].includes(
      p.state,
    ),
  );
}

export function upsertPosition(position: AutoPosition): void {
  const state = getAutoTraderState();
  const idx = state.positions.findIndex((p) => p.id === position.id);
  if (idx >= 0) state.positions[idx] = position;
  else state.positions.unshift(position);
}

export function findPositionByTicker(ticker: string): AutoPosition | undefined {
  return listOpenPositions().find((p) => p.ticker === ticker);
}
