import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchNaverProfile, fetchNaverQuote } from "./naver";
import { resolveTickerInput } from "./tickerData";
import { fetchYahooDaily } from "./yahoo";

async function withMockFetch<T>(mock: typeof fetch, run: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe("ticker market data providers", () => {
  it("국내 중소형주 이름을 네이버 검색 결과의 코스닥 심볼로 해석한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      items: [{
        code: "328130",
        name: "루닛",
        typeCode: "KOSDAQ",
        typeName: "코스닥",
        nationCode: "KOR",
        category: "stock",
      }],
    })), async () => {
      assert.deepEqual(await resolveTickerInput("루닛"), {
        symbol: "328130.KQ",
        domesticCode: "328130",
      });
    });
  });

  it("Yahoo 현재가에는 09시 일봉 시각 대신 regularMarketTime을 사용한다", async () => {
    const lastBar = 1_787_011_200; // 2026-08-18T00:00:00Z
    const marketTime = 1_787_034_600; // 2026-08-18T06:30:00Z
    await withMockFetch(async () => new Response(JSON.stringify({
      chart: {
        result: [{
          meta: {
            regularMarketPrice: 9_690,
            regularMarketTime: marketTime,
            chartPreviousClose: 10_560,
            shortName: "Lunit",
            exchangeName: "KOE",
            currency: "KRW",
          },
          timestamp: [lastBar - 86_400, lastBar],
          indicators: { quote: [{ close: [10_560, 9_690] }] },
        }],
      },
    })), async () => {
      const daily = await fetchYahooDaily("328130.KQ", "5d");
      assert.equal(daily.asOf, new Date(marketTime * 1000).toISOString());
      assert.equal(daily.previousClose, 10_560);
      assert.equal(daily.lastPrice, 9_690);
    });
  });

  it("네이버 현재가에서 한글 종목명·전일 종가·거래 시각을 보존한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      itemCode: "328130",
      stockName: "루닛",
      closePrice: "9,690",
      compareToPreviousClosePrice: "-870",
      marketStatus: "CLOSE",
      localTradedAt: "2026-08-18T16:10:19+09:00",
      stockExchangeType: { code: "KQ", delayTime: 0, nameKor: "코스닥" },
    })), async () => {
      const quote = await fetchNaverQuote("328130");
      assert.equal(quote.symbol, "328130.KQ");
      assert.equal(quote.name, "루닛");
      assert.equal(quote.previousClose, 10_560);
      assert.equal(quote.delayMinutes, 0);
      assert.equal(quote.asOf, "2026-08-18T07:10:19.000Z");
    });
  });

  it("네이버 종목 페이지의 FnGuide 기업개요를 추출한다", async () => {
    const html = '<div id="summary_info" class="summary_info"><h4>기업개요</h4><p>첫 번째 검증 문장입니다.</p><p>두 번째 검증 문장입니다.</p><div class="txt_notice">출처 : 에프앤가이드</div></div>';
    await withMockFetch(async () => new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }), async () => {
      const profile = await fetchNaverProfile("328130");
      assert.equal(profile.source, "naver-finance:item-main:fnguide");
      assert.equal(profile.longBusinessSummary, "첫 번째 검증 문장입니다. 두 번째 검증 문장입니다.");
      assert.equal(profile.warning, null);
    });
  });
});
