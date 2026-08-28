import { NextResponse } from "next/server";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { isLiveTradingEnabled } from "@/lib/kis/config";
import { fetchKisHoldings, fetchMaxBuyQty } from "@/lib/kis/balance";
import type { PreviewOrderInput } from "@/lib/trading/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = PreviewOrderInput;

export async function POST(req: Request) {
  try {
    await requireTraderAuth(req);
    const body = (await req.json()) as Body;
    if (!isLiveTradingEnabled()) {
      return NextResponse.json(
        { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" },
        { status: 403 },
      );
    }

    if (body.side === "buy") {
      const available = await fetchMaxBuyQty({
        symbol: body.symbol,
        price: body.price,
        ordDvsn: body.ordDvsn,
      });
      if (!available.ok || (available.maxQty ?? 0) < 1) {
        return NextResponse.json(
          { ok: false, error: available.error || "한투 기준 매수가능수량이 0주입니다" },
          { status: 400 },
        );
      }
      const quantity = available.maxQty!;
      return NextResponse.json({
        ok: true,
        allocationMode: "ALL_AVAILABLE_CASH",
        preview: {
          symbol: body.symbol,
          side: body.side,
          quantity,
          price: body.price,
          estimatedWon: quantity * body.price,
          orderableCashWon: available.orderableCashWon ?? available.maxAmt,
        },
      });
    }

    const holdings = await fetchKisHoldings();
    const holding = holdings.holdings.find((row) => row.ticker === body.symbol.trim());
    if (!holdings.ok || !holding || holding.sellableQty < 1) {
      return NextResponse.json(
        { ok: false, error: holdings.error || "한투 기준 매도 주문가능수량이 0주입니다" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      allocationMode: "ALL_SELLABLE_SHARES",
      preview: {
        symbol: body.symbol,
        side: body.side,
        quantity: holding.sellableQty,
        price: body.price,
        estimatedWon: holding.sellableQty * body.price,
      },
    });
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
