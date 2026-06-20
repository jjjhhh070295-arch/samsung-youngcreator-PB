import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

type MacroLevel = {
  value: number;
  asOf: string;
  source: string;
};

async function yahooLatest(symbol: string): Promise<MacroLevel> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
    { headers: { "user-agent": UA }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Yahoo ${symbol}: ${response.status}`);
  const payload: any = await response.json();
  const result = payload?.chart?.result?.[0];
  const value = Number(result?.meta?.regularMarketPrice);
  const timestamp = Number(result?.meta?.regularMarketTime);
  if (!Number.isFinite(value)) throw new Error(`Yahoo ${symbol}: no value`);
  return {
    value,
    asOf: Number.isFinite(timestamp)
      ? new Date(timestamp * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    source: `Yahoo Finance ${symbol}`,
  };
}

async function fredSeries(seriesId: string): Promise<Array<{ date: string; value: number }>> {
  const response = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`,
    { headers: { "user-agent": UA }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`FRED ${seriesId}: ${response.status}`);
  const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
  return rows
    .map((row) => {
      const [date, raw] = row.split(",");
      return { date, value: Number(raw) };
    })
    .filter((row) => row.date && Number.isFinite(row.value));
}

async function fredLatest(seriesId: string): Promise<MacroLevel> {
  const rows = await fredSeries(seriesId);
  const latest = rows[rows.length - 1];
  if (!latest) throw new Error(`FRED ${seriesId}: no value`);
  return { value: latest.value, asOf: latest.date, source: `FRED ${seriesId}` };
}

async function latestInflationYoY(): Promise<MacroLevel> {
  const rows = await fredSeries("CPIAUCSL");
  if (rows.length < 13) throw new Error("FRED CPIAUCSL: insufficient history");
  const latest = rows[rows.length - 1];
  const yearAgo = rows[rows.length - 13];
  const value = (latest.value / yearAgo.value - 1) * 100;
  return { value, asOf: latest.date, source: "FRED CPIAUCSL 전년동월비" };
}

export async function GET() {
  const requests = {
    d_fed: fredLatest("DFEDTARU"),
    d_ust: yahooLatest("^TNX"),
    infl: latestInflationYoY(),
    ret_krw: yahooLatest("KRW=X"),
    ret_cmd: yahooLatest("GSG"),
  };

  const entries = await Promise.all(
    Object.entries(requests).map(async ([key, request]) => {
      try {
        return [key, await request, null] as const;
      } catch (error) {
        return [key, null, error instanceof Error ? error.message : "조회 실패"] as const;
      }
    }),
  );

  const levels: Record<string, MacroLevel> = {};
  const errors: Record<string, string> = {};
  for (const [key, level, error] of entries) {
    if (level) levels[key] = level;
    if (error) errors[key] = error;
  }

  return NextResponse.json(
    { ok: Object.keys(levels).length > 0, updatedAt: new Date().toISOString(), levels, errors },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
