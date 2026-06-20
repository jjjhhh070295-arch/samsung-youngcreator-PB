import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BenchmarkKey = "sp500" | "kospi200" | "usTreasury10y";

interface Point { date: string; label: string; value: number; }
interface BenchmarkSeries { key: BenchmarkKey; label: string; symbol: string; source: string; asOf: string; points: Point[]; }
interface BenchmarkDefinition { key: BenchmarkKey; label: string; symbol: string; provider: "naver" | "yahoo"; }
interface MarketRow { timestamp: number; close: number; }

const BENCHMARKS: BenchmarkDefinition[] = [
  { key: "sp500", label: "S&P500", symbol: ".INX", provider: "naver" },
  { key: "kospi200", label: "KOSPI200", symbol: "KPI200", provider: "naver" },
  { key: "usTreasury10y", label: "미국채 10년물", symbol: "IEF", provider: "yahoo" },
];

const FALLBACK_VALUES: Record<BenchmarkKey, number[]> = {
  sp500: [0, -1.1, -0.2, 2.1, 3.7, 1.9, 5.2, 4.3, 7.1, 6.4, 8.8, 7.6, 9.2],
  kospi200: [0, -2.0, 1.8, 0.9, 4.4, 3.1, 6.8, 5.3, 9.5, 7.7, 11.1, 9.4, 6.4],
  usTreasury10y: [0, 0.2, -0.3, 0.1, 0.8, 0.4, 1.1, 1.0, 1.7, 1.4, 2.0, 1.8, 2.2],
};

function monthLabel(date: Date, index: number, total: number) {
  return index === total - 1 ? "현재" : `${date.getUTCMonth() + 1}월`;
}

function fallbackFor(definition: BenchmarkDefinition): BenchmarkSeries {
  const values = FALLBACK_VALUES[definition.key];
  return {
    ...definition,
    source: "fallback",
    asOf: "예비 데이터",
    points: values.map((value, index) => ({
      date: `fallback-${index}`,
      label: index === values.length - 1 ? "현재" : `${values.length - 1 - index}M 전`,
      value,
    })),
  };
}

function monthlyLastPoints(timestamps: number[], closes: Array<number | null | undefined>) {
  const monthMap = new Map<string, MarketRow>();
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return;
    const date = new Date(timestamp * 1000);
    monthMap.set(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, { timestamp, close });
  });
  return Array.from(monthMap.values()).slice(-13);
}

function parsePrice(value: unknown) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestampSeconds(value: unknown) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function naverIndexUrl(key: "sp500" | "kospi200", page: number) {
  return key === "sp500"
    ? `https://api.stock.naver.com/index/.INX/price?pageSize=60&page=${page}`
    : `https://m.stock.naver.com/api/index/KPI200/price?pageSize=60&page=${page}`;
}

async function fetchNaverRows(key: "sp500" | "kospi200", symbol: string): Promise<MarketRow[]> {
  const rows: MarketRow[] = [];
  for (let page = 1; page <= 7; page += 1) {
    const response = await fetch(naverIndexUrl(key, page), { cache: "no-store", headers: { Accept: "application/json,text/plain,*/*", Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`${symbol} ${response.status}`);
    const pageRows: unknown = await response.json();
    if (!Array.isArray(pageRows)) throw new Error(`${symbol} response is not a list`);
    rows.push(...pageRows.map((row: any) => ({ timestamp: toTimestampSeconds(row?.localTradedAt ?? row?.localTradeAt), close: parsePrice(row?.closePrice) })).filter((row): row is MarketRow => row.timestamp != null && row.close != null));
    if (pageRows.length < 60) break;
  }
  return rows;
}

async function fetchYahooRows(symbol: string): Promise<MarketRow[]> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`${symbol} ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const rows = timestamps.map((timestamp: unknown, index: number) => ({ timestamp: Number(timestamp), close: Number(closes[index]) })).filter((row: MarketRow) => Number.isFinite(row.timestamp) && Number.isFinite(row.close));
  if (rows.length === 0) throw new Error(`${symbol} response is empty`);
  return rows;
}

async function fetchBenchmark(definition: BenchmarkDefinition): Promise<BenchmarkSeries> {
  const rows = definition.provider === "naver"
    ? await fetchNaverRows(definition.key as "sp500" | "kospi200", definition.symbol)
    : await fetchYahooRows(definition.symbol);
  const sampled = monthlyLastPoints(rows.map((row) => row.timestamp), rows.map((row) => row.close));
  if (sampled.length < 6) throw new Error(`${definition.symbol} benchmark data is too short`);
  const base = sampled[0].close;
  const points = sampled.map((point, index) => ({ date: new Date(point.timestamp * 1000).toISOString().slice(0, 10), label: monthLabel(new Date(point.timestamp * 1000), index, sampled.length), value: Math.round((point.close / base - 1) * 1000) / 10 }));
  return { ...definition, source: "Naver Finance / Yahoo Finance", asOf: points.at(-1)?.date ?? "", points };
}

function mergeSeries(series: BenchmarkSeries[]) {
  const maxLength = Math.min(13, Math.max(...series.map((item) => item.points.length)));
  const reference = series.find((item) => item.key === "sp500") ?? series[0];
  return Array.from({ length: maxLength }, (_, index) => {
    const row: { date: string; label: string; sp500?: number; kospi200?: number; usTreasury10y?: number } = {
      date: reference?.points[reference.points.length - maxLength + index]?.date ?? `point-${index}`,
      label: reference?.points[reference.points.length - maxLength + index]?.label ?? `${index + 1}`,
    };
    series.forEach((item) => { const point = item.points[item.points.length - maxLength + index]; if (point) row[item.key] = point.value; });
    return { ...row, label: index === maxLength - 1 ? "현재" : row.label };
  });
}

export async function GET() {
  const results = await Promise.allSettled(BENCHMARKS.map(fetchBenchmark));
  const errors: string[] = [];
  const series = results.map((result, index) => {
    const definition = BENCHMARKS[index];
    if (result.status === "fulfilled") return result.value;
    errors.push(`${definition.symbol}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return fallbackFor(definition);
  });
  const fallback = errors.length > 0;
  if (fallback) console.error("[/api/benchmarks]", errors.join(" | "));
  return NextResponse.json({ ok: true, source: fallback ? "Naver Finance / Yahoo Finance + fallback" : "Naver Finance / Yahoo Finance", fallback, errors, updatedAt: new Date().toISOString(), series, points: mergeSeries(series) });
}
