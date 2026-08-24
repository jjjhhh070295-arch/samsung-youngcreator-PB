import { NextResponse } from "next/server";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import {
  DuplicateOrderError,
  listOrdersForUser,
  placeOrderViaKis,
  enforceRegimeBuyGate,
} from "@/lib/trading/orders";
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

export async function GET(req: Request) {
  try {
    const user = await requireTraderAuth(req);
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" },
        { status: 403 },
      );
    }
    const orders = listOrdersForUser(user.id);
    return NextResponse.json({ ok: true, orders });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "list failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireTraderAuth(req);
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" },
        { status: 403 },
      );
    }

    const body = (await req.json()) as Body;
    if (body.side === "buy" && body.confirmPhrase?.trim() !== "실주문") {
      return NextResponse.json(
        { ok: false, error: "확인 문구 「실주문」이 필요합니다", code: "CONFIRM_REQUIRED" },
        { status: 400 },
      );
    }

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
    const order = await placeOrderViaKis({ ...body, quantity: qty, userId: user.id });
    return NextResponse.json({ ok: true, order, regime: gate });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof DuplicateOrderError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: "DUPLICATE", order: error.existing },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "order failed" },
      { status: 400 },
    );
  }
}
