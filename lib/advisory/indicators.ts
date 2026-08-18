// 가격 시계열 → 수익률·변동성·MDD·이동평균·RSI·MACD.
// 전부 순수 함수. AI/LLM을 호출하지 않는다.

function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export function dailyLogReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (prev > 0 && cur > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      out.push(Math.log(cur / prev));
    }
  }
  return out;
}

export function periodReturnPct(closes: number[], lookbackBars: number): number | null {
  if (closes.length < lookbackBars + 1) return null;
  const end = last(closes);
  const start = closes[closes.length - 1 - lookbackBars];
  if (end == null || !(start > 0)) return null;
  return (end / start - 1) * 100;
}

export function ytdReturnPct(closes: number[], dates: string[]): number | null {
  if (closes.length === 0 || dates.length !== closes.length) return null;
  const year = dates[dates.length - 1]?.slice(0, 4);
  if (!year) return null;
  let startIdx = -1;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i].startsWith(year)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  const start = closes[startIdx];
  const end = last(closes);
  if (end == null || !(start > 0)) return null;
  return (end / start - 1) * 100;
}

export function annualizedVolPct(logReturns: number[], window: number, periodsPerYear = 252): number | null {
  if (logReturns.length < window) return null;
  const sample = logReturns.slice(-window);
  const mean = sample.reduce((s, r) => s + r, 0) / sample.length;
  const variance = sample.reduce((s, r) => s + (r - mean) ** 2, 0) / (sample.length - 1);
  if (!Number.isFinite(variance) || variance < 0) return null;
  return Math.sqrt(variance * periodsPerYear) * 100;
}

export function maxDrawdownPct(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let mdd = 0;
  for (const price of closes) {
    if (!(price > 0)) continue;
    if (price > peak) peak = price;
    const dd = peak > 0 ? price / peak - 1 : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd * 100;
}

export function sma(closes: number[], n: number): number | null {
  if (n <= 0 || closes.length < n) return null;
  const slice = closes.slice(-n);
  return slice.reduce((s, v) => s + v, 0) / n;
}

export function emaSeries(values: number[], n: number): number[] {
  if (values.length === 0 || n <= 0) return [];
  const k = 2 / (n + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Wilder 단순 평균 RSI (최근 n개 변화 기준). */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / n;
  const avgLoss = losses / n;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macdLast(closes: number[], fast = 12, slow = 26, signal = 9): {
  macd: number;
  signal: number;
  histogram: number;
} | null {
  if (closes.length < slow + signal) return null;
  const emaFast = emaSeries(closes, fast);
  const emaSlow = emaSeries(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = emaSeries(macdLine, signal);
  const macdVal = last(macdLine);
  const signalVal = last(signalLine);
  if (macdVal == null || signalVal == null) return null;
  return {
    macd: macdVal,
    signal: signalVal,
    histogram: macdVal - signalVal,
  };
}

export function technicalState(input: {
  last: number;
  sma20: number | null;
  sma60: number | null;
  rsi14: number | null;
  macdHist: number | null;
}): { trend: string; rsiState: string; macdState: string; summary: string } {
  let trend = "추세 판단 자료 부족";
  if (input.sma20 != null && input.sma60 != null) {
    if (input.last > input.sma20 && input.sma20 > input.sma60) trend = "단기·중기 이평선 위 (상승 편향)";
    else if (input.last < input.sma20 && input.sma20 < input.sma60) trend = "단기·중기 이평선 아래 (하락 편향)";
    else trend = "이평선 혼조 (방향성 약함)";
  } else if (input.sma20 != null) {
    trend = input.last >= input.sma20 ? "20일선 위" : "20일선 아래";
  }

  let rsiState = "RSI 자료 부족";
  if (input.rsi14 != null) {
    if (input.rsi14 >= 70) rsiState = "과매수권 (70↑)";
    else if (input.rsi14 <= 30) rsiState = "과매도권 (30↓)";
    else rsiState = "중립권";
  }

  let macdState = "MACD 자료 부족";
  if (input.macdHist != null) {
    macdState = input.macdHist >= 0 ? "MACD 히스토그램 양수 (단기 모멘텀 우위)" : "MACD 히스토그램 음수 (단기 모멘텀 열위)";
  }

  const summary = `${trend}. ${rsiState}. ${macdState}.`;
  return { trend, rsiState, macdState, summary };
}

export function round(value: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}
