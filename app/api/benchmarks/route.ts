import { NextResponse } from "next/server";
import { annualizedReturnFromPrices, fallbackProxyEstimate, incomeProxyEstimate, type ProxyAssetKey, type ProxyReturnEstimate } from "@/lib/proxyReturns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BenchmarkKey = "sp500" | "kospi" | "usTreasury10y" | "mmf" | "gold" | "dollar" | "commodity";

interface Point { date: string; label: string; value: number; }
interface BenchmarkSeries { key: BenchmarkKey; label: string; symbol: string; source: string; asOf: string; points: Point[]; proxyEstimate: ProxyReturnEstimate; }
interface BenchmarkDefinition { key: BenchmarkKey; proxyKey: ProxyAssetKey; label: string; symbol: string; provider: "naver" | "yahoo"; }
interface MarketRow { timestamp: number; close: number; localDate: string; }

const LOOKBACK_MONTHS = 13;

const BENCHMARKS: BenchmarkDefinition[] = [
  { key: "sp500", proxyKey: "sp500", label: "S&P500", symbol: "^GSPC", provider: "yahoo" },
  { key: "kospi", proxyKey: "kospi", label: "KOSPI", symbol: "^KS11", provider: "yahoo" },
  { key: "usTreasury10y", proxyKey: "bond", label: "미국 7-10년국채 ETF (IEF)", symbol: "IEF", provider: "yahoo" },
  { key: "mmf", proxyKey: "mmf", label: "단기국채 ETF (SHY)", symbol: "SHY", provider: "yahoo" },
  { key: "gold", proxyKey: "gold", label: "금 ETF (GLD)", symbol: "GLD", provider: "yahoo" },
  { key: "dollar", proxyKey: "dollar", label: "원/달러 환율", symbol: "KRW=X", provider: "yahoo" },
  { key: "commodity", proxyKey: "raw", label: "원자재 ETF (DBC)", symbol: "DBC", provider: "yahoo" },
];

const FALLBACK_VALUES: Record<BenchmarkKey, number[]> = {
  sp500: [0, -1.1, -0.2, 2.1, 3.7, 1.9, 5.2, 4.3, 7.1, 6.4, 8.8, 7.6, 9.2],
  kospi: [0, -2.0, 1.8, 0.9, 4.4, 3.1, 6.8, 5.3, 9.5, 7.7, 11.1, 9.4, 6.4],
  usTreasury10y: [0, 0.2, -0.3, 0.1, 0.8, 0.4, 1.1, 1.0, 1.7, 1.4, 2.0, 1.8, 2.2],
  mmf: [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4],
  gold: [0, 1.6, 0.7, 3.9, 5.4, 4.8, 7.2, 6.1, 10.4, 9.2, 12.7, 10.8, 11.6],
  dollar: [0, -0.4, 0.8, 1.1, -0.2, 1.7, 1.2, 2.4, 1.6, 2.9, 2, 1.3, 1.8],
  commodity: [0, -1.7, -0.6, 1.5, 0.2, 2.8, 1.9, 4.1, 3.2, 5.6, 4.3, 3.8, 4.9],
};

function monthLabel(localDate: string, index: number, total: number) {
  if (index === total - 1) return "현재";
  const month = Number(localDate.slice(5, 7));
  return Number.isFinite(month) ? `${month}월` : localDate.slice(0, 7);
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
    proxyEstimate: definition.proxyKey === "bond" || definition.proxyKey === "mmf"
      ? incomeProxyEstimate(definition.proxyKey, definition.label, definition.symbol)
      : fallbackProxyEstimate(definition.proxyKey, definition.label, definition.symbol),
  };
}

