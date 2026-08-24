import { NextResponse } from "next/server";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { previewOrder, enforceRegimeBuyGate } from "@/lib/trading/orders";
import type { CompletedBar } from "@/lib/strategy/threeBullTwoBear";
import type { PreviewOrderInput } from "@/lib/trading/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = PreviewOrderInput & {
  stockBars?: CompletedBar[];
  openCount?: number;
  allocatedWon?: number;
  dayChangePct?: number | null;
  confirmPhrase?: string;
};

export async function POST(req: Request) {
  try {
    await requireTraderAuth(req);
    const body = (await req.json()) as Body;

    const gate = await enforceRegimeBuyGate({
      side: body.side,
      symbol: body.symbol,
      quantity: body.quantity,
      price: body.price,
      stockBars: body.stockBars,
      openCount: body.openCount,
      allocatedWon: body.allocatedWon,
      dayChangePct: body.dayChangePct,
    });
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error, code: gate.code, regime: gate },
        { status: 403 },
      );
    }

    const qty = gate.allowedQuantity ?? body.quantity;
    const result = previewOrder({ ...body, quantity: qty });
    if (!result.ok) {
      const status = result.code === "LIVE_DISABLED" ? 403 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json({ ...result, regime: gate });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "preview failed" },
      { status: 500 },
    );
  }
}
