import { NextResponse } from "next/server";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { cancelOrderViaKis, getOrderById } from "@/lib/trading/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const user = await requireTraderAuth(req);
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" },
        { status: 403 },
      );
    }

    const existing = getOrderById(context.params.id);
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const order = await cancelOrderViaKis(context.params.id);
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "cancel failed" },
      { status: 400 },
    );
  }
}
