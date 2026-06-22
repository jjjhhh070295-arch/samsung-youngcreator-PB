import { NextResponse } from "next/server";
import { loadFredSeries } from "@/lib/macroStress/fred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

type MacroLevel = {
  value: number;
  asOf: string;
  source: string;
  fallback?: boolean;
};

const TIMEOUT_MS = 8_000;

async function yahooLatest(symbol: string, scale = 1): Promise<MacroLevel> {
  let lastError = "request failed";
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const response = await fetch(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
        {
          headers: { "user-agent": UA, accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: any = await response.json();
      const result = payload?.chart?.result?.[0];
      const closes: unknown[] = result?.indicators?.quote?.[0]?.close ?? [];
      const latestClose = [...closes].reverse().find((item) => Number.isFinite(Number(item)));
      const rawValue = Number(result?.meta?.regularMarketPrice ?? latestClose);
      const timestamp = Number(result?.meta?.regularMarketTime ?? result?.timestamp?.at?.(-1));
      if (!Number.isFinite(rawValue)) throw new Error("no value");
      const normalizedValue = symbol === "^TNX" && rawValue > 20 ? rawValue / 10 : rawValue * scale;
      return {
        value: normalizedValue,
        asOf: Number.isFinite(timestamp)
          ? new Date(timestamp * 1000).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        source: `Yahoo Finance ${symbol}`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
  }
  throw new Error(`Yahoo ${symbol}: ${lastError}`);
}

async function fredLatest(seriesId: string): Promise<MacroLevel> {
  const start = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 10);
  const result = await loadFredSeries(seriesId, start, { fresh: true });
  const latest = result.points[result.points.length - 1];
  if (!latest) throw new Error(`FRED ${seriesId}: no value`);
  return { value: latest.value, asOf: latest.date, source: result.source, fallback: result.fallback };
}

async function latestInflationYoY(): Promise<MacroLevel> {
  const start = new Date(Date.now() - 800 * 86_400_000).toISOString().slice(0, 10);
  const result = await loadFredSeries("CPIAUCSL", start, { fresh: true });
  const rows = result.points;
  if (rows.length < 13) throw new Error("FRED CPIAUCSL: insufficient history");
  const latest = rows[rows.length - 1];
  const yearAgo = rows[rows.length - 13];
  const value = (latest.value / yearAgo.value - 1) * 100;
  return { value, asOf: latest.date, source: `${result.source} 전년동월비`, fallback: result.fallback };
}

export async function GET() {
  const requests = {
    d_fed: fredLatest("DFEDTARU"),
    // Yahoo ^TNX 응답은 환경에 따라 4.45 또는 44.5 형식이어서 함수 내부에서 정규화한다.
    d_ust: yahooLatest("^TNX"),
    infl: latestInflationYoY(),
    ret_krw: yahooLatest("KRW=X"),
    ret_cmd: yahooLatest("GSG"),
    d_vix: yahooLatest("^VIX"),
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
