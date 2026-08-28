import { NextResponse } from "next/server";
import { fetchKisOpenOrders } from "@/lib/kis/openOrders";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireTraderAuth(req);
    const orders = await fetchKisOpenOrders();
    return NextResponse.json({ ok: true, orders, count: orders.length });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "미체결 조회 실패" },
      { status: 500 },
    );
  }
}
