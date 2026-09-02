import type { OhlcBar } from "./ohlcTypes";

export type OhlcTimeframe = "daily" | "weekly" | "monthly";

const TIMEFRAME_LABEL: Record<OhlcTimeframe, string> = {
  daily: "일봉",
  weekly: "주봉",
  monthly: "월봉",
};

export function timeframeLabel(tf: OhlcTimeframe) {
  return TIMEFRAME_LABEL[tf];
}

/** ISO week key (Mon-start) in Asia/Seoul calendar date of the bar. */
function weekKey(time: string): string {
  const [y, m, d] = time.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthKey(time: string): string {
  return time.slice(0, 7);
}

function aggregateGroup(bars: OhlcBar[]): OhlcBar {
  const open = bars[0].open;
  const close = bars[bars.length - 1].close;
  const high = Math.max(...bars.map((b) => b.high));
  const low = Math.min(...bars.map((b) => b.low));
  const volume = bars.reduce((s, b) => s + b.volume, 0);
  return {
    time: bars[bars.length - 1].time,
    open,
    high,
    low,
    close,
    volume,
  };
}

/**
 * Aggregate daily OHLC bars into weekly or monthly candles.
 * Weekly: Mon–Sun ISO week buckets; open=first, high=max, low=min, close=last, volume=sum.
 * Monthly: calendar month buckets with the same OHLCV rules.
 */
export function aggregateOhlcBars(bars: OhlcBar[], timeframe: OhlcTimeframe): OhlcBar[] {
  if (timeframe === "daily" || bars.length === 0) return bars;

  const keyFn = timeframe === "weekly" ? weekKey : monthKey;
  const groups = new Map<string, OhlcBar[]>();

  for (const bar of bars) {
    const key = keyFn(bar.time);
    const list = groups.get(key);
    if (list) list.push(bar);
    else groups.set(key, [bar]);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, grouped]) => aggregateGroup(grouped));
}
