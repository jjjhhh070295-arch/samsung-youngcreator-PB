import { NextResponse } from "next/server";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { isHeartbeatFresh } from "@/lib/worker/heartbeat";
import { resolveTradingCalendar } from "@/lib/market/calendar";
import { detectMarketSessions } from "@/lib/market/sessions";
import { evaluateLiveSafety } from "@/lib/worker/safety";
import { getConfiguredExchangeMode } from "@/lib/kis/exchange";
import { isTraderDbConfigured } from "@/lib/db/client";
import type { NextAction } from "@/lib/help/manualContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireTraderAuth(req);
    const worker = await isHeartbeatFresh();
    const calendar = await resolveTradingCalendar({
      allowHeuristicFallback: process.env.TRADING_DEMO_MODE === "true",
    });
    const session = detectMarketSessions(new Date(), {
      isTradingDay: calendar.ok && calendar.isTradingDay,
    });
    const live = evaluateLiveSafety({
      liveArmedDb: false,
      emergencyStop: true,
      heartbeatOk: worker.ok,
      calendar,
      accountSynced: false,
      reconciliationRequired: false,
      maxDailyLossWon: 0,
      maxOrderWon: 0,
      maxDailyOrders: 0,
    });

    let nextAction: NextAction = "CHECK_WORKER";
    if (!worker.ok) nextAction = "CHECK_WORKER";
    else if (!calendar.ok) nextAction = "CHECK_SAFETY";
    else if (!live.allowLiveOrders) nextAction = "CHECK_SAFETY";
    else nextAction = "RUNNING_OK";

    return NextResponse.json({
      ok: true,
      worker,
      calendar,
      session,
      live,
      exchangeMode: getConfiguredExchangeMode(),
      dbConfigured: isTraderDbConfigured(),
      browserIndependent: true,
      nextAction,
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json({ ok: false, error: "admin status failed" }, { status: 500 });
  }
}
