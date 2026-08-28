/**
 * Independent worker cycle backed by the trader DB.
 * The strategy uses price signals only:
 * - buy: 3+ consecutive bullish completed bars, all KIS no-margin buying power
 * - sell: 2+ consecutive bearish completed bars, all KIS sellable shares
 */

import type { CalendarSnapshot } from "@/lib/market/calendar";
import type { SessionSnapshot } from "@/lib/market/sessions";
import { getTraderDb } from "@/lib/db/client";
import { detectBuySignal, detectSellSignal, STRATEGY_ID } from "@/lib/strategy/threeBullTwoBear";
import { fetchKoreanTopGainers, fetchKisOhlcBars, mapPool } from "@/lib/advisory/krGainers";
import { evaluateTechnicalFilters } from "@/lib/advisory/krTrendFilter";
import { selectTopKrStocksByMarketCap } from "@/lib/advisory/selectTopKrStocks";
import { MAX_SELECTED_KR_STOCKS } from "@/lib/advisory/krConstants";
import { isTradingDemoMode, demoThemePass } from "@/lib/advisory/demoScreen";
import { buildIdempotencyKey } from "@/lib/db/locks";
import { insertOrderIfNew, updateOrderStatus } from "@/lib/db/ordersRepo";
import { seoulDateKey } from "@/lib/market/calendar";
import { resolveExchangeRoute, getConfiguredExchangeMode } from "@/lib/kis/exchange";
import { fetchAccountCashSummary, fetchKisHoldings, type KisHolding } from "@/lib/kis/balance";
import { placeOrderViaKis } from "@/lib/trading/orders";
import { evaluateLiveSafety } from "./safety";
import { isHeartbeatFresh } from "./heartbeat";

export interface CycleResult {
  ok: boolean;
  dryRun: boolean;
  summary: string;
  buys: number;
  sells: number;
}

interface DbPosition {
  id: string;
  ticker: string;
  name: string;
  quantity: number;
  average_entry_price: number;
  current_state: string;
  dry_run: boolean;
}

