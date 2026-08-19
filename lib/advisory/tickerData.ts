import type { TickerLiveQuote } from "./types";
import {
  domesticCodeFromSymbol,
  fetchNaverDaily,
  fetchNaverProfile,
  fetchNaverQuote,
  searchNaverStock,
  yahooSymbolFromNaverMatch,
} from "./naver";
import {
  fetchYahooDaily,
  fetchYahooProfile,
  fetchYahooQuote,
  resolveYahooSymbol,
  type YahooDaily,
  type YahooProfile,
} from "./yahoo";

export interface ResolvedTicker {
  symbol: string;
  domesticCode: string | null;
}

export async function resolveTickerInput(raw: string): Promise<ResolvedTicker> {
  const input = raw.trim();
  if (!input) throw new Error("티커가 비어 있습니다.");

  // NAVER, LS ELECTRIC처럼 영문이 공식 종목명인 국내 기업도 있으므로
  // 입력 문자 종류와 무관하게 국내 종목 검색을 먼저 시도한다.
  const match = await searchNaverStock(input).catch(() => null);
  if (match) {
    return { symbol: yahooSymbolFromNaverMatch(match), domesticCode: match.code };
  }

  const symbol = await resolveYahooSymbol(input);
  return { symbol, domesticCode: domesticCodeFromSymbol(symbol) };
}

export async function fetchTickerDaily(resolved: ResolvedTicker): Promise<YahooDaily> {
  if (!resolved.domesticCode) return fetchYahooDaily(resolved.symbol);
  try {
    return await fetchNaverDaily(resolved.domesticCode);
  } catch {
    const [daily, quote] = await Promise.all([
      fetchYahooDaily(resolved.symbol),
      fetchNaverQuote(resolved.domesticCode).catch(() => null),
    ]);
    if (!quote) return daily;
    return {
      ...daily,
      symbol: quote.symbol,
      name: quote.name,
      exchange: quote.exchange,
      currency: quote.currency,
      asOf: quote.asOf,
      lastPrice: quote.price,
      previousClose: quote.previousClose,
      priceSource: quote.source,
      quoteDelayMinutes: quote.delayMinutes,
      marketState: quote.marketState,
    };
  }
}

export async function fetchTickerProfile(resolved: ResolvedTicker): Promise<YahooProfile> {
  if (resolved.domesticCode) return fetchNaverProfile(resolved.domesticCode);
  return fetchYahooProfile(resolved.symbol);
}

export async function fetchTickerQuote(resolved: ResolvedTicker): Promise<TickerLiveQuote> {
  if (resolved.domesticCode) return fetchNaverQuote(resolved.domesticCode);
  return fetchYahooQuote(resolved.symbol);
}

export function dailyToLiveQuote(daily: YahooDaily): TickerLiveQuote {
  const previousClose = daily.previousClose;
  return {
    symbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    currency: daily.currency,
    price: daily.lastPrice,
    previousClose,
    changePct: previousClose && previousClose > 0 ? (daily.lastPrice / previousClose - 1) * 100 : null,
    asOf: daily.asOf,
    source: daily.priceSource,
    delayMinutes: daily.quoteDelayMinutes,
    marketState: daily.marketState,
  };
}
