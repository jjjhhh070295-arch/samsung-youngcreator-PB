import { NextRequest, NextResponse } from "next/server";
import { fetchNaverOhlcBars, mapPool } from "@/lib/advisory/krGainers";

export const dynamic = "force-dynamic";

/** PB 확정 종목 OHLC 일봉 — 성과지표·백테스트 재계산용 */
export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d{6}$/.test(t));

  if (tickers.length === 0) {
    return NextResponse.json({ ok: false, error: "tickers 필요 (예: 005930,000660)" }, { status: 400 });
  }

  try {
    const lookback = Math.min(400, Math.max(80, Number(req.nextUrl.searchParams.get("days") ?? 260) || 260));
    const results = await mapPool(tickers, 3, async (ticker) => {
      const { bars, asOf, source, name } = await fetchNaverOhlcBars(ticker, lookback);
      return {
        ticker,
        name,
        asOf,
        source,
        currency: "KRW" as const,
        closes: bars.map((b) => ({ date: b.date, close: b.close })),
      };
    });

    const blocked = results.filter((r) => r.closes.length < 2);
    return NextResponse.json({
      ok: true,
      asOf: new Date().toISOString(),
      source: "api.stock.naver.com chart/domestic",
      currency: "KRW",
      series: results,
      blockedTickers: blocked.map((b) => b.ticker),
      status: blocked.length === results.length ? "blocked" : blocked.length ? "review" : "ok",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "OHLC 조회 실패" },
      { status: 500 },
    );
  }
}
