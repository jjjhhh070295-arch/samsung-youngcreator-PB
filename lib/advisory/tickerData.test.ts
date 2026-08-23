import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { domesticCodeFromSymbol, fetchNaverDaily, fetchNaverProfile, fetchNaverQuote } from "./naver";
import { fetchTickerDaily, resolveTickerInput } from "./tickerData";
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
  it("명시적 교육용 모멘텀 심볼은 네트워크 없이 고정 fixture만 연다", async () => {
    let fetchCount = 0;
    await withMockFetch(async () => {
      fetchCount += 1;
      throw new Error("교육용 fixture에서 네트워크를 호출하면 안 됩니다.");
    }, async () => {
      const resolved = await resolveTickerInput("DEMO-HIGH");
      assert.deepEqual(resolved, {
        symbol: "DEMO-HIGH",
        domesticCode: null,
        momentumDemoSymbol: "DEMO-HIGH",
      });
      const daily = await fetchTickerDaily(resolved);
      assert.equal(daily.momentumDataset?.label, "교육용 데모 데이터");
      assert.equal(daily.momentumDataset?.dataMode, "demo");
      assert.equal(fetchCount, 0);
    });
  });

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

  it("영문 공식 종목명 NAVER를 국내 코스피 종목으로 해석한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      items: [{
        code: "035420",
        name: "NAVER",
        typeCode: "KOSPI",
        typeName: "코스피",
        nationCode: "KOR",
        category: "stock",
      }],
    })), async () => {
      assert.deepEqual(await resolveTickerInput("NAVER"), {
        symbol: "035420.KS",
        domesticCode: "035420",
      });
    });
  });

  it("공백이 포함된 LS ELECTRIC 공식 종목명을 국내 종목으로 해석한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      items: [{
        code: "010120",
        name: "LS ELECTRIC",
        typeCode: "KOSPI",
        typeName: "코스피",
        nationCode: "KOR",
        category: "stock",
      }],
    })), async () => {
      assert.deepEqual(await resolveTickerInput("ls electric"), {
        symbol: "010120.KS",
        domesticCode: "010120",
      });
    });
  });

  it("신규 상장 종목의 영문 포함 6자리 KRX 코드를 보존한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      items: [{
        code: "0088M0",
        name: "메쥬",
        typeCode: "KOSDAQ",
        typeName: "코스닥",
        nationCode: "KOR",
        category: "stock",
      }],
    })), async () => {
      assert.deepEqual(await resolveTickerInput("메쥬"), {
        symbol: "0088M0.KQ",
        domesticCode: "0088M0",
      });
      assert.equal(domesticCodeFromSymbol("0088M0.KQ"), "0088M0");
    });
  });

  it("상장 첫날 일봉이 하나뿐이어도 현재가 데이터를 반환한다", async () => {
    await withMockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/basic")) {
        return new Response(JSON.stringify({
          itemCode: "0088M0",
          stockName: "메쥬",
          closePrice: "11,850",
          compareToPreviousClosePrice: "0",
          marketStatus: "CLOSE",
          localTradedAt: "2026-08-19T16:10:00+09:00",
          stockExchangeType: { code: "KQ", delayTime: 0, nameKor: "코스닥" },
        }));
      }
      return new Response(JSON.stringify([{ localDate: "20260819", closePrice: 11_850 }]));
    }, async () => {
      const daily = await fetchNaverDaily("0088M0");
      assert.equal(daily.name, "메쥬");
      assert.deepEqual(daily.closes, [11_850]);
      assert.deepEqual(daily.dates, ["2026-08-19"]);
    });
  });

  it("해외 영문 티커는 국내 부분일치 결과가 있어도 Yahoo 티커로 유지한다", async () => {
    await withMockFetch(async () => new Response(JSON.stringify({
      items: [{
        code: "1234A0",
        name: "META KOREA",
        typeCode: "KOSDAQ",
        typeName: "코스닥",
        nationCode: "KOR",
        category: "stock",
      }],
    })), async () => {
      assert.deepEqual(await resolveTickerInput("META"), {
        symbol: "META",
        domesticCode: null,
      });
      assert.equal(domesticCodeFromSymbol("ABCDEF"), null);
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
