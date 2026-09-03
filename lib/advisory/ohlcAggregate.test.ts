import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateOhlcBars, chartExportFilename, timeframeStorageSuffix } from "./ohlcAggregate";
import type { OhlcBar } from "./ohlcTypes";

const daily: OhlcBar[] = [
  { time: "2026-01-05", open: 100, high: 110, low: 95, close: 105, volume: 1000 },
  { time: "2026-01-06", open: 105, high: 112, low: 100, close: 108, volume: 1200 },
  { time: "2026-01-07", open: 108, high: 115, low: 107, close: 110, volume: 900 },
  { time: "2026-01-12", open: 110, high: 118, low: 109, close: 115, volume: 1500 },
  { time: "2026-02-03", open: 115, high: 120, low: 114, close: 118, volume: 800 },
  { time: "2026-02-04", open: 118, high: 122, low: 116, close: 120, volume: 700 },
];

describe("aggregateOhlcBars", () => {
  it("returns daily bars unchanged", () => {
    assert.deepEqual(aggregateOhlcBars(daily, "daily"), daily);
  });

  it("aggregates weekly OHLCV deterministically", () => {
    const weekly = aggregateOhlcBars(daily, "weekly");
    assert.equal(weekly.length, 3);
    assert.equal(weekly[0].open, 100);
    assert.equal(weekly[0].high, 115);
    assert.equal(weekly[0].low, 95);
    assert.equal(weekly[0].close, 110);
    assert.equal(weekly[0].volume, 3100);
    assert.equal(weekly[1].open, 110);
    assert.equal(weekly[1].close, 115);
    assert.equal(weekly[1].volume, 1500);
    assert.equal(weekly[2].open, 115);
    assert.equal(weekly[2].close, 120);
    assert.equal(weekly[2].volume, 1500);
  });

  it("aggregates monthly OHLCV deterministically", () => {
    const monthly = aggregateOhlcBars(daily, "monthly");
    assert.equal(monthly.length, 2);
    assert.equal(monthly[0].time, "2026-01-12");
    assert.equal(monthly[0].open, 100);
    assert.equal(monthly[0].close, 115);
    assert.equal(monthly[0].volume, 4600);
    assert.equal(monthly[1].open, 115);
    assert.equal(monthly[1].close, 120);
    assert.equal(monthly[1].volume, 1500);
  });

  it("maps timeframe to storage/export suffix", () => {
    assert.equal(timeframeStorageSuffix("daily"), "1D");
    assert.equal(timeframeStorageSuffix("weekly"), "1W");
    assert.equal(timeframeStorageSuffix("monthly"), "1M");
    assert.equal(chartExportFilename("005930.KS", "daily"), "chart-005930KS-1D.png");
    assert.equal(chartExportFilename("000660.KS", "weekly"), "chart-000660KS-1W.png");
  });
});
