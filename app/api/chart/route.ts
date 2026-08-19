import { NextResponse } from "next/server";
import { fetchNaverKospiIntraday, type HomeChartResult } from "@/lib/homeMarketChart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function fetchIntraday(symbol: string): Promise<HomeChartResult> {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`,
    { headers: { "user-agent": UA }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`${symbol} ${res.status}`);
  const j: any = await res.json();
  const result = j?.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
  const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose) || null;
  const delayMinutes = Number(meta.exchangeDataDelayedBy ?? 0);

  const toKST = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });

  const points = timestamps
    .map((ts, i) => ({
      time: toKST(ts),
      value: closes[i],
    }))
    .filter((d) => d.value != null && isFinite(d.value));

  const validTs = timestamps.filter((_, i) => closes[i] != null && isFinite(closes[i]));
  const startTime = validTs.length > 0 ? toKST(validTs[0]) : null;
  const endTime = validTs.length > 0 ? toKST(validTs[validTs.length - 1]) : null;

  return { points, prevClose, delayMinutes, startTime, endTime };
}

async function fetchKospiIntraday() {
  try {
    return await fetchNaverKospiIntraday();
  } catch {
    return fetchIntraday("^KS11");
  }
}

export async function GET() {
  const [kospi, spx] = await Promise.allSettled([
    fetchKospiIntraday(),
    fetchIntraday("^GSPC"),
  ]);

  return NextResponse.json({
    kospi: kospi.status === "fulfilled" ? kospi.value : { points: [], prevClose: null, delayMinutes: 0, startTime: null, endTime: null },
    spx: spx.status === "fulfilled" ? spx.value : { points: [], prevClose: null, delayMinutes: 0, startTime: null, endTime: null },
  });
}