function dryRunCashDefault(): number {
  const value = Number(process.env.STRATEGY_DRY_RUN_CASH_WON ?? 1_000_000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1_000_000;
}

async function loadAdminSettings() {
  const db = getTraderDb();
  if (!db) {
    return {
      live_armed: false,
      emergency_stop: true,
      max_daily_loss_won: 0,
      max_order_won: 0,
      max_daily_orders: 0,
      exchange_mode: getConfiguredExchangeMode(),
    };
  }
  const { data } = await db.from("trading_admin_settings").select("*").eq("id", 1).maybeSingle();
  return data ?? {
    live_armed: false,
    emergency_stop: true,
    max_daily_loss_won: 0,
    max_order_won: 0,
    max_daily_orders: 0,
    exchange_mode: "SOR",
  };
}

function orderDivision(session: SessionSnapshot["session"]): "00" | "06" {
  return session === "NXT_AFTER" ? "06" : "00";
}

export async function runWorkerCycle(input: {
  workerId: string;
  calendar: CalendarSnapshot;
  session: SessionSnapshot;
  minutes: number;
}): Promise<CycleResult> {
  const admin = await loadAdminSettings();
  const hb = await isHeartbeatFresh();
  const safety = evaluateLiveSafety({
    liveArmedDb: Boolean(admin.live_armed),
    emergencyStop: admin.emergency_stop !== false,
    heartbeatOk: hb.ok || process.env.TRADING_DEMO_MODE === "true",
    calendar: input.calendar,
    accountSynced: true,
    reconciliationRequired: false,
    maxDailyLossWon: Number(admin.max_daily_loss_won ?? 0),
    maxOrderWon: Number(admin.max_order_won ?? 0),
    maxDailyOrders: Number(admin.max_daily_orders ?? 0),
  });

  const dryRun = !safety.allowLiveOrders;
  const db = getTraderDb();

  if (db) {
    await db.from("trading_cycle_runs").insert({
      ok: null,
      dry_run: dryRun,
      session: input.session.session,
      summary: "started",
      meta: { workerId: input.workerId, safety, strategy: "FULL_CASH" },
    });
  }

  if (!input.calendar.ok || !input.calendar.isTradingDay) {
    return {
      ok: true,
      dryRun: true,
      summary: `휴장/달력실패 — 주문 없음 (${input.calendar.reason})`,
      buys: 0,
      sells: 0,
    };
  }

  if (!input.session.krxOfficialCloseConfirmed && process.env.ALLOW_INTRADAY_SIGNALS !== "true") {
    return {
      ok: true,
      dryRun,
      summary: `세션=${input.session.session} · 종가 미확정 — 3양봉/2음봉 신호 보류`,
      buys: 0,
      sells: 0,
    };
  }

  const tradingDay = seoulDateKey();
  const strategyVersion = `${STRATEGY_ID}@2-FULL-CASH`;
  const route = resolveExchangeRoute({
    mode: (admin.exchange_mode as "KRX" | "NXT" | "SOR") || getConfiguredExchangeMode(),
    nxtEligible: true,
  });
  const ordDvsn = orderDivision(input.session.session);

  let positions: DbPosition[] = [];
  if (db) {
    const { data, error } = await db
      .from("trading_positions")
      .select("id,ticker,name,quantity,average_entry_price,current_state,dry_run")
      .in("current_state", ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED", "SELL_SUBMITTED", "EXIT_PARTIALLY_FILLED"]);
    if (error) {
      return {
        ok: false,
        dryRun: true,
        summary: `보유종목 조회 실패 — 주문 차단 (${error.message})`,
        buys: 0,
        sells: 0,
      };
    }
    positions = (data ?? []) as DbPosition[];
  }

  let liveHoldings: KisHolding[] = [];
  if (!dryRun) {
    const holdings = await fetchKisHoldings();
    if (!holdings.ok) {
      return {
        ok: false,
        dryRun: true,
        summary: `실제 보유수량 조회 실패 — 주문 차단 (${holdings.error})`,
        buys: 0,
        sells: 0,
      };
    }
    liveHoldings = holdings.holdings;
  }

  let sells = 0;
  for (const position of positions) {
    if (["SELL_SUBMITTED", "EXIT_PARTIALLY_FILLED"].includes(position.current_state)) continue;
    try {
      const { bars } = await fetchKisOhlcBars(position.ticker);
      const completed = bars.map((bar) => ({ date: bar.date, open: bar.open, close: bar.close }));
      const signal = detectSellSignal(completed, true);
      if (!signal.signal) continue;

      const holding = liveHoldings.find((row) => row.ticker === position.ticker);
      const quantity = dryRun ? position.quantity : holding?.sellableQty ?? 0;
      if (quantity < 1) continue;
      const price = completed.at(-1)?.close ?? 0;
      if (!(price > 0)) continue;
      const idem = buildIdempotencyKey({
        tradingDay,
        ticker: position.ticker,
        strategyVersion,
        signalKind: "TWO_BEAR_FULL_SELL",
        side: "sell",
      });

      let dbOrderId: string | null = null;
      if (db) {
        const inserted = await insertOrderIfNew({
          idempotency_key: idem,
          trading_day: tradingDay,
          ticker: position.ticker,
          side: "sell",
          signal_kind: "TWO_BEAR_FULL_SELL",
          strategy_version: strategyVersion,
          quantity,
          price,
          exchange_requested: route.requested,
          exchange_effective: route.effective,
          ord_dvsn: ordDvsn,
          status: "SIGNAL_CREATED",
        });
        if (!inserted.created || !inserted.order) continue;
        dbOrderId = inserted.order.id;
      }

      if (dryRun) {
        if (db && dbOrderId) {
          await updateOrderStatus(dbOrderId, { status: "ORDER_ACCEPTED" });
          await db.from("trading_positions").update({
            current_state: "CLOSED",
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", position.id);
        }
        sells += 1;
        continue;
      }

      if (db && dbOrderId) await updateOrderStatus(dbOrderId, { status: "ORDER_SUBMITTING" });
      try {
        const order = await placeOrderViaKis({
          symbol: position.ticker,
          side: "sell",
          quantity: 1,
          price,
          ordDvsn,
          excgIdDvsnCd: route.effective,
          userId: `worker:${input.workerId}`,
          strategyId: strategyVersion,
          idempotencyKey: idem,
          useAllSellableQuantity: true,
        });
        if (db && dbOrderId) {
          await updateOrderStatus(dbOrderId, {
            status: "ORDER_ACCEPTED",
            quantity: order.quantity,
            kis_order_no: order.kisOrderNo,
            kis_org_order_no: order.kisOrgOrderNo,
          });
          await db.from("trading_positions").update({
            current_state: "SELL_SUBMITTED",
            quantity: order.quantity,
            updated_at: new Date().toISOString(),
          }).eq("id", position.id);
        }
        sells += 1;
      } catch (error: unknown) {
        if (db && dbOrderId) {
          await updateOrderStatus(dbOrderId, {
            status: "FAILED",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch {
      // 한 종목 데이터 실패가 나머지 종목의 신호 계산을 막지 않는다.
    }
  }

  const screen = await fetchKoreanTopGainers(70);
  if (screen.status !== "ok") {
    return { ok: false, dryRun, summary: `스크리닝 실패: ${screen.message}`, buys: 0, sells };
  }

  const okCap = screen.gainers.filter((g) => g.marketCapStatus === "ok");
  const evaluated = await mapPool(okCap.slice(0, 30), 3, async (g) => {
    const { bars } = await fetchKisOhlcBars(g.ticker);
    const technical = evaluateTechnicalFilters(bars);
    if (!technical.passed) return null;
    if (isTradingDemoMode()) demoThemePass(g.name);
    return {
      ticker: g.ticker,
      name: g.name,
      price: g.price,
      changePct: g.changePct,
      marketCapWon: g.marketCapWon,
      bars,
    };
  });
  const finals = evaluated.filter(Boolean) as NonNullable<(typeof evaluated)[number]>[];
  const { selected } = selectTopKrStocksByMarketCap(finals, MAX_SELECTED_KR_STOCKS);

  const openTickers = new Set(positions.map((position) => position.ticker));
  for (const holding of liveHoldings) openTickers.add(holding.ticker);

  let remainingDryCash = 0;
  if (dryRun) {
    const cash = await fetchAccountCashSummary();
    remainingDryCash = cash.ok && (cash.orderableCashWon ?? 0) > 0
      ? cash.orderableCashWon!
      : dryRunCashDefault();
  }

  let buys = 0;
  for (const candidate of selected) {
    if (openTickers.has(candidate.ticker)) continue;
    const completed = candidate.bars.map((bar) => ({ date: bar.date, open: bar.open, close: bar.close }));
    const signal = detectBuySignal(completed);
    if (!signal.signal || !(candidate.price > 0)) continue;

    const requestedQty = dryRun ? Math.floor(remainingDryCash / candidate.price) : 1;
    if (requestedQty < 1) continue;
    const idem = buildIdempotencyKey({
      tradingDay,
      ticker: candidate.ticker,
      strategyVersion,
      signalKind: "THREE_BULL_FULL_CASH",
      side: "buy",
    });

    let dbOrderId: string | null = null;
    if (db) {
      const inserted = await insertOrderIfNew({
        idempotency_key: idem,
        trading_day: tradingDay,
        ticker: candidate.ticker,
        side: "buy",
        signal_kind: "THREE_BULL_FULL_CASH",
        strategy_version: strategyVersion,
        quantity: requestedQty,
        price: candidate.price,
        exchange_requested: route.requested,
        exchange_effective: route.effective,
        ord_dvsn: ordDvsn,
        status: "SIGNAL_CREATED",
      });
      if (!inserted.created || !inserted.order) continue;
      dbOrderId = inserted.order.id;
    }

    if (dryRun) {
      if (db && dbOrderId) {
        await updateOrderStatus(dbOrderId, { status: "ORDER_ACCEPTED" });
        await db.from("trading_positions").insert({
          ticker: candidate.ticker,
          name: candidate.name,
          quantity: requestedQty,
          average_entry_price: candidate.price,
          current_state: "OPEN",
          opened_at: new Date().toISOString(),
          buy_signal_date: tradingDay,
          exchange: route.effective,
          strategy_version: strategyVersion,
          dry_run: true,
        });
      }
      remainingDryCash = Math.max(0, remainingDryCash - requestedQty * candidate.price);
      openTickers.add(candidate.ticker);
      buys += 1;
      continue;
    }

    if (db && dbOrderId) await updateOrderStatus(dbOrderId, { status: "ORDER_SUBMITTING" });
    try {
      const order = await placeOrderViaKis({
        symbol: candidate.ticker,
        side: "buy",
        quantity: 1,
        price: candidate.price,
        ordDvsn,
        excgIdDvsnCd: route.effective,
        userId: `worker:${input.workerId}`,
        strategyId: strategyVersion,
        idempotencyKey: idem,
        useAllAvailableCash: true,
      });
      if (db && dbOrderId) {
        await updateOrderStatus(dbOrderId, {
          status: "ORDER_ACCEPTED",
          quantity: order.quantity,
          kis_order_no: order.kisOrderNo,
          kis_org_order_no: order.kisOrgOrderNo,
        });
        await db.from("trading_positions").insert({
          ticker: candidate.ticker,
          name: candidate.name,
          quantity: order.quantity,
          average_entry_price: candidate.price,
          current_state: "BUY_SUBMITTED",
          opened_at: new Date().toISOString(),
          buy_signal_date: tradingDay,
          exchange: route.effective,
          kis_order_number: order.kisOrderNo,
          strategy_version: strategyVersion,
          dry_run: false,
        });
      }
      openTickers.add(candidate.ticker);
      buys += 1;
    } catch (error: unknown) {
      if (db && dbOrderId) {
        await updateOrderStatus(dbOrderId, {
          status: "FAILED",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const summary = `3양봉 전액매수/2음봉 전량매도 · 세션=${input.session.session} · 매수=${buys} · 매도=${sells} · ${dryRun ? "DRY-RUN" : "LIVE"} · safety=${safety.allowLiveOrders ? "ok" : safety.reasons[0]}`;
  return { ok: true, dryRun, summary, buys, sells };
}
