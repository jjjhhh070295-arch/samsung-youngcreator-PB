import type { OhlcBar } from "./ohlcTypes";
import { macdSeries, rsiSeries, smaSeries } from "./indicators";

export interface BollingerPoint {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  weightPct: number;
}

export interface StreakMarker {
  time: string;
  kind: "up3" | "down3";
}

export function bollingerSeries(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerPoint[] {
  const middle = smaSeries(closes, period);
  return closes.map((_, i) => {
    const m = middle[i];
    if (m == null || i < period - 1) return { upper: null, middle: null, lower: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = m;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: mean + mult * std,
      middle: mean,
      lower: mean - mult * std,
    };
  });
}

/** 거래량 기반 가격대 분포 (단순 binning). */
export function volumeProfile(
  bars: OhlcBar[],
  bins = 12,
): VolumeProfileLevel[] {
  if (bars.length < 5) return [];
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  if (!(max > min)) return [];

  const bucket = Array.from({ length: bins }, () => 0);
  const step = (max - min) / bins;

  for (const bar of bars) {
    const mid = (bar.high + bar.low) / 2;
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((mid - min) / step)));
    bucket[idx] += bar.volume;
  }

  const total = bucket.reduce((s, v) => s + v, 0) || 1;
  return bucket.map((vol, i) => ({
    price: min + step * (i + 0.5),
    volume: vol,
    weightPct: (vol / total) * 100,
  }));
}

export function streakMarkers(bars: OhlcBar[]): StreakMarker[] {
  const out: StreakMarker[] = [];
  for (let i = 2; i < bars.length; i++) {
    const up =
      bars[i].close > bars[i - 1].close &&
      bars[i - 1].close > bars[i - 2].close;
    const down =
      bars[i].close < bars[i - 1].close &&
      bars[i - 1].close < bars[i - 2].close;
    if (up) out.push({ time: bars[i].time, kind: "up3" });
    if (down) out.push({ time: bars[i].time, kind: "down3" });
  }
  return out;
}

export function enrichBars(bars: OhlcBar[]) {
  const closes = bars.map((b) => b.close);
  const sma5 = smaSeries(closes, 5);
  const sma20 = smaSeries(closes, 20);
  const sma60 = smaSeries(closes, 60);
  const sma120 = smaSeries(closes, 120);
  const rsi14 = rsiSeries(closes, 14);
  const macd = macdSeries(closes);
  const boll = bollingerSeries(closes, 20, 2);

  return bars.map((bar, i) => ({
    ...bar,
    t: bar.time.slice(5),
    sma5: sma5[i],
    sma20: sma20[i],
    sma60: sma60[i],
    sma120: sma120[i],
    rsi14: rsi14[i],
    macd: macd[i]?.macd ?? null,
    macdSignal: macd[i]?.signal ?? null,
    macdHistogram: macd[i]?.histogram ?? null,
    bbUpper: boll[i]?.upper ?? null,
    bbMiddle: boll[i]?.middle ?? null,
    bbLower: boll[i]?.lower ?? null,
  }));
}

export type EnrichedBar = ReturnType<typeof enrichBars>[number];
