import { NextResponse } from "next/server";
import { getKisConfig, isLiveTradingEnabled } from "@/lib/kis/config";
import { fetchAccountCashSummary } from "@/lib/kis/balance";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireTraderAuth(req);
    const config = getKisConfig();
    const cash = await fetchAccountCashSummary();
    return NextResponse.json({
      ok: true,
      liveEnabled: isLiveTradingEnabled(),
      baseUrl: config.baseUrl,
      canoMasked: config.cano ? `${config.cano.slice(0, 2)}****${config.cano.slice(-2)}` : null,
      maxOrderWon: config.maxOrderWon,
      maxDailyOrderWon: config.maxDailyOrderWon,
      cash: {
        ok: cash.ok,
        orderableCashWon: cash.orderableCashWon,
        depositWon: cash.depositWon,
        source: cash.source,
        asOf: cash.asOf,
        error: cash.error ?? null,
        message:
          cash.ok && (cash.orderableCashWon ?? 0) <= 0
            ? "주문가능 현금이 0원입니다. 입금 후 매수하세요."
            : cash.ok
              ? null
              : cash.error || "잔고 조회 실패",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "account failed" },
      { status: 500 },
    );
  }
}
