/**
 * eFriend 조건검색 없이 국내 등락률 상위 추출.
 * - 상승률 랭킹: 네이버 금융 공개 페이지 (KOSPI+KOSDAQ)
 * - 시총/일봉 보강: Yahoo Finance chart/quote (yfinance와 동일 소스)
 * 주문·잔고만 KIS 사용.
 */

import type { OhlcBar } from "./krTrendFilter";
import { completedBarsOnly } from "./krTrendFilter";
import {
  formatMarketCapWon,
  isExcludedInstrument,
  mapPool,
  passesMarketCapFloor,
  type KrGainerRow,
} from "./krGainers";
import { MIN_KR_MARKET_CAP_WON, KR_TOP_GAINERS_LIMIT } from "./krConstants";

export type MarketGainerSeed = {
  ticker: string;
  name: string;
  changePct: number;
  market: "KOSPI" | "KOSDAQ";
};

function yahooSymbol(ticker: string, market: "KOSPI" | "KOSDAQ"): string {
  return `${ticker}.${market === "KOSDAQ" ? "KQ" : "KS"}`;
}

/** 네이버 상승률 상위 표에서 종목 파싱 (HTML). */
export async function fetchNaverRiseSeeds(
  market: "KOSPI" | "KOSDAQ",
  fetchImpl: typeof fetch = fetch,
): Promise<MarketGainerSeed[]> {
  const sosok = market === "KOSDAQ" ? "1" : "0";
  const url = `https://finance.naver.com/sise/sise_rise.naver?sosok=${sosok}`;
  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; kis-signal-trader/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`네이버 상승률 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 네이버 sise는 euc-kr
  const html = buf.toString("latin1");
  // decode euc-kr via TextDecoder if available
  let text = html;
  try {
    text = new TextDecoder("euc-kr").decode(buf);
  } catch {
    text = buf.toString("utf8");
  }

  const seeds: MarketGainerSeed[] = [];
  const seen = new Set<string>();
  // code=005930 ... >삼성전자</a> ... +1.23%
  const re =
    /code=(\d{6})[^>]*>\s*([^<]+)<\/a>[\s\S]*?([+-]?\d+(?:\.\d+)?)\s*%/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ticker = m[1]!;
    const name = m[2]!.replace(/\s+/g, " ").trim();
    const changePct = Number(m[3]);
    if (!name || !Number.isFinite(changePct) || seen.has(ticker)) continue;
    if (isExcludedInstrument(name)) continue;
    seen.add(ticker);
    seeds.push({ ticker, name, changePct, market });
  }
  return seeds;
}

async function fetchYahooQuoteMeta(
  ticker: string,
  market: "KOSPI" | "KOSDAQ",
  fetchImpl: typeof fetch = fetch,
): Promise<{
  price: number;
  changePct: number;
  volume: number;
  marketCapWon: number | null;
  asOf: string;
  source: string;
}> {
  const symbol = yahooSymbol(ticker, market);
  const asOf = new Date().toISOString();
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "kis-signal-trader/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`yahoo quote HTTP ${res.status}`);
    const json = (await res.json()) as {
      quoteResponse?: {
        result?: Array<{
          regularMarketPrice?: number;
          regularMarketChangePercent?: number;
          regularMarketVolume?: number;
          marketCap?: number;
        }>;
      };
    };
    const q = json.quoteResponse?.result?.[0];
    if (!q) throw new Error("yahoo quote empty");
    return {
      price: Number(q.regularMarketPrice) || 0,
      changePct: Number(q.regularMarketChangePercent) || 0,
      volume: Number(q.regularMarketVolume) || 0,
      marketCapWon: q.marketCap != null && Number.isFinite(q.marketCap) ? Math.floor(q.marketCap) : null,
      asOf,
      source: `yahoo:quote:${symbol}`,
    };
  } catch {
    // chart meta fallback
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 5 * 24 * 60 * 60;
    const chartUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetchImpl(chartUrl, {
      headers: { "User-Agent": "kis-signal-trader/1.0" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`yahoo chart HTTP ${res.status}`);
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          meta?: { regularMarketPrice?: number; chartPreviousClose?: number };
          indicators?: { quote?: Array<{ volume?: (number | null)[]; close?: (number | null)[] }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const price = Number(result?.meta?.regularMarketPrice) || 0;
    const prev = Number(result?.meta?.chartPreviousClose) || 0;
    const vols = result?.indicators?.quote?.[0]?.volume ?? [];
    const volume = Number(vols[vols.length - 1]) || 0;
    const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return {
      price,
      changePct,
      volume,
      marketCapWon: null,
      asOf,
      source: `yahoo:chart:${symbol}`,
    };
  }
}

/** Yahoo 일봉 (yfinance chart API). */
export async function fetchYahooOhlcBars(
  ticker: string,
  market: "KOSPI" | "KOSDAQ" = "KOSPI",
  lookbackDays = 80,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bars: OhlcBar[]; asOf: string; source: string }> {
  const symbol = yahooSymbol(ticker, market);
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - (lookbackDays + 40) * 24 * 60 * 60;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "kis-signal-trader/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`yahoo OHLC HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }>;
        };
      }>;
    };
  };
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const bars: OhlcBar[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = quote?.open?.[i];
    const high = quote?.high?.[i];
    const low = quote?.low?.[i];
    const close = quote?.close?.[i];
    const volume = quote?.volume?.[i];
    if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close)) continue;
    const date = new Date(timestamps[i]! * 1000).toISOString().slice(0, 10);
    bars.push({
      date,
      open,
      high: high != null && high > 0 ? high : Math.max(open, close),
      low: low != null && low > 0 ? low : Math.min(open, close),
      close,
      volume: volume != null && Number.isFinite(volume) ? volume : 0,
    });
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return {
    bars: completedBarsOnly(bars),
    asOf: new Date().toISOString(),
    source: `yahoo:ohlc:${symbol}`,
  };
}

