import { NextRequest, NextResponse } from "next/server";
import { KisProvider } from "@/lib/pricing/kis-provider";

const provider = new KisProvider();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const tickers: { ticker: string; currency: "KRW" | "USD" }[] = body.tickers ?? [];

  if (tickers.length === 0) {
    return NextResponse.json({ quotes: [], fxUsdKrw: 1350, connected: false });
  }

  const kisConfigured = !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);

  if (!kisConfigured) {
    return NextResponse.json({
      quotes: tickers.map((t) => ({ ticker: t.ticker, price: null, currency: t.currency, stale: true })),
      fxUsdKrw: 1350,
      connected: false,
    });
  }

  try {
    const [quotes, fxUsdKrw] = await Promise.all([
      provider.getQuotes(tickers),
      provider.getFxUsdKrw(),
    ]);
    return NextResponse.json({ quotes, fxUsdKrw, connected: true });
  } catch (err) {
    console.error("[prices] KIS fetch error:", err);
    return NextResponse.json({
      quotes: tickers.map((t) => ({ ticker: t.ticker, price: null, currency: t.currency, stale: true })),
      fxUsdKrw: 1350,
      connected: false,
    });
  }
}
