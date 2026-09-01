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
import type { OhlcDaily } from "./ohlcTypes";
import type { EnrichedBar } from "./tickerIndicatorsExtended";

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

export function buildTickerSnapshotFromOhlc(
  ohlc: OhlcDaily,
  query: string,
  enriched: EnrichedBar[],
): TickerSnapshot {
  const closes = ohlc.bars.map((b) => b.close);
  const dates = ohlc.bars.map((b) => b.time);
  const { asOf, currency } = ohlc;
  const historySource = ohlc.historySource;
  const priceSource = ohlc.priceSource;
  const source = historySource === priceSource ? historySource : `${historySource} + ${priceSource}`;
  const rets = dailyLogReturns(closes);
  const last = ohlc.lastPrice;

  const sma5 = sma(closes, 5);
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
    ohlc.previousClose && ohlc.previousClose > 0
      ? (last / ohlc.previousClose - 1) * 100
      : periodReturnPct(closes, 1);

  const warnings: string[] = [];
  if (closes.length < 30) warnings.push("일봉이 짧아 일부 장기 지표는 비워 둡니다.");
  if (d1 == null) warnings.push("1일 수익률을 계산할 전일 종가가 없습니다.");

  const bars = enriched.map((bar) => ({
    time: bar.time,
    open: round(bar.open, 4),
    high: round(bar.high, 4),
    low: round(bar.low, 4),
    close: round(bar.close, 4),
    volume: bar.volume,
    closeLegacy: round(bar.close, 4),
    sma5: bar.sma5,
    sma20: bar.sma20,
    sma60: bar.sma60,
    sma120: bar.sma120,
    rsi14: bar.rsi14,
    macd: bar.macd,
    macdSignal: bar.macdSignal,
    macdHistogram: bar.macdHistogram,
    bbUpper: bar.bbUpper,
    bbMiddle: bar.bbMiddle,
    bbLower: bar.bbLower,
  }));

  return {
    symbol: query,
    resolvedSymbol: ohlc.symbol,
    name: ohlc.name,
    exchange: ohlc.exchange,
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
    bars,
  };
}
