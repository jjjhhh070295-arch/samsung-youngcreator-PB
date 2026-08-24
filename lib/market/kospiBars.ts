/**
 * KOSPI(^KS11) 완료 일봉 — Yahoo chart API.
 * 실패 시 빈 배열 (국면 판정은 보수적 횡보로 떨어짐).
 */

import type { CompletedBar } from "@/lib/strategy/threeBullTwoBear";

export type FetchImpl = typeof fetch;

let indexBarsOverride: CompletedBar[] | null = null;

/** Test hook — inject fixed index bars (skip network). */
export function setIndexBarsOverrideForTests(bars: CompletedBar[] | null): void {
  indexBarsOverride = bars;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Drop today's incomplete bar if market may still be open (UTC date heuristic). */
export function excludeIncompleteToday(bars: CompletedBar[], asOfYmd = todayYmd()): CompletedBar[] {
  if (bars.length === 0) return bars;
  const last = bars[bars.length - 1]!;
  if (last.date === asOfYmd) return bars.slice(0, -1);
  return bars;
}

export async function fetchKospiCompletedBars(
  options?: { symbol?: string; fetchImpl?: FetchImpl; lookbackDays?: number },
): Promise<{ bars: CompletedBar[]; source: string; error?: string }> {
  if (indexBarsOverride) {
    return { bars: excludeIncompleteToday(indexBarsOverride), source: "test-override" };
  }

  const symbol = options?.symbol ?? process.env.REGIME_INDEX_SYMBOL?.trim() ?? "^KS11";
  const fetchImpl = options?.fetchImpl ?? fetch;
  const lookbackDays = options?.lookbackDays ?? 120;
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - lookbackDays * 24 * 60 * 60;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=history`;

  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "kis-regime-trader/1.0" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { bars: [], source: "yahoo", error: `yahoo HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: { quote?: Array<{ open?: (number | null)[]; close?: (number | null)[] }> };
        }>;
      };
    };
    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const quote = result?.indicators?.quote?.[0];
    const opens = quote?.open ?? [];
    const closes = quote?.close ?? [];
    const bars: CompletedBar[] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const open = opens[i];
      const close = closes[i];
      if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close)) continue;
      const date = new Date(timestamps[i]! * 1000).toISOString().slice(0, 10);
      bars.push({ date, open, close });
    }
    return { bars: excludeIncompleteToday(bars), source: `yahoo:${symbol}` };
  } catch (error) {
    return {
      bars: [],
      source: "yahoo",
      error: error instanceof Error ? error.message : "yahoo fetch failed",
    };
  }
}
