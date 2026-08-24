import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchNaverKospiIntraday } from "../../../lib/homeMarketChart";

async function withMockFetch<T>(mock: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("home KOSPI intraday chart", () => {
  it("네이버 코스피 분봉과 전일 종가를 홈 차트 형식으로 변환한다", async () => {
    await withMockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/basic")) {
        return new Response(JSON.stringify({
          closePrice: "6,429.25",
          compareToPreviousClosePrice: "-440.58",
          stockExchangeType: { delayTime: 0 },
        }));
      }
      return new Response(JSON.stringify([
        { localDateTime: "20260819090000", currentPrice: 6500.88 },
        { localDateTime: "20260819090100", currentPrice: 6467.32 },
      ]));
    }, async () => {
      const chart = await fetchNaverKospiIntraday();
      assert.deepEqual(chart.points, [
        { time: "09:00", value: 6500.88 },
        { time: "09:01", value: 6467.32 },
      ]);
      assert.equal(chart.prevClose, 6869.83);
      assert.equal(chart.startTime, "09:00");
      assert.equal(chart.endTime, "09:01");
      assert.equal(chart.delayMinutes, 0);
    });
  });
});
