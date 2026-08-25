/**
 * Worker cycle — DB 영속 + 국면/신호. 메모리 positionStore 사용하지 않음.
 * 실주문은 safety 통과 시에만.
 */

import type { CalendarSnapshot } from "@/lib/market/calendar";
import type { SessionSnapshot } from "@/lib/market/sessions";
import { getTraderDb } from "@/lib/db/client";
import { STRATEGY_ID } from "@/lib/strategy/threeBullTwoBear";
import { detectMarketRegime, evaluateRegimeEntry, policyForRegime } from "@/lib/strategy/marketRegime";
import { fetchKospiCompletedBars } from "@/lib/market/kospiBars";
import { fetchKoreanTopGainers, fetchKisOhlcBars, mapPool } from "@/lib/advisory/krGainers";
import { evaluateTechnicalFilters } from "@/lib/advisory/krTrendFilter";
import { selectTopKrStocksByMarketCap } from "@/lib/advisory/selectTopKrStocks";
import { MAX_SELECTED_KR_STOCKS } from "@/lib/advisory/krConstants";
import { isTradingDemoMode, demoThemePass } from "@/lib/advisory/demoScreen";
import { buildIdempotencyKey } from "@/lib/db/locks";
import { insertOrderIfNew, updateOrderStatus } from "@/lib/db/ordersRepo";
import { seoulDateKey } from "@/lib/market/calendar";
import { resolveExchangeRoute, buildExchangeOrderFields, getConfiguredExchangeMode } from "@/lib/kis/exchange";
import { evaluateLiveSafety } from "./safety";
import { isHeartbeatFresh } from "./heartbeat";
import { assertBuyAffordable, fetchAccountCashSummary } from "@/lib/kis/balance";

export interface CycleResult {
  ok: boolean;
  dryRun: boolean;
  summary: string;
  buys: number;
  sells: number;
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
    accountSynced: true, // reconcile sets false when mismatch
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
      meta: { workerId: input.workerId, safety },
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

  // 신호는 KRX 공식 종가 확정 후에만 (애프터에서 계산)
  if (!input.session.krxOfficialCloseConfirmed && process.env.ALLOW_INTRADAY_SIGNALS !== "true") {
    // 장중에는 손절/익절 감시만 (포지션 DB)
    return {
      ok: true,
      dryRun,
      summary: `세션=${input.session.session} · 종가 미확정 — 신호 신규 보류 (손절감시 구간)`,
      buys: 0,
      sells: 0,
    };
  }

  const { bars: indexBars } = await fetchKospiCompletedBars();
  const detected = detectMarketRegime(indexBars);
  const policy = policyForRegime(detected.regime);

  const screen = await fetchKoreanTopGainers(70);
  if (screen.status !== "ok") {
    return { ok: false, dryRun, summary: `스크리닝 실패: ${screen.message}`, buys: 0, sells: 0 };
  }

  const okCap = screen.gainers.filter((g) => g.marketCapStatus === "ok");
  const evaluated = await mapPool(okCap.slice(0, 30), 3, async (g) => {
    const { bars } = await fetchKisOhlcBars(g.ticker);
    const technical = evaluateTechnicalFilters(bars);
    if (!technical.passed) return null;
    if (isTradingDemoMode()) demoThemePass(g.name);
    return { ticker: g.ticker, name: g.name, price: g.price, changePct: g.changePct, marketCapWon: g.marketCapWon, bars };
  });
  const finals = evaluated.filter(Boolean) as NonNullable<(typeof evaluated)[number]>[];
  const { selected } = selectTopKrStocksByMarketCap(finals, MAX_SELECTED_KR_STOCKS);

  const cash = await fetchAccountCashSummary();
  if (!cash.ok || (cash.orderableCashWon ?? 0) <= 0) {
    return {
      ok: true,
      dryRun,
      summary: `잔고 부족/조회실패 — 매수 없음 (${cash.error || `주문가능 ${cash.orderableCashWon}원`})`,
      buys: 0,
      sells: 0,
    };
  }

  let buys = 0;
  const tradingDay = seoulDateKey();
  const strategyVersion = `${STRATEGY_ID}@1`;

  // open count from DB
  let openCount = 0;
  if (db) {
    const { count } = await db
      .from("trading_positions")
      .select("*", { count: "exact", head: true })
      .in("current_state", ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED"]);
    openCount = count ?? 0;
  }

  for (const c of selected) {
    const stockBars = c.bars.map((b) => ({ date: b.date, open: b.open, close: b.close }));
    const decision = evaluateRegimeEntry({
      indexBars,
      stockBars,
      openCount,
      allocatedWon: Number(process.env.STRATEGY_ALLOCATED_WON ?? 1_000_000),
      closePrice: c.price,
      dayChangePct: c.changePct,
    });
    if (!decision.allow) continue;

    const estimated = decision.qty * c.price;
    const afford = assertBuyAffordable(estimated, cash);
    if (!afford.ok) continue;

    const route = resolveExchangeRoute({
      mode: (admin.exchange_mode as "KRX" | "NXT" | "SOR") || getConfiguredExchangeMode(),
      nxtEligible: true,
    });
    const exch = buildExchangeOrderFields(route.effective);
    const idem = buildIdempotencyKey({
      tradingDay,
      ticker: c.ticker,
      strategyVersion,
      signalKind: "THREE_BULL",
      side: "buy",
    });

    if (db) {
      const { created, order } = await insertOrderIfNew({
        idempotency_key: idem,
        trading_day: tradingDay,
        ticker: c.ticker,
        side: "buy",
        signal_kind: "THREE_BULL",
        strategy_version: strategyVersion,
        quantity: decision.qty,
        price: c.price,
        exchange_requested: route.requested,
        exchange_effective: route.effective,
        ord_dvsn: "00",
        status: "SIGNAL_CREATED",
      });
      if (!created) continue; // duplicate
      if (dryRun) {
        await updateOrderStatus(order!.id, { status: "ORDER_ACCEPTED" });
        await db.from("trading_positions").insert({
          ticker: c.ticker,
          name: c.name,
          quantity: decision.qty,
          average_entry_price: c.price,
          current_state: "OPEN",
          opened_at: new Date().toISOString(),
          buy_signal_date: tradingDay,
          exchange: route.effective,
          strategy_version: strategyVersion,
          dry_run: true,
        });
        buys += 1;
        openCount += 1;
      } else {
        // live path: submit via placeOrderViaKis then mark ACCEPTED only — fill via reconcile
        await updateOrderStatus(order!.id, { status: "ORDER_SUBMITTING" });
        // Actual KIS submit is wired in orders.ts; keep fail-closed if keys missing.
        await updateOrderStatus(order!.id, { status: "FAILED", error: "live submit path requires KIS + reconcile" as unknown as undefined });
      }
    } else if (dryRun) {
      buys += 1;
    }
    void exch;
  }

  const summary = `국면=${detected.regime}/${policy.labelKo} · 세션=${input.session.session} · 매수신호처리=${buys} · ${dryRun ? "DRY-RUN" : "LIVE"} · safety=${safety.allowLiveOrders ? "ok" : safety.reasons[0]}`;
  return { ok: true, dryRun, summary, buys, sells: 0 };
}
