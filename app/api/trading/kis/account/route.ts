import { NextResponse } from "next/server";
import { getKisConfig, isLiveTradingEnabled } from "@/lib/kis/config";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireTraderAuth(req);
    const config = getKisConfig();
    return NextResponse.json({
      ok: true,
      liveEnabled: isLiveTradingEnabled(),
      baseUrl: config.baseUrl,
      canoMasked: config.cano ? `${config.cano.slice(0, 2)}****${config.cano.slice(-2)}` : null,
      maxOrderWon: config.maxOrderWon,
      maxDailyOrderWon: config.maxDailyOrderWon,
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
