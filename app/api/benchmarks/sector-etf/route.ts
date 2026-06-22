import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 86400; // 24h cache — sector ETF daily close is sufficient

const UA = "Mozilla/5.0 macro-stress/2.0";
const LOOKBACK_MONTHS = 13;

interface PricePoint { month: string; price: number; }

async function yahooMonthly(symbol: string): Promise<PricePoint[]> {
  const p2 = Math.floor(Date.now() / 1000);
  const p1 = Math.floor(new Date(Date.now() - 14 * 30 * 24 * 3600 * 1000).getTime() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=1mo&events=history`;
  const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = await res.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: no chart data`);
  const timestamps: number[] = result.timestamp ?? [];
  const prices: number[] =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((ts, i) => ({ month: new Date(ts * 1000).toISOString().slice(0, 7), price: Number(prices[i]) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
}

function toCumulativePcts(points: PricePoint[]): number[] {
  const sorted = [...points].sort((a, b) => a.month.localeCompare(b.month)).slice(-LOOKBACK_MONTHS);
  if (sorted.length < 2) return [];
  const base = sorted[0].price;
  return sorted.map((p) => Math.round((p.price / base - 1) * 1000) / 10);
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers 파라미터가 필요합니다." }, { status: 400 });
  }

  const data: Record<string, number[] | null> = {};
  await Promise.allSettled(
    tickers.map(async (ticker) => {
      try {
        const pts = await yahooMonthly(ticker);
        data[ticker] = toCumulativePcts(pts);
      } catch {
        data[ticker] = null;
      }
    }),
  );

  return NextResponse.json({ data });
}
