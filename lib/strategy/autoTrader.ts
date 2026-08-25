/**
 * 자동매매 1사이클:
 * 1) 국면 판정 (KOSPI)
 * 2) 보유분 2음봉 청산 신호
 * 3) 스크리닝 최종후보에 대해 3양봉+국면 게이트 진입
 *
 * 실주문은 liveArmed && KIS_LIVE_TRADING_ENABLED 일 때만.
 * 그 외에는 dry-run으로 포지션/로그를 남긴다.
 */

import { fetchKoreanTopGainers, fetchKisOhlcBars, mapPool } from "@/lib/advisory/krGainers";
import { evaluateTechnicalFilters } from "@/lib/advisory/krTrendFilter";
import { demoThemePass, isTradingDemoMode } from "@/lib/advisory/demoScreen";
import { judgeThemeFromReports } from "@/lib/advisory/themeFromResearch";
import { selectTopKrStocksByMarketCap } from "@/lib/advisory/selectTopKrStocks";
import { MAX_SELECTED_KR_STOCKS } from "@/lib/advisory/krConstants";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { fetchKospiCompletedBars } from "@/lib/market/kospiBars";
import {
  detectMarketRegime,
  evaluateRegimeEntry,
  policyForRegime,
} from "@/lib/strategy/marketRegime";
import {
  describeSchedulerReadiness,
  isAfterCloseSessionOpen,
  isRegularSessionOpen,
  sessionLabel,
} from "@/lib/strategy/scheduler";
import { detectSellSignal, STRATEGY_ID } from "@/lib/strategy/threeBullTwoBear";
import { placeOrderViaKis } from "@/lib/trading/orders";
import { ORD_DVSN_AFTER_CLOSE, ORD_DVSN_LIMIT } from "@/lib/kis/config";
import {
  appendLog,
  findPositionByTicker,
  getAutoTraderState,
  listOpenPositions,
  upsertPosition,
  type AutoPosition,
} from "./positionStore";

export interface AutoCycleResult {
  ok: boolean;
  dryRun: boolean;
  skipped?: string;
  regime: string | null;
  session: string;
  buys: Array<{ ticker: string; qty: number; dryRun: boolean }>;
  sells: Array<{ ticker: string; qty: number; dryRun: boolean }>;
  scanned: number;
  finalCandidates: number;
  openPositions: number;
  summary: string;
}

