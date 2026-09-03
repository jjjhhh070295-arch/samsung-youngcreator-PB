"use client";

import { useCallback, useMemo, useState } from "react";
import type { EnrichedBar } from "@/lib/advisory/tickerIndicatorsExtended";
import { enrichBars, streakMarkers, volumeProfile } from "@/lib/advisory/tickerIndicatorsExtended";
import { aggregateOhlcBars, type OhlcTimeframe, timeframeLabel } from "@/lib/advisory/ohlcAggregate";
import type { OhlcBar } from "@/lib/advisory/ohlcTypes";
import type { IndicatorKind } from "@/lib/advisory/tickerAnalysisPresets";
import type { DrawingDocument } from "@/lib/advisory/drawingTypes";
import { TickerCandleChart } from "./TickerCandleChart";

export type MultiChartEntry = {
  id: string;
  query: string;
  symbol: string;
  name: string;
  currency: string;
  lastPrice: number;
  d1Pct: number | null;
  dailyBars: EnrichedBar[];
  busy: boolean;
  error?: string;
};

function toOhlcBar(bar: EnrichedBar): OhlcBar {
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function barsForTimeframe(dailyBars: EnrichedBar[], timeframe: OhlcTimeframe): EnrichedBar[] {
  const raw = dailyBars.map(toOhlcBar);
  const aggregated = aggregateOhlcBars(raw, timeframe);
  return enrichBars(aggregated.slice(-260));
}

export function TickerMultiChartPanel({
  open,
  onClose,
  timeframe,
  overlayKinds,
  primary,
  entries,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  timeframe: OhlcTimeframe;
  overlayKinds: IndicatorKind[];
  primary: MultiChartEntry | null;
  entries: MultiChartEntry[];
  onAdd: (query: string) => Promise<void>;
}) {
  const [addInput, setAddInput] = useState("");

  const displayEntries = useMemo(() => {
    const merged = [...entries];
    if (primary && !merged.some((e) => e.symbol === primary.symbol)) {
      merged.unshift(primary);
    } else if (primary) {
      return merged.map((e) => (e.symbol === primary.symbol ? primary : e));
    }
    return merged.slice(0, 4);
  }, [entries, primary]);

  if (!open) return null;

  const addTicker = async () => {
    const q = addInput.trim();
    if (!q) return;
    setAddInput("");
    await onAdd(q);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-bold text-[#1428A0]">멀티차트</p>
            <p className="text-[11px] text-fg-muted">
              {timeframeLabel(timeframe)} · 최대 4종목 동시 비교
            </p>
          </div>
          <button type="button" className="btn-outline text-xs" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            className="input max-w-xs text-sm"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="티커 추가 (예: 000660, SK하이닉스)"
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTicker();
            }}
          />
          <button type="button" className="btn-primary text-xs" disabled={!addInput.trim()} onClick={() => void addTicker()}>
            종목 추가
          </button>
        </div>

        <div className="grid flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          {displayEntries.map((entry) => {
            const bars = barsForTimeframe(entry.dailyBars, timeframe);
            const vp = volumeProfile(bars.map(toOhlcBar));
            const streak = streakMarkers(bars.map(toOhlcBar));
            const d1Cls =
              entry.d1Pct != null && entry.d1Pct > 0
                ? "text-red-600"
                : entry.d1Pct != null && entry.d1Pct < 0
                  ? "text-blue-700"
                  : "text-fg";
            const emptyDrawing: DrawingDocument = {
              version: 1,
              objects: [],
              style: { color: "#1428A0", strokeWidth: 1.5, showLabels: true },
              updatedAt: new Date().toISOString(),
            };

            return (
              <div key={entry.id} className="overflow-hidden rounded-xl border border-border bg-white">
                <div className="border-b border-border px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-fg">{entry.name}</p>
                      <p className="text-[10px] text-fg-muted">{entry.symbol}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-[#1428A0]">
                        {entry.lastPrice.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}
                        <span className="ml-1 text-[10px] font-semibold">{entry.currency}</span>
                      </p>
                      {entry.d1Pct != null && (
                        <p className={`text-[10px] font-semibold ${d1Cls}`}>
                          1일 {entry.d1Pct > 0 ? "+" : ""}
                          {entry.d1Pct.toFixed(2)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {entry.busy ? (
                  <p className="px-3 py-8 text-center text-xs text-fg-muted">불러오는 중…</p>
                ) : entry.error ? (
                  <p className="px-3 py-8 text-center text-xs text-red-600">{entry.error}</p>
                ) : (
                  <TickerCandleChart
                    bars={bars}
                    overlayKinds={overlayKinds.filter((k) => k === "sma")}
                    streakMarkers={streak}
                    volumeProfile={vp}
                    drawingDoc={emptyDrawing}
                    onDrawingChange={() => {}}
                    currency={entry.currency}
                    latestPrice={entry.lastPrice}
                    compact
                    enableDrawings={false}
                    title={entry.name}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function useMultiChartEntries() {
  const [entries, setEntries] = useState<MultiChartEntry[]>([]);

  const upsertEntry = useCallback((entry: MultiChartEntry) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.symbol === entry.symbol);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = entry;
        return next;
      }
      return [...prev, entry].slice(-4);
    });
  }, []);

  const setEntryBusy = useCallback((query: string, busy: boolean) => {
    setEntries((prev) =>
      prev.map((e) => (e.query === query ? { ...e, busy } : e)),
    );
  }, []);

  return { entries, upsertEntry, setEntryBusy, setEntries };
}