function localDateFromTimestamp(timestamp: number, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function dedupeDailyRows(rows: MarketRow[]) {
  const dayMap = new Map<string, MarketRow>();
  rows.forEach((row) => {
    const existing = dayMap.get(row.localDate);
    if (!existing || row.timestamp > existing.timestamp) {
      dayMap.set(row.localDate, row);
    }
  });
  return Array.from(dayMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/** 일별 종가를 월별로 묶되, 각 월(당월 포함)은 해당 월의 최신 거래일 종가를 사용 */
function monthlyPointsFromDaily(rows: MarketRow[]) {
  const daily = dedupeDailyRows(rows);
  const monthMap = new Map<string, MarketRow>();
  daily.forEach((row) => {
    const monthKey = row.localDate.slice(0, 7);
    const existing = monthMap.get(monthKey);
    if (!existing || row.timestamp > existing.timestamp) {
      monthMap.set(monthKey, row);
    }
  });
  return Array.from(monthMap.values())
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-LOOKBACK_MONTHS);
}

function parsePrice(value: unknown) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toTimestampSeconds(value: unknown) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function naverIndexUrl(symbol: string, page: number) {
  if (symbol === ".INX") {
    return `https://api.stock.naver.com/index/.INX/price?pageSize=60&page=${page}`;
  }
  return `https://m.stock.naver.com/api/index/${symbol}/price?pageSize=60&page=${page}`;
}

async function fetchNaverRows(symbol: string): Promise<MarketRow[]> {
  const rows: MarketRow[] = [];
  for (let page = 1; page <= 8; page += 1) {
    const response = await fetch(naverIndexUrl(symbol, page), {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://m.stock.naver.com/",
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) throw new Error(`${symbol} ${response.status}`);
    const pageRows: unknown = await response.json();
    if (!Array.isArray(pageRows)) throw new Error(`${symbol} response is not a list`);
    rows.push(
      ...pageRows
        .map((row: any) => {
          const tradedAt = row?.localTradedAt ?? row?.localTradeAt;
          const timestamp = toTimestampSeconds(tradedAt);
          const close = parsePrice(row?.closePrice);
          const localDate = String(tradedAt ?? "").slice(0, 10);
          return { timestamp, close, localDate };
        })
        .filter(
          (row): row is MarketRow =>
            row.timestamp != null &&
            row.close != null &&
            /^\d{4}-\d{2}-\d{2}$/.test(row.localDate),
        ),
    );
    if (pageRows.length < 60) break;
  }
  return rows;
}

async function fetchYahooRows(symbol: string): Promise<MarketRow[]> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5y`, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`${symbol} ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.adjclose?.[0]?.adjclose)
    ? result.indicators.adjclose[0].adjclose
    : Array.isArray(result?.indicators?.quote?.[0]?.close)
      ? result.indicators.quote[0].close
      : [];
  const rows = timestamps
    .map((timestamp: unknown, index: number) => {
      const ts = Number(timestamp);
      return {
        timestamp: ts,
        close: Number(closes[index]),
        localDate: localDateFromTimestamp(ts, "America/New_York"),
      };
    })
    .filter((row: MarketRow) => Number.isFinite(row.timestamp) && Number.isFinite(row.close) && row.close > 0);
  if (rows.length === 0) throw new Error(`${symbol} response is empty`);
  return rows;
}

async function fetchBenchmark(definition: BenchmarkDefinition): Promise<BenchmarkSeries> {
  const rows = definition.provider === "naver"
    ? await fetchNaverRows(definition.symbol)
    : await fetchYahooRows(definition.symbol);
  const sampled = monthlyPointsFromDaily(rows);
  if (sampled.length < 6) throw new Error(`${definition.symbol} benchmark data is too short`);
  const base = sampled[0].close;
  const points = sampled.map((point, index) => ({
    date: point.localDate,
    label: monthLabel(point.localDate, index, sampled.length),
    value: Math.round((point.close / base - 1) * 1000) / 10,
  }));
  return {
    ...definition,
    source: "Naver Finance / Yahoo Finance",
    asOf: points.at(-1)?.date ?? "",
    points,
    proxyEstimate: (() => {
      if (definition.proxyKey === "bond" || definition.proxyKey === "mmf") {
        return incomeProxyEstimate(definition.proxyKey, definition.label, definition.symbol);
      }
      const annualized = annualizedReturnFromPrices(rows);
      if (!annualized) throw new Error(`${definition.symbol} has insufficient annualization history`);
      return { key: definition.proxyKey, label: definition.label, proxy: definition.symbol, source: "Yahoo Finance adjusted close", fallback: false, returnBasis: "price_cagr" as const, ...annualized };
    })(),
  };
}

function mergeSeries(series: BenchmarkSeries[]) {
  const monthKeys = new Set<string>();
  series.forEach((item) => {
    item.points.forEach((point) => monthKeys.add(point.date.slice(0, 7)));
  });
  const sortedMonths = Array.from(monthKeys).sort().slice(-LOOKBACK_MONTHS);

  return sortedMonths.map((month, index) => {
    const row: { date: string; label: string; sp500?: number; kospi?: number; usTreasury10y?: number; mmf?: number; gold?: number; dollar?: number; commodity?: number } = {
      date: month,
      label: `${Number(month.slice(5, 7))}월`,
    };
    series.forEach((item) => {
      const point = item.points.find((candidate) => candidate.date.startsWith(month));
      if (point) row[item.key] = point.value;
    });
    const reference = series.find((item) => item.key === "sp500") ?? series[0];
    const referencePoint = reference?.points.find((candidate) => candidate.date.startsWith(month));
    if (referencePoint) row.date = referencePoint.date;
    return { ...row, label: index === sortedMonths.length - 1 ? "현재" : row.label };
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
  return NextResponse.json({
    ok: true,
    source: fallback ? "Naver Finance / Yahoo Finance + fallback" : "Naver Finance / Yahoo Finance",
    fallback,
    errors,
    updatedAt: new Date().toISOString(),
    series,
    proxyReturns: series.map((item) => item.proxyEstimate),
    points: mergeSeries(series),
  });
}
