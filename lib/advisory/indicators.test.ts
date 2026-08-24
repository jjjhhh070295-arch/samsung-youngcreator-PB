import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { macdLast, macdSeries, rsi, rsiSeries, smaSeries } from "./indicators";

describe("ticker indicator series", () => {
  it("SMA는 윈도우가 채워진 시점부터 같은 길이의 시계열을 만든다", () => {
    assert.deepEqual(smaSeries([1, 2, 3, 4, 5, 6], 3), [null, null, 2, 3, 4, 5]);
  });

  it("RSI 시계열의 마지막 값은 요약 RSI와 일치한다", () => {
    const closes = [10, 11, 10, 12, 13, 12, 14, 15, 14, 16, 17, 16, 18, 19, 18, 20, 21, 20];
    const series = rsiSeries(closes, 14);
    assert.equal(series.length, closes.length);
    assert.equal(series.at(-1), rsi(closes, 14));
    assert.ok((series.at(-1) ?? -1) >= 0 && (series.at(-1) ?? 101) <= 100);
  });

  it("MACD 패널의 마지막 값은 요약 MACD와 일치한다", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * 0.7 + Math.sin(i / 3) * 2);
    const series = macdSeries(closes);
    const summary = macdLast(closes);
    const point = series.at(-1);

    assert.equal(series.length, closes.length);
    assert.ok(series.slice(0, 26).every((item) => item.macd == null));
    assert.ok(summary);
    assert.ok(point?.macd != null && point.signal != null && point.histogram != null);
    assert.equal(point?.macd, summary?.macd);
    assert.equal(point?.signal, summary?.signal);
    assert.equal(point?.histogram, summary?.histogram);
  });
});
