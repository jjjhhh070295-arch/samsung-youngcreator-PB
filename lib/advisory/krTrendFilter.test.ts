import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateRiskReward,
  countBullishDays,
  countClosesAboveMa20,
  countConsecutiveBullish,
  evaluateTechnicalFilters,
  type OhlcBar,
} from "./krTrendFilter";
import { applyPbSelectedKoreanStocks } from "./krTrendPortfolio";
import type { PortfolioDetailHolding } from "@/lib/portfolio";

function bar(date: string, open: number, close: number, volume = 1000): OhlcBar {
  const high = Math.max(open, close) + 1;
  const low = Math.min(open, close) - 1;
  return { date, open, high, low, close, volume };
}

/** 상승 추세 + 양봉 위주 시리즈 생성 (close가 점진 상승, 대부분 양봉). */
function risingBullishSeries(n: number): OhlcBar[] {
  const out: OhlcBar[] = [];
  let close = 10000;
  for (let i = 0; i < n; i++) {
    const open = close - 50;
    close = close + 80;
    const d = `2026-01-${String((i % 28) + 1).padStart(2, "0")}`;
    out.push(bar(d, open, close, 1000 + i));
  }
  return out;
}

describe("krTrendFilter technical", () => {
  it("10일 중 20일선 위 조건 계산", () => {
    const bars = risingBullishSeries(40);
    const r = countClosesAboveMa20(bars, 10, 20);
    assert.equal(r.lookback, 10);
    assert.ok(r.daysAbove >= 8, `daysAbove=${r.daysAbove}`);
    assert.match(r.ratioLabel, /^\d+\/10/);
  });

  it("20일 양봉 수 계산", () => {
    const bars = risingBullishSeries(30);
    const r = countBullishDays(bars, 20, 10);
    assert.equal(r.lookback, 20);
    assert.ok(r.bullishDays >= 10);
    assert.equal(r.passed, true);
    assert.equal(r.ratioLabel, `${r.bullishDays}/20`);
  });

  it("3일 연속 양봉 계산", () => {
    const bars = [
      ...risingBullishSeries(10),
      bar("2026-02-01", 12000, 11900), // 음봉으로 끊음
      bar("2026-02-02", 11900, 12100),
      bar("2026-02-03", 12100, 12200),
      bar("2026-02-04", 12200, 12300),
    ];
    const r = countConsecutiveBullish(bars, 3);
    assert.equal(r.consecutive, 3);
    assert.equal(r.passed, true);
  });

  it("전체 기술 필터 통과", () => {
    const bars = risingBullishSeries(45);
    const t = evaluateTechnicalFilters(bars);
    assert.equal(t.passed, true);
  });
});

describe("krTrendFilter risk reward", () => {
  it("손익비 계산", () => {
    const r = calculateRiskReward({
      seedWon: 1_000_000,
      currentPrice: 10_000,
      stopLossPrice: 9_000,
      takeProfitPrice: 12_000,
      bullishDays20: 10,
    });
    assert.equal(r.shares, 100);
    assert.equal(r.winRate, 0.5);
    assert.equal(r.lossRate, 0.5);
    assert.equal(r.lossPerShare, 1000);
    assert.equal(r.profitPerShare, 2000);
    assert.equal(r.expectedLossWon, 100 * 1000 * 0.5);
    assert.equal(r.expectedProfitWon, 100 * 2000 * 0.5);
    assert.equal(r.riskRewardRatio, 2);
    assert.equal(r.currency, "KRW");
  });
});

describe("krTrendPortfolio selection", () => {
  const base: PortfolioDetailHolding[] = [
    {
      bucket: "etf",
      name: "KODEX 미국S&P500",
      weight: 36,
      role: "legacy",
      taxNote: "",
      source: "engine",
    },
    {
      bucket: "etf",
      name: "KODEX 200",
      weight: 24,
      role: "legacy",
      taxNote: "",
      source: "engine",
    },
    {
      bucket: "bond",
      name: "국고채 3년",
      weight: 25,
      role: "bond",
      taxNote: "",
      source: "engine",
    },
    {
      bucket: "mmf",
      name: "MMF",
      weight: 5,
      role: "cash",
      taxNote: "",
      source: "engine",
    },
    {
      bucket: "gold",
      name: "금",
      weight: 10,
      role: "alt",
      taxNote: "",
      source: "engine",
    },
  ];

  it("PB가 체크한 종목만 최종 포트폴리오 주식 구간에 반영", () => {
    const { holdings, equityPending } = applyPbSelectedKoreanStocks(
      base,
      [
        { ticker: "005930", name: "삼성전자" },
        { ticker: "000660", name: "SK하이닉스" },
      ],
      60,
    );
    assert.equal(equityPending, false);
    const equity = holdings.filter((h) => h.bucket === "etf");
    assert.equal(equity.length, 2);
    assert.ok(equity.every((h) => h.role.includes("PB 선택 국내 주식")));
    assert.ok(equity.some((h) => h.name.includes("005930")));
    assert.ok(!equity.some((h) => h.name.includes("KODEX")));
    assert.ok(holdings.some((h) => h.bucket === "bond" && h.name.includes("국고채")));
    const eqWeight = equity.reduce((s, h) => s + h.weight, 0);
    assert.ok(Math.abs(eqWeight - 60) < 1e-9);
  });

  it("체크 종목이 없으면 주식 확정 대기", () => {
    const { holdings, equityPending } = applyPbSelectedKoreanStocks(base, [], 60);
    assert.equal(equityPending, true);
    const equity = holdings.filter((h) => h.bucket === "etf");
    assert.equal(equity.length, 1);
    assert.equal(equity[0].name, "주식 확정 대기");
    assert.equal(equity[0].weight, 60);
  });
});
