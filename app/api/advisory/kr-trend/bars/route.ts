import { NextRequest, NextResponse } from "next/server";
import { fetchKisOhlcBars } from "@/lib/advisory/krGainers";

export const dynamic = "force-dynamic";

/** 단일/복수 종목 OHLC — ticker= 또는 tickers= */
export async function GET(req: NextRequest) {
  const single = req.nextUrl.searchParams.get("ticker")?.trim() ?? "";
  const tickersParam = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = [
    ...(single && /^\d{6}$/.test(single) ? [single] : []),
    ...tickersParam
      .split(",")
      .map((t) => t.trim())
      .filter((t) => /^\d{6}$/.test(t)),
  ];
  const unique = Array.from(new Set(tickers));

  if (unique.length === 0) {
    return NextResponse.json({ ok: false, error: "ticker 또는 tickers 필요" }, { status: 400 });
  }

  try {
    const lookback = Math.min(400, Math.max(60, Number(req.nextUrl.searchParams.get("days") ?? 80) || 80));
    if (unique.length === 1) {
      const { bars, asOf, source, name } = await fetchKisOhlcBars(unique[0]!, lookback);
      return NextResponse.json({
        ok: true,
        ticker: unique[0],
        name,
        asOf,
        source,
        bars,
      });
    }

    const series = await Promise.all(
      unique.map(async (ticker) => {
        const { bars, asOf, source, name } = await fetchKisOhlcBars(ticker, lookback);
        return { ticker, name, asOf, source, bars };
      }),
    );
    return NextResponse.json({ ok: true, series });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "OHLC 조회 실패" },
      { status: 500 },
    );
  }
}
