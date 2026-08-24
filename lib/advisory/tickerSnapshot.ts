import {
  annualizedVolPct,
  dailyLogReturns,
  macdLast,
  macdSeries,
  maxDrawdownPct,
  periodReturnPct,
  round,
  rsi,
  rsiSeries,
  sma,
  smaSeries,
  technicalState,
  ytdReturnPct,
} from "./indicators";
import type { MeasuredNumber, TickerSnapshot } from "./types";
import type { YahooDaily } from "./yahoo";
import { buildTickerMomentumEvidence, buildUnavailableTickerMomentum } from "./tickerMomentum";

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

function rounded(value: number | null | undefined, digits = 4): number | null {
  return value == null || !Number.isFinite(value) ? null : round(value, digits);
}

export function buildTickerSnapshot(daily: YahooDaily, query: string): TickerSnapshot {
  const { closes, dates, asOf, currency } = daily;
  const historySource = daily.historySource || "yahoo-finance:chart:v8:1d";
  const priceSource = daily.priceSource || historySource;
  const source = historySource === priceSource ? historySource : `${historySource} + ${priceSource}`;
  const rets = dailyLogReturns(closes);
  const last = daily.lastPrice;
  const sma5 = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const sma60 = sma(closes, 60);
  const sma120 = sma(closes, 120);
  const rsi14 = rsi(closes, 14);
  const macd = macdLast(closes);
  const sma5Values = smaSeries(closes, 5);
  const sma20Values = smaSeries(closes, 20);
  const sma60Values = smaSeries(closes, 60);
  const sma120Values = smaSeries(closes, 120);
  const rsi14Values = rsiSeries(closes, 14);
  const macdValues = macdSeries(closes);
  const tech = technicalState({
    last,
    sma20,
    sma60,
    rsi14,
    macdHist: macd?.histogram ?? null,
  });
  const momentum = daily.momentumDataset
    ? buildTickerMomentumEvidence(daily.momentumDataset)
    : buildUnavailableTickerMomentum({
        asOf,
        source,
        reason: "현재 시세 제공처는 승인된 수정 OHLCV·거래량 계약이 확인되지 않아 P0 모멘텀을 계산하지 않았습니다.",
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
  if (momentum.status !== "ok") {
    warnings.push(...momentum.warnings.map((warning) => `가격·모멘텀: ${warning}`));
  }

  const bars = dates.map((time, i) => ({
    time,
    close: round(closes[i], 4),
    sma5: rounded(sma5Values[i]),
    sma20: rounded(sma20Values[i]),
    sma60: rounded(sma60Values[i]),
    sma120: rounded(sma120Values[i]),
    rsi14: rounded(rsi14Values[i], 2),
    macd: rounded(macdValues[i]?.macd),
    macdSignal: rounded(macdValues[i]?.signal),
    macdHistogram: rounded(macdValues[i]?.histogram),
  })).slice(-260);

  return {
    symbol: query,
    resolvedSymbol: daily.symbol,
    name: daily.name,
    exchange: daily.exchange,
    currency,
    asOf,
    source,
    lastPrice: m(last, currency, asOf, priceSource, currency, 4)!,
    warnings,
    periodReturns: {
      d1: m(d1, "%", asOf, priceSource),
      m1: m(periodReturnPct(closes, 21), "%", asOf, historySource),
      m3: m(periodReturnPct(closes, 63), "%", asOf, historySource),
      m6: m(periodReturnPct(closes, 126), "%", asOf, historySource),
      y1: m(periodReturnPct(closes, 252), "%", asOf, historySource),
      ytd: m(ytdReturnPct(closes, dates), "%", asOf, historySource),
    },
    volatility: {
      d20: m(annualizedVolPct(rets, 20), "%", asOf, historySource),
      d60: m(annualizedVolPct(rets, 60), "%", asOf, historySource),
    },
    mdd: m(maxDrawdownPct(closes), "%", asOf, historySource),
    movingAverages: {
      sma5: m(sma5, currency, asOf, historySource, currency, 4),
      sma20: m(sma20, currency, asOf, historySource, currency, 4),
      sma60: m(sma60, currency, asOf, historySource, currency, 4),
      sma120: m(sma120, currency, asOf, historySource, currency, 4),
    },
    rsi14: m(rsi14, "index", asOf, historySource),
    macd: {
      macd: m(macd?.macd ?? null, "price", asOf, historySource, currency, 4),
      signal: m(macd?.signal ?? null, "price", asOf, historySource, currency, 4),
      histogram: m(macd?.histogram ?? null, "price", asOf, historySource, currency, 4),
    },
    technicalState: tech,
    momentum,
    bars,
  };
}
