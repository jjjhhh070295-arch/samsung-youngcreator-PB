import { NextResponse } from "next/server";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import {
  DuplicateOrderError,
  listOrdersForUser,
  placeOrderViaKis,
} from "@/lib/trading/orders";
import type { PreviewOrderInput } from "@/lib/trading/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = PreviewOrderInput & { confirmPhrase?: string };

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

    const order = await placeOrderViaKis({
      ...body,
      quantity: Math.max(1, body.quantity),
      userId: user.id,
      useAllAvailableCash: body.side === "buy",
      useAllSellableQuantity: body.side === "sell",
    });
    return NextResponse.json({
      ok: true,
      order,
      allocationMode: body.side === "buy" ? "ALL_AVAILABLE_CASH" : "ALL_SELLABLE_SHARES",
    });
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