/**
 * 네이버 상승률 → 상위 limit → Yahoo로 시총·가격 보강.
 * 시총 선필터 금지(선정 후 상태만 표시).
 */
export async function fetchMarketTopGainers(
  limit = KR_TOP_GAINERS_LIMIT,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  status: "ok" | "error";
  gainers: KrGainerRow[];
  unverifiable: KrGainerRow[];
  universeSize: number;
  floorWon: number;
  asOf: string;
  source: string;
  message?: string;
}> {
  const asOf = new Date().toISOString();
  const floorWon = MIN_KR_MARKET_CAP_WON;
  try {
    const [kospi, kosdaq] = await Promise.all([
      fetchNaverRiseSeeds("KOSPI", fetchImpl),
      fetchNaverRiseSeeds("KOSDAQ", fetchImpl),
    ]);
    const merged = [...kospi, ...kosdaq].sort(
      (a, b) => b.changePct - a.changePct || a.ticker.localeCompare(b.ticker),
    );
    // 티커 중복 제거
    const uniq: MarketGainerSeed[] = [];
    const seen = new Set<string>();
    for (const s of merged) {
      if (seen.has(s.ticker)) continue;
      seen.add(s.ticker);
      uniq.push(s);
    }
    const top = uniq.slice(0, limit);
    if (top.length === 0) {
      return {
        status: "error",
        gainers: [],
        unverifiable: [],
        universeSize: 0,
        floorWon,
        asOf,
        source: "naver:rise",
        message: "네이버 상승률 상위 종목을 파싱하지 못했습니다.",
      };
    }

    const enriched = await mapPool(top, 4, async (row, index) => {
      let price = 0;
      let changePct = row.changePct;
      let volume = 0;
      let marketCapWon: number | null = null;
      let marketCapAsOf = asOf;
      let marketCapSource = "naver:rise";
      try {
        const meta = await fetchYahooQuoteMeta(row.ticker, row.market, fetchImpl);
        price = meta.price || price;
        if (meta.changePct) changePct = meta.changePct;
        volume = meta.volume || volume;
        marketCapWon = meta.marketCapWon;
        marketCapAsOf = meta.asOf;
        marketCapSource = meta.source;
      } catch {
        /* keep naver changePct */
      }
      const floor = passesMarketCapFloor(marketCapWon);
      const gainer: KrGainerRow = {
        rank: index + 1,
        ticker: row.ticker,
        name: row.name,
        price,
        changePct,
        volume,
        tradingValueWon: null,
        marketCapWon,
        marketCapLabel: marketCapWon != null ? formatMarketCapWon(marketCapWon) : "시총 검증 불가",
        marketCapAsOf,
        marketCapSource,
        marketCapStatus: floor.reason,
        market: row.market,
        asOf,
        source: "naver:rise+yahoo",
        currency: "KRW",
      };
      return gainer;
    });

    // 등락률 재정렬 (야후 보정 반영)
    enriched.sort((a, b) => b.changePct - a.changePct || a.ticker.localeCompare(b.ticker));
    enriched.forEach((g, i) => {
      g.rank = i + 1;
    });

    return {
      status: "ok",
      gainers: enriched,
      unverifiable: enriched.filter((g) => g.marketCapStatus === "unverifiable"),
      universeSize: uniq.length,
      floorWon,
      asOf,
      source: "naver:rise+yahoo",
      message: "eFriend 없이 네이버 상승률 + Yahoo 시총/가격으로 추출",
    };
  } catch (e: unknown) {
    return {
      status: "error",
      gainers: [],
      unverifiable: [],
      universeSize: 0,
      floorWon,
      asOf,
      source: "market:error",
      message: e instanceof Error ? e.message : "시장 데이터 추출 실패",
    };
  }
}
