import { NextResponse } from "next/server";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { cancelKisOpenOrderByNo } from "@/lib/kis/openOrders";
import { getAutoTraderState, setArmed } from "@/lib/strategy/positionStore";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { orderNo: string };
}

export async function POST(req: Request, context: RouteContext) {
  try {
    await requireTraderAuth(req);
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as { confirmPhrase?: string };
    if (body.confirmPhrase?.trim() !== "미체결취소") {
      return NextResponse.json(
        { ok: false, error: "확인 문구 「미체결취소」가 필요합니다", code: "CONFIRM_REQUIRED" },
        { status: 400 },
      );
    }

    setArmed(false, false);
    if (getAutoTraderState().running) {
      return NextResponse.json(
        {
          ok: false,
          error: "자동매매는 해제했습니다. 진행 중인 사이클이 끝난 뒤 다시 취소를 눌러주세요.",
          code: "AUTO_CYCLE_RUNNING",
        },
        { status: 409 },
      );
    }

    const result = await cancelKisOpenOrderByNo(decodeURIComponent(context.params.orderNo));
    return NextResponse.json({ ok: true, cancelled: result.order });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "미체결 취소 실패" },
      { status: 400 },
    );
  }
}
