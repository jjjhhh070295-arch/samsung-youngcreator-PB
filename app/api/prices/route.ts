import { NextRequest, NextResponse } from "next/server";
import { KisProvider } from "@/lib/pricing/kis-provider";

export const runtime = "nodejs";

const provider = new KisProvider();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tickers: { ticker: string; currency: "KRW" | "USD" }[] = body.tickers ?? [];
  const skipCache = body.skipCache === true || body.fresh === true;

  // FX만 필요한 경우(빈 tickers)도 연결 상태를 반환한다.
  if (tickers.length === 0) {
    const kisConfigured = !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
    if (!kisConfigured) {
      return NextResponse.json({ quotes: [], fxUsdKrw: 1350, connected: false });
    }
    try {
      const fxUsdKrw = await provider.getFxUsdKrw();
      return NextResponse.json({ quotes: [], fxUsdKrw, connected: true });
    } catch {
      return NextResponse.json({ quotes: [], fxUsdKrw: 1350, connected: false });
    }
  }

  const kisConfigured = !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);

  if (!kisConfigured) {
    return NextResponse.json({
      quotes: tickers.map((t) => ({
        ticker: t.ticker,
        price: null,
        currency: t.currency,
        stale: true,
        error_code: "KIS_NOT_CONFIGURED",
        error_message: "KIS 자격증명이 없습니다.",
      })),
      fxUsdKrw: 1350,
      connected: false,
    });
  }

  try {
    const [quotes, fxUsdKrw] = await Promise.all([
      provider.getQuotes(tickers, { skipCache }),
      provider.getFxUsdKrw(),
    ]);
    return NextResponse.json({ quotes, fxUsdKrw, connected: true });
  } catch (err) {
    console.error("[prices] KIS fetch error:", err);
    return NextResponse.json({
      quotes: tickers.map((t) => ({
        ticker: t.ticker,
        price: null,
        currency: t.currency,
        stale: true,
        error_code: "FETCH_ERROR",
        error_message: err instanceof Error ? err.message : "KIS fetch error",
      })),
      fxUsdKrw: 1350,
      connected: false,
    });
  }
}
