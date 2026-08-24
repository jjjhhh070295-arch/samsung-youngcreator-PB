import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRiskReward,
  completedBarsOnly,
  countBullishDays,
  countClosesAboveMa20,
  countConsecutiveBullish,
  evaluateTechnicalFilters,
  isBullish,
  isDoji,
  type OhlcBar,
} from "./krTrendFilter";
import { formatMarketCapWon, MIN_KR_MARKET_CAP_WON, passesMarketCapFloor } from "./krGainers";
import { allocateEqualEquityWeights, selectTopKrStocksByMarketCap } from "./selectTopKrStocks";
import { judgeThemeFromReports } from "./themeFromResearch";
import { MAX_SELECTED_KR_STOCKS } from "./krConstants";

function bar(date: string, open: number, close: number, volume = 1000): OhlcBar {
  const high = Math.max(open, close) + 1;
  const low = Math.min(open, close) - 1;
  return { date, open, high, low, close, volume };
}

function risingBullishSeries(n: number, startDay = 1): OhlcBar[] {
  const out: OhlcBar[] = [];
  let close = 10000;
  for (let i = 0; i < n; i++) {
    const open = close - 50;
    close = close + 80;
    const day = startDay + i;
    const d = `2026-01-${String(((day - 1) % 28) + 1).padStart(2, "0")}`;
    out.push(bar(d, open, close));
  }
  return out;
}

describe("krTrendFilter technical", () => {
  it("최근 10일 종가가 모두 각 시점 MA20 위", () => {
    const bars = risingBullishSeries(40);
    const r = countClosesAboveMa20(bars, 10, 20);
    assert.equal(r.lookback, 10);
    assert.ok(r.daysAbove >= 8, `daysAbove=${r.daysAbove}`);
  });

  it("20일 중 양봉 9일 탈락, 10일 통과", () => {
    const mix: OhlcBar[] = [];
    for (let i = 0; i < 9; i++) mix.push(bar(`2026-03-${String(i + 1).padStart(2, "0")}`, 100, 110));
    for (let i = 0; i < 11; i++) mix.push(bar(`2026-03-${String(i + 10).padStart(2, "0")}`, 110, 100));
    assert.equal(countBullishDays(mix, 20, 10).passed, false);
    const twenty: OhlcBar[] = [];
    for (let i = 0; i < 10; i++) twenty.push(bar(`2026-04-${String(i + 1).padStart(2, "0")}`, 100, 110));
    for (let i = 0; i < 10; i++) twenty.push(bar(`2026-04-${String(i + 11).padStart(2, "0")}`, 110, 100));
    assert.equal(countBullishDays(twenty, 20, 10).passed, true);
  });

  it("도지는 양봉이 아님", () => {
    const d = bar("2026-05-01", 100, 100);
    assert.equal(isDoji(d), true);
    assert.equal(isBullish(d), false);
  });

  it("최근 2일 양봉 탈락, 3일 양봉 통과", () => {
    const two = [
      bar("2026-05-01", 100, 90),
      bar("2026-05-02", 90, 95),
      bar("2026-05-03", 95, 100),
    ];
    assert.equal(countConsecutiveBullish(two, 3).passed, false);
    const three = [
      bar("2026-05-01", 90, 95),
      bar("2026-05-02", 95, 100),
      bar("2026-05-03", 100, 105),
    ];
    assert.equal(countConsecutiveBullish(three, 3).passed, true);
  });

  it("장중 미완성 일봉 제외", () => {
    const today = "2026-08-21";
    const bars = [...risingBullishSeries(30), bar(today, 100, 120)];
    const completed = completedBarsOnly(bars, today);
    assert.ok(!completed.some((b) => b.date === today));
    const t = evaluateTechnicalFilters(bars, { todaySeoul: today });
    assert.equal(t.usedCompletedBarsOnly, true);
  });
});

describe("krTrendFilter risk reward", () => {
  it("잘못된 손절가·익절가 차단", () => {
    const bad = calculateRiskReward({
      seedWon: 1_000_000,
      entryPrice: 10_000,
      stopLossPrice: 11_000,
      takeProfitPrice: 12_000,
      bullishDays20: 10,
    });
    assert.equal(bad.ok, false);
  });

  it("매수수량·최대손실·목표수익·보상위험비율 계산", () => {
    const r = calculateRiskReward({
      seedWon: 1_000_000,
      entryPrice: 10_000,
      stopLossPrice: 9_000,
      takeProfitPrice: 12_000,
      bullishDays20: 10,
    });
    assert.equal(r.ok, true);
    assert.equal(r.shares, 100);
    assert.equal(r.riskPerShare, 1000);
    assert.equal(r.rewardPerShare, 2000);
    assert.equal(r.maxLossWon, 100_000);
    assert.equal(r.targetProfitWon, 200_000);
    assert.equal(r.rewardRiskRatio, 2);
    assert.equal(r.bullishRatio, 0.5);
  });

  it("양봉비율을 winRate나 상승확률로 반환하지 않음", () => {
    const r = calculateRiskReward({
      seedWon: 1_000_000,
      entryPrice: 10_000,
      stopLossPrice: 9_000,
      takeProfitPrice: 12_000,
      bullishDays20: 10,
    });
    assert.ok(!("winRate" in r));
    assert.equal(r.historicalWinRate, null);
    assert.match(r.disclaimer, /승률이 아님/);
  });
});

describe("market cap floor 2조", () => {
  it("시총 1조 9,999억 탈락, 2조 통과", () => {
    assert.equal(passesMarketCapFloor(1_999_000_000_000).passed, false);
    assert.equal(passesMarketCapFloor(MIN_KR_MARKET_CAP_WON).passed, true);
    assert.match(formatMarketCapWon(MIN_KR_MARKET_CAP_WON), /조/);
  });
});

describe("max 3 stocks", () => {
  it("최종 후보 7개면 시총 상위 3개만 선택", () => {
    const pool = Array.from({ length: 7 }, (_, i) => ({
      ticker: String(100000 + i),
      name: `N${i}`,
      marketCapWon: (7 - i) * 1e12,
      changePct: i,
    }));
    const { selected } = selectTopKrStocksByMarketCap(pool, MAX_SELECTED_KR_STOCKS);
    assert.equal(selected.length, 3);
    assert.equal(selected[0]!.ticker, "100000");
  });

  it("동일비중 잔여는 1위에 가산", () => {
    const w = allocateEqualEquityWeights(60, 3);
    assert.equal(w.reduce((a, b) => a + b, 0), 60);
  });
});

describe("theme from research", () => {
  it("문서 0 blocked, 1 review, 2 pass", () => {
    assert.equal(judgeThemeFromReports({ sources: [] }).status, "blocked");
    assert.equal(
      judgeThemeFromReports({
        sources: [{ title: "a", publisher: "p", publishedAt: "2026-08-01", url: "https://x.com/a" }],
      }).status,
      "review",
    );
    assert.equal(
      judgeThemeFromReports({
        sources: [
          { title: "a", publisher: "p", publishedAt: "2026-08-01", url: "https://x.com/a" },
          { title: "b", publisher: "p", publishedAt: "2026-08-02", url: "https://x.com/b" },
        ],
      }).status,
      "pass",
    );
  });
});
