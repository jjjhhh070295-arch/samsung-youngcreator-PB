import { NextResponse } from "next/server";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { getAutoTraderState, setArmed } from "@/lib/strategy/positionStore";
import { isLiveTradingEnabled } from "@/lib/kis/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireTraderAuth(req);
    const state = getAutoTraderState();
    return NextResponse.json({
      ok: true,
      kisLiveEnabled: isLiveTradingEnabled(),
      state: {
        armed: state.armed,
        liveArmed: state.liveArmed,
        lastRunAt: state.lastRunAt,
        lastCycleSummary: state.lastCycleSummary,
        running: state.running,
        positions: state.positions.slice(0, 50),
        logs: state.logs.slice(0, 40),
        openCount: state.positions.filter((p) =>
          ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED"].includes(p.state),
        ).length,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "status failed" }, { status: 500 });
  }
}

/** POST { armed, liveArmed? } */
export async function POST(req: Request) {
  try {
    await requireTraderAuth(req);
    const body = (await req.json()) as { armed?: boolean; liveArmed?: boolean };
    const armed = Boolean(body.armed);
    const liveArmed = Boolean(body.liveArmed);
    if (liveArmed && !isLiveTradingEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          error: "KIS_LIVE_TRADING_ENABLED=false — live 무장 불가. dry-run만 가능",
          code: "LIVE_DISABLED",
        },
        { status: 403 },
      );
    }
    const state = setArmed(armed, liveArmed);
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "arm failed" }, { status: 500 });
  }
}