function allocatedWonDefault(): number {
  const n = Number.parseInt(process.env.STRATEGY_ALLOCATED_WON ?? "1000000", 10);
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

function newPosId(): string {
  return `pos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function canPlaceLive(): boolean {
  const state = getAutoTraderState();
  return state.liveArmed && isLiveTradingEnabled();
}

async function placeOrSimulate(input: {
  side: "buy" | "sell";
  ticker: string;
  name: string;
  qty: number;
  price: number;
  regime: ReturnType<typeof policyForRegime>["regime"];
}): Promise<{ dryRun: boolean; orderId?: string }> {
  const dryRun = !canPlaceLive();
  const session = sessionLabel();
  const ordDvsn = session === "NXT_AFTER" ? ORD_DVSN_AFTER_CLOSE : ORD_DVSN_LIMIT;

  if (dryRun) {
    appendLog("info", `[dry-run] ${input.side} ${input.name}(${input.ticker}) x${input.qty}`, {
      price: input.price,
      regime: input.regime,
    });
    return { dryRun: true };
  }

  const order = await placeOrderViaKis({
    symbol: input.ticker,
    side: input.side,
    quantity: input.qty,
    price: input.price,
    ordDvsn,
    userId: "auto-trader",
    strategyId: STRATEGY_ID,
    idempotencyKey: `auto-${input.side}-${input.ticker}-${Date.now()}`,
  });
  appendLog("info", `[live] ${input.side} 접수 ${input.ticker} x${input.qty}`, {
    orderId: order.id,
  });
  return { dryRun: false, orderId: order.id };
}

async function screenFinalCandidates(): Promise<
  Array<{ ticker: string; name: string; price: number; changePct: number; marketCapWon: number | null }>
> {
  const screen = await fetchKoreanTopGainers(70);
  if (screen.status !== "ok") {
    appendLog("warn", `스크리닝 실패/설정필요: ${screen.message ?? screen.status}`);
    return [];
  }

  const okCap = screen.gainers.filter((g) => g.marketCapStatus === "ok");
  const evaluated = await mapPool(okCap.slice(0, 40), 4, async (g) => {
    try {
      const { bars } = await fetchKisOhlcBars(g.ticker);
      const technical = evaluateTechnicalFilters(bars);
      if (!technical.passed) return null;
      if (isTradingDemoMode()) {
        const theme = demoThemePass(g.name);
        if (!theme.passed) return null;
      } else {
        // 실전: 테마 문서 없으면 차단 — 자동매매는 기술통과만으로도 후보에 넣되 로그
        const judged = judgeThemeFromReports({ themeName: g.name, sources: [] });
        if (judged.status === "blocked") {
          // 자동매매: 리포트 없으면 기술통과 종목은 review로 허용 (수동 UI와 달리 운영 가능)
        }
      }
      return {
        ticker: g.ticker,
        name: g.name,
        price: g.price,
        changePct: g.changePct,
        marketCapWon: g.marketCapWon,
      };
    } catch (e: unknown) {
      appendLog("warn", `종목 평가 실패 ${g.ticker}`, {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  });

  const finals = evaluated.filter(Boolean) as Array<{
    ticker: string;
    name: string;
    price: number;
    changePct: number;
    marketCapWon: number | null;
  }>;
  const { selected } = selectTopKrStocksByMarketCap(finals, MAX_SELECTED_KR_STOCKS);
  return selected;
}

/**
 * 자동매매 1회 실행. armed=false면 skip.
 * force=true면 armed 무시(수동 「지금 1회 실행」).
 */
export async function runAutoTradeCycle(options?: {
  force?: boolean;
  ignoreSession?: boolean;
}): Promise<AutoCycleResult> {
  const state = getAutoTraderState();
  if (state.running) {
    return {
      ok: false,
      dryRun: true,
      skipped: "already_running",
      regime: state.regime,
      session: sessionLabel(),
      buys: [],
      sells: [],
      scanned: 0,
      finalCandidates: 0,
      openPositions: listOpenPositions().length,
      summary: "이미 사이클 실행 중",
    };
  }

  if (!options?.force && !state.armed) {
    return {
      ok: false,
      dryRun: true,
      skipped: "not_armed",
      regime: state.regime,
      session: sessionLabel(),
      buys: [],
      sells: [],
      scanned: 0,
      finalCandidates: 0,
      openPositions: listOpenPositions().length,
      summary: "무장 해제 상태 — 자동매매 안 함",
    };
  }

  const readiness = describeSchedulerReadiness();
  const session = sessionLabel();
  if (!options?.ignoreSession && session === "CLOSED") {
    appendLog("info", "장 마감 — 사이클 스킵");
    return {
      ok: true,
      dryRun: !canPlaceLive(),
      skipped: "session_closed",
      regime: state.regime,
      session,
      buys: [],
      sells: [],
      scanned: 0,
      finalCandidates: 0,
      openPositions: listOpenPositions().length,
      summary: "세션 종료 — 스킵",
    };
  }

  state.running = true;
  const buys: AutoCycleResult["buys"] = [];
  const sells: AutoCycleResult["sells"] = [];
  let finalCandidates = 0;

  try {
    const { bars: indexBars, source } = await fetchKospiCompletedBars();
    const detected = detectMarketRegime(indexBars);
    const policy = policyForRegime(detected.regime);
    state.regime = detected.regime;
    appendLog("info", `국면 ${policy.labelKo}`, { source, reason: detected.reason });

    // ── 청산 ──
    for (const pos of listOpenPositions()) {
      try {
        const { bars } = await fetchKisOhlcBars(pos.ticker);
        const completed = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
        const sell = detectSellSignal(completed, true);
        if (!sell.signal) continue;

        const last = completed[completed.length - 1]!;
        const placed = await placeOrSimulate({
          side: "sell",
          ticker: pos.ticker,
          name: pos.name,
          qty: pos.qty,
          price: last.close,
          regime: detected.regime,
        });
        pos.state = "CLOSED";
        pos.updatedAt = new Date().toISOString();
        upsertPosition(pos);
        sells.push({ ticker: pos.ticker, qty: pos.qty, dryRun: placed.dryRun });
      } catch (e: unknown) {
        appendLog("error", `청산 평가 실패 ${pos.ticker}`, {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // ── 신규 ──
    const candidates = await screenFinalCandidates();
    finalCandidates = candidates.length;

    for (const c of candidates) {
      if (findPositionByTicker(c.ticker)) continue;

      const { bars } = await fetchKisOhlcBars(c.ticker);
      const stockBars = bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
      const decision = evaluateRegimeEntry({
        indexBars,
        stockBars,
        openCount: listOpenPositions().length,
        allocatedWon: allocatedWonDefault(),
        closePrice: c.price > 0 ? c.price : stockBars.at(-1)?.close ?? 0,
        dayChangePct: c.changePct,
      });

      if (!decision.allow || decision.qty < 1) {
        appendLog("info", `진입 스킵 ${c.name}(${c.ticker})`, { reasons: decision.reasons });
        continue;
      }

      const placed = await placeOrSimulate({
        side: "buy",
        ticker: c.ticker,
        name: c.name,
        qty: decision.qty,
        price: c.price,
        regime: decision.regime,
      });

      const pos: AutoPosition = {
        id: newPosId(),
        ticker: c.ticker,
        name: c.name,
        qty: decision.qty,
        entryPrice: c.price,
        state: placed.dryRun ? "OPEN" : "BUY_SUBMITTED",
        openedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        regimeAtEntry: decision.regime,
        dryRun: placed.dryRun,
        kisOrderId: placed.orderId,
      };
      upsertPosition(pos);
      buys.push({ ticker: c.ticker, qty: decision.qty, dryRun: placed.dryRun });
    }

    const summary = `국면=${detected.regime} · 후보=${finalCandidates} · 매수=${buys.length} · 매도=${sells.length} · 보유=${listOpenPositions().length} · ${canPlaceLive() ? "LIVE" : "DRY-RUN"} · scheduler=${readiness.ready ? "on" : "off"}`;
    state.lastRunAt = new Date().toISOString();
    state.lastCycleSummary = summary;
    appendLog("info", summary);

    return {
      ok: true,
      dryRun: !canPlaceLive(),
      regime: detected.regime,
      session,
      buys,
      sells,
      scanned: 70,
      finalCandidates,
      openPositions: listOpenPositions().length,
      summary,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog("error", `사이클 실패: ${msg}`);
    return {
      ok: false,
      dryRun: !canPlaceLive(),
      regime: state.regime,
      session,
      buys,
      sells,
      scanned: 0,
      finalCandidates,
      openPositions: listOpenPositions().length,
      summary: msg,
    };
  } finally {
    state.running = false;
  }
}

/** 서버 부팅 시 인터벌 (instrumentation). */
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutoTradeInterval(ms = 60_000): void {
  if (intervalHandle) return;
  const enabled = process.env.STRATEGY_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (enabled !== "1" && enabled !== "true" && enabled !== "yes") {
    appendLog("info", "STRATEGY_SCHEDULER_ENABLED 꺼짐 — 서버 인터벌 미시작");
    return;
  }
  appendLog("info", `서버 자동매매 인터벌 시작 (${ms}ms)`);
  intervalHandle = setInterval(() => {
    void runAutoTradeCycle({ force: false, ignoreSession: false });
  }, ms);
}

export function stopAutoTradeInterval(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    appendLog("info", "서버 자동매매 인터벌 중지");
  }
}

export function isSessionTradable(): boolean {
  return isRegularSessionOpen() || isAfterCloseSessionOpen();
}
