import type { OhlcDaily } from "./ohlcTypes";
import { fetchKisDailyOhlc, isKisConfigured } from "@/lib/pricing/kis-chart";
import {
  domesticCodeFromSymbol,
  fetchNaverProfile,
  fetchNaverQuote,
  searchNaverStock,
  yahooSymbolFromNaverMatch,
} from "./naver";
import {
  fetchYahooProfile,
  fetchYahooQuote,
  resolveYahooSymbol,
} from "./yahoo";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

export interface ResolvedTicker {
  symbol: string;
  domesticCode: string | null;
}

export async function resolveTickerInput(raw: string): Promise<ResolvedTicker> {
  const input = raw.trim();
  if (!input) throw new Error("티커가 비어 있습니다.");

  const match = await searchNaverStock(input).catch(() => null);
  if (match) {
    return { symbol: yahooSymbolFromNaverMatch(match), domesticCode: match.code };
  }

  const symbol = await resolveYahooSymbol(input);
  return { symbol, domesticCode: domesticCodeFromSymbol(symbol) };
}

/** Yahoo chart API에서 OHLCV 추출. */
async function fetchYahooOhlcDaily(symbol: string, range = "2y"): Promise<OhlcDaily> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`);
  const j: any = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("시세 데이터가 없습니다.");
  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};

  const bars = timestamps
    .map((ts, i) => {
      const close = q.close?.[i];
      if (close == null || !Number.isFinite(close)) return null;
      const open = q.open?.[i] ?? close;
      const high = q.high?.[i] ?? close;
      const low = q.low?.[i] ?? close;
      const volume = q.volume?.[i] ?? 0;
      return {
        time: new Date(ts * 1000).toISOString().slice(0, 10),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean) as OhlcDaily["bars"];

  if (bars.length < 2) throw new Error("분석에 필요한 일봉이 부족합니다.");

  const live = Number(meta.regularMarketPrice);
  const lastBar = bars[bars.length - 1];
  const lastPrice = Number.isFinite(live) && live > 0 ? live : lastBar.close;
  const prevClose = bars.length > 1 ? bars[bars.length - 2].close : null;
  const delayRaw = meta.exchangeDataDelayedBy;
  const delay = delayRaw != null && Number.isFinite(Number(delayRaw)) ? Number(delayRaw) : null;

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    currency: meta.currency || "USD",
    asOf: new Date().toISOString(),
    bars,
    lastPrice,
    previousClose: prevClose,
    historySource: "yahoo-finance:chart:v8:ohlc",
    priceSource: "yahoo-finance:chart:v8:ohlc",
    quoteDelayMinutes: delay,
    marketState: meta.marketState ?? null,
  };
}

/** Naver 일봉 → OHLC (종가만 있으면 OHLC=close). */
async function fetchNaverOhlcDaily(code: string): Promise<OhlcDaily> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d).replace(/-/g, "");
  const historyUrl =
    `https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/day` +
    `?startDateTime=${fmt(start)}0000&endDateTime=${fmt(end)}2359`;

  const [quote, historyResponse] = await Promise.all([
    fetchNaverQuote(code),
    fetch(historyUrl, {
      headers: {
        "user-agent": UA,
        referer: "https://m.stock.naver.com/",
      },
      cache: "no-store",
    }),
  ]);
  if (!historyResponse.ok) throw new Error(`네이버 일봉 조회 실패 (${historyResponse.status})`);
  const rows: Array<{
    localDate?: string;
    openPrice?: number;
    highPrice?: number;
    lowPrice?: number;
    closePrice?: number;
    accumulatedTradingVolume?: number;
  }> = await historyResponse.json();

  const bars = rows
    .map((row) => {
      const close = Number(row.closePrice);
      if (!row.localDate || !Number.isFinite(close) || close <= 0) return null;
      const time = `${row.localDate.slice(0, 4)}-${row.localDate.slice(4, 6)}-${row.localDate.slice(6, 8)}`;
      const open = Number(row.openPrice) || close;
      const high = Number(row.highPrice) || close;
      const low = Number(row.lowPrice) || close;
      return {
        time,
        open,
        high,
        low,
        close,
        volume: Number(row.accumulatedTradingVolume) || 0,
      };
    })
    .filter(Boolean) as OhlcDaily["bars"];

  if (!bars.length) throw new Error("분석에 필요한 국내 일봉이 없습니다.");

  const tradedDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(quote.asOf),
  );
  const latest = bars.at(-1)!;
  if (latest.time === tradedDate) latest.close = quote.price;
  else if (latest.time < tradedDate) {
    bars.push({
      time: tradedDate,
      open: quote.price,
      high: quote.price,
      low: quote.price,
      close: quote.price,
      volume: 0,
    });
  }

  return {
    symbol: quote.symbol,
    name: quote.name,
    exchange: quote.exchange,
    currency: quote.currency,
    asOf: quote.asOf,
    bars,
    lastPrice: quote.price,
    previousClose: quote.previousClose,
    historySource: "naver-finance:chart:domestic-day:ohlc",
    priceSource: quote.source,
    quoteDelayMinutes: quote.delayMinutes,
    marketState: quote.marketState,
  };
}

export async function fetchTickerOhlcDaily(resolved: ResolvedTicker): Promise<OhlcDaily> {
  if (resolved.domesticCode) {
    if (isKisConfigured()) {
      const kis = await fetchKisDailyOhlc(resolved.domesticCode).catch(() => null);
      if (kis && kis.bars.length >= 2) {
        try {
          const quote = await fetchNaverQuote(resolved.domesticCode);
          kis.name = quote.name;
          kis.exchange = quote.exchange;
          kis.lastPrice = quote.price;
          kis.asOf = quote.asOf;
          kis.priceSource = `kis + ${quote.source}`;
          kis.quoteDelayMinutes = quote.delayMinutes;
          kis.marketState = quote.marketState;
        } catch {
          // KIS only
        }
        return kis;
      }
    }
    try {
      return await fetchNaverOhlcDaily(resolved.domesticCode);
    } catch {
      return fetchYahooOhlcDaily(resolved.symbol);
    }
  }
  return fetchYahooOhlcDaily(resolved.symbol);
}

export async function fetchTickerDaily(resolved: ResolvedTicker) {
  const ohlc = await fetchTickerOhlcDaily(resolved);
  return {
    symbol: ohlc.symbol,
    name: ohlc.name,
    exchange: ohlc.exchange,
    currency: ohlc.currency,
    asOf: ohlc.asOf,
    dates: ohlc.bars.map((b) => b.time),
    closes: ohlc.bars.map((b) => b.close),
    lastPrice: ohlc.lastPrice,
    previousClose: ohlc.previousClose,
    historySource: ohlc.historySource,
    priceSource: ohlc.priceSource,
    quoteDelayMinutes: ohlc.quoteDelayMinutes,
    marketState: ohlc.marketState,
  };
}

export async function fetchTickerProfile(resolved: ResolvedTicker) {
  if (resolved.domesticCode) return fetchNaverProfile(resolved.domesticCode);
  return fetchYahooProfile(resolved.symbol);
}

export async function fetchTickerQuote(resolved: ResolvedTicker) {
  if (resolved.domesticCode) return fetchNaverQuote(resolved.domesticCode);
  return fetchYahooQuote(resolved.symbol);
}

export function dailyToLiveQuote(daily: {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  lastPrice: number;
  previousClose: number | null;
  asOf: string;
  priceSource: string;
  quoteDelayMinutes: number | null;
  marketState: string | null;
}) {
  const previousClose = daily.previousClose;
  return {
    symbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    currency: daily.currency,
    price: daily.lastPrice,
    previousClose,
    changePct:
      previousClose && previousClose > 0
        ? (daily.lastPrice / previousClose - 1) * 100
        : null,
    asOf: daily.asOf,
    source: daily.priceSource,
    delayMinutes: daily.quoteDelayMinutes,
    marketState: daily.marketState,
  };
}

/** Yahoo quoteSummary 재무 (해외 위주). */
export async function fetchFinancialSnapshot(symbol: string) {
  const asOf = new Date().toISOString();
  const empty = {
    netIncome: null,
    revenueGrowthPct: null,
    earningsGrowthPct: null,
    roePct: null,
    forwardPe: null,
    priceToBook: null,
    asOf,
    source: "yahoo-finance:quoteSummary:financialData",
    currency: null,
  };
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics`;
    const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
    if (!res.ok) return empty;
    const j: any = await res.json();
    const fin = j?.quoteSummary?.result?.[0]?.financialData ?? {};
    const stats = j?.quoteSummary?.result?.[0]?.defaultKeyStatistics ?? {};
    const rawNumber = (value: any) => Number(value?.raw ?? value);
    const netIncome = rawNumber(fin.netIncomeToCommon ?? stats.netIncomeToCommon);
    const revGrowth = rawNumber(fin.revenueGrowth);
    const earningsGrowth = rawNumber(fin.earningsGrowth);
    const roe = rawNumber(fin.returnOnEquity);
    const forwardPe = rawNumber(stats.forwardPE ?? fin.forwardPE);
    const priceToBook = rawNumber(stats.priceToBook);
    return {
      netIncome: Number.isFinite(netIncome) ? netIncome : null,
      revenueGrowthPct: Number.isFinite(revGrowth) ? revGrowth * 100 : null,
      earningsGrowthPct: Number.isFinite(earningsGrowth) ? earningsGrowth * 100 : null,
      roePct: Number.isFinite(roe) ? roe * 100 : null,
      forwardPe: Number.isFinite(forwardPe) && forwardPe > 0 ? forwardPe : null,
      priceToBook: Number.isFinite(priceToBook) && priceToBook > 0 ? priceToBook : null,
      asOf,
      source: "yahoo-finance:quoteSummary:financialData",
      currency: fin.financialCurrency ?? null,
    };
  } catch {
    return empty;
  }
}
