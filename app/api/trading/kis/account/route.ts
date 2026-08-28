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
        totalEvaluationWon: cash.totalEvaluationWon,
        securitiesEvaluationWon: cash.securitiesEvaluationWon,
        evaluationPnlWon: cash.evaluationPnlWon,
        purchaseAmountWon: cash.purchaseAmountWon,
        netAssetWon: cash.netAssetWon,
        source: cash.source,
        asOf: cash.asOf,
        error: cash.error ?? null,
        message:
          cash.ok && (cash.orderableCashWon ?? 0) <= 0
            ? "현금 잔고가 0원입니다. 실제 매수가능수량은 주문 직전에 종목별로 확인합니다."
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
