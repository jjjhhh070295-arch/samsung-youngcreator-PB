import {
  annualizedVolPct,
  dailyLogReturns,
  macdLast,
  maxDrawdownPct,
  periodReturnPct,
  round,
  rsi,
  sma,
  technicalState,
  ytdReturnPct,
} from "./indicators";
import type { MeasuredNumber, TickerSnapshot } from "./types";
import type { YahooDaily } from "./yahoo";

function m(
  value: number | null,
  unit: string,
  asOf: string,
  source: string,
  currency?: string,
  digits = 2,
): MeasuredNumber | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { value: round(value, digits), unit, asOf, source, currency };
}

export function buildTickerSnapshot(daily: YahooDaily, query: string): TickerSnapshot {
  const { closes, dates, asOf, currency } = daily;
  const source = "yahoo-finance:chart:v8";
  const rets = dailyLogReturns(closes);
  const last = daily.lastPrice;
  const sma20 = sma(closes, 20);
  const sma60 = sma(closes, 60);
  const sma120 = sma(closes, 120);
  const rsi14 = rsi(closes, 14);
  const macd = macdLast(closes);
  const tech = technicalState({
    last,
    sma20,
    sma60,
    rsi14,
    macdHist: macd?.histogram ?? null,
  });

  const d1 =
    daily.previousClose && daily.previousClose > 0
      ? ((last / daily.previousClose) - 1) * 100
      : periodReturnPct(closes, 1);

  const warnings: string[] = [];
  if (closes.length < 30) warnings.push("일봉이 짧아 일부 장기 지표는 비워 둡니다.");
  if (d1 == null) warnings.push("1일 수익률을 계산할 전일 종가가 없습니다.");
  if (rsi14 == null) warnings.push("RSI 산출에 필요한 일봉이 부족합니다.");
  if (macd == null) warnings.push("MACD 산출에 필요한 일봉이 부족합니다.");

  const bars = dates.map((time, i) => ({ time, close: round(closes[i], 4) })).slice(-260);

  return {
    symbol: query,
    resolvedSymbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    currency,
    asOf,
    source,
    lastPrice: m(last, currency, asOf, source, currency, 4)!,
    warnings,
    periodReturns: {
      d1: m(d1, "%", asOf, source),
      m1: m(periodReturnPct(closes, 21), "%", asOf, source),
      m3: m(periodReturnPct(closes, 63), "%", asOf, source),
      m6: m(periodReturnPct(closes, 126), "%", asOf, source),
      y1: m(periodReturnPct(closes, 252), "%", asOf, source),
      ytd: m(ytdReturnPct(closes, dates), "%", asOf, source),
    },
    volatility: {
      d20: m(annualizedVolPct(rets, 20), "%", asOf, source),
      d60: m(annualizedVolPct(rets, 60), "%", asOf, source),
    },
    mdd: m(maxDrawdownPct(closes), "%", asOf, source),
    movingAverages: {
      sma20: m(sma20, currency, asOf, source, currency, 4),
      sma60: m(sma60, currency, asOf, source, currency, 4),
      sma120: m(sma120, currency, asOf, source, currency, 4),
    },
    rsi14: m(rsi14, "index", asOf, source),
    macd: {
      macd: m(macd?.macd ?? null, "price", asOf, source, currency, 4),
      signal: m(macd?.signal ?? null, "price", asOf, source, currency, 4),
      histogram: m(macd?.histogram ?? null, "price", asOf, source, currency, 4),
    },
    technicalState: tech,
    bars,
  };
}
