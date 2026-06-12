import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BenchmarkKey = "sp500" | "kospi200" | "bond" | "gold" | "dollar" | "commodity";

interface Point {
  date: string;
  label: string;
  value: number;
}

interface BenchmarkSeries {
  key: BenchmarkKey;
  label: string;
  symbol: string;
  source: string;
  asOf: string;
  points: Point[];
}

const BENCHMARKS: Array<{ key: BenchmarkKey; label: string; symbol: string }> = [
  { key: "sp500", label: "S&P500", symbol: ".INX" },
  { key: "kospi200", label: "KOSPI200", symbol: "KPI200" },
];

const fallbackSeries: BenchmarkSeries[] = [
  {
    key: "sp500",
    label: "S&P500",
    symbol: "^GSPC",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", -1.1],
      ["10M 전", -0.2],
      ["9M 전", 2.1],
      ["8M 전", 3.7],
      ["7M 전", 1.9],
      ["6M 전", 5.2],
      ["5M 전", 4.3],
      ["4M 전", 7.1],
      ["3M 전", 6.4],
      ["2M 전", 8.8],
      ["1M 전", 7.6],
      ["현재", 9.2],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
  {
    key: "kospi200",
    label: "KOSPI200",
    symbol: "^KS200",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", -2.0],
      ["10M 전", 1.8],
      ["9M 전", 0.9],
      ["8M 전", 4.4],
      ["7M 전", 3.1],
      ["6M 전", 6.8],
      ["5M 전", 5.3],
      ["4M 전", 9.5],
      ["3M 전", 7.7],
      ["2M 전", 11.1],
      ["1M 전", 9.4],
      ["현재", 6.4],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
  {
    key: "bond",
    label: "US Aggregate Bond",
    symbol: "AGG",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", 0.2],
      ["10M 전", -0.3],
      ["9M 전", 0.1],
      ["8M 전", 0.8],
      ["7M 전", 0.4],
      ["6M 전", 1.1],
      ["5M 전", 1.0],
      ["4M 전", 1.7],
      ["3M 전", 1.4],
      ["2M 전", 2.0],
      ["1M 전", 1.8],
      ["현재", 2.2],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
  {
    key: "gold",
    label: "Gold Futures",
    symbol: "GC=F",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", 1.6],
      ["10M 전", 0.7],
      ["9M 전", 3.9],
      ["8M 전", 5.4],
      ["7M 전", 4.8],
      ["6M 전", 7.2],
      ["5M 전", 6.1],
      ["4M 전", 10.4],
      ["3M 전", 9.2],
      ["2M 전", 12.7],
      ["1M 전", 10.8],
      ["현재", 11.6],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
  {
    key: "dollar",
    label: "US Dollar Index",
    symbol: "DX-Y.NYB",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", -0.4],
      ["10M 전", 0.8],
      ["9M 전", 1.1],
      ["8M 전", -0.2],
      ["7M 전", 1.7],
      ["6M 전", 1.2],
      ["5M 전", 2.4],
      ["4M 전", 1.6],
      ["3M 전", 2.9],
      ["2M 전", 2.0],
      ["1M 전", 1.3],
      ["현재", 1.8],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
  {
    key: "commodity",
    label: "Commodity ETF",
    symbol: "DBC",
    source: "fallback",
    asOf: "데이터 지연",
    points: [
      ["12M 전", 0],
      ["11M 전", -1.7],
      ["10M 전", -0.6],
      ["9M 전", 1.5],
      ["8M 전", 0.2],
      ["7M 전", 2.8],
      ["6M 전", 1.9],
      ["5M 전", 4.1],
      ["4M 전", 3.2],
      ["3M 전", 5.6],
      ["2M 전", 4.3],
      ["1M 전", 3.8],
      ["현재", 4.9],
    ].map(([label, value], index) => ({
      date: `fallback-${index}`,
      label: String(label),
      value: Number(value),
    })),
  },
];

function monthLabel(date: Date, index: number, total: number) {
  if (index === total - 1) return "현재";
  return `${date.getUTCMonth() + 1}월`;
}

function toDateInput(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

function monthlyLastPoints(timestamps: number[], closes: Array<number | null | undefined>) {
  const monthMap = new Map<string, { timestamp: number; close: number }>();

  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) return;
    const date = new Date(timestamp * 1000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { timestamp, close });
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

function naverIndexUrl(key: BenchmarkKey, page: number) {
  if (key === "sp500") {
    return `https://api.stock.naver.com/index/.INX/price?pageSize=60&page=${page}`;
  }
  if (key === "kospi200") {
    return `https://m.stock.naver.com/api/index/KPI200/price?pageSize=60&page=${page}`;
  }
  throw new Error(`${key} has no Naver endpoint`);
}

async function fetchNaverRows(key: BenchmarkKey, symbol: string) {
  const rows: any[] = [];

  for (let page = 1; page <= 7; page += 1) {
    const res = await fetch(naverIndexUrl(key, page), {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://m.stock.naver.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`${symbol} ${res.status}`);

    const pageRows = await res.json();
    if (!Array.isArray(pageRows)) throw new Error(`${symbol} response is not a list`);
    rows.push(...pageRows);
    if (pageRows.length < 60) break;
  }

  return rows;
}

async function fetchBenchmark({ key, label, symbol }: (typeof BENCHMARKS)[number]): Promise<BenchmarkSeries> {
  const rows = await fetchNaverRows(key, symbol);

  const sortedRows = rows
    .map((row) => ({
      timestamp: toTimestampSeconds(row?.localTradedAt ?? row?.localTradeAt),
      close: parsePrice(row?.closePrice),
    }))
    .filter((row): row is { timestamp: number; close: number } => row.timestamp != null && row.close != null)
    .sort((a, b) => a.timestamp - b.timestamp);

  const timestamps = sortedRows.map((row) => row.timestamp);
  const closes = sortedRows.map((row) => row.close);
  const sampled = monthlyLastPoints(timestamps, closes);
  if (sampled.length < 6) throw new Error(`${symbol} benchmark data is too short`);

  const base = sampled[0].close;
  const points = sampled.map((point, index) => {
    const date = new Date(point.timestamp * 1000);
    return {
      date: toDateInput(point.timestamp),
      label: monthLabel(date, index, sampled.length),
      value: Math.round(((point.close / base - 1) * 100) * 10) / 10,
    };
  });

  return {
    key,
    label,
    symbol,
    source: "Naver Finance market API",
    asOf: points.at(-1)?.date ?? "",
    points,
  };
}

function fallbackFor(key: BenchmarkKey) {
  return fallbackSeries.find((item) => item.key === key);
}

function mergeSeries(series: BenchmarkSeries[]) {
  const maxLength = Math.min(13, Math.max(...series.map((item) => item.points.length)));
  const reference = series.find((item) => item.key === "sp500") ?? series[0];

  return Array.from({ length: maxLength }, (_, index) => {
    const row: {
      date: string;
      label: string;
      sp500?: number;
      kospi200?: number;
      bond?: number;
      gold?: number;
      dollar?: number;
      commodity?: number;
    } = {
      date: reference?.points[reference.points.length - maxLength + index]?.date ?? `point-${index}`,
      label: reference?.points[reference.points.length - maxLength + index]?.label ?? `${index + 1}`,
    };

    series.forEach((item) => {
      const point = item.points[item.points.length - maxLength + index];
      if (point) row[item.key] = point.value;
    });

    return {
      ...row,
      label: index === maxLength - 1 ? "현재" : row.label,
    };
  });
}

export async function GET() {
  const results = await Promise.allSettled(BENCHMARKS.map(fetchBenchmark));
  const errors: string[] = [];

  const series = results
    .map((result, index) => {
      const benchmark = BENCHMARKS[index];
      if (result.status === "fulfilled") return result.value;

      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${benchmark.symbol}: ${message}`);
      return fallbackFor(benchmark.key);
    })
    .filter((item): item is BenchmarkSeries => Boolean(item));

  const fallback = errors.length > 0;
  if (fallback) console.error("[/api/benchmarks]", errors.join(" | "));

  return NextResponse.json({
    ok: true,
    source: fallback ? "Naver Finance market API + fallback" : "Naver Finance market API",
    fallback,
    errors,
    updatedAt: new Date().toISOString(),
    series,
    points: mergeSeries(series),
  });
}
