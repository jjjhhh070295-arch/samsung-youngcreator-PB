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
import {
  applyPbSelectedKoreanStocks,
  holdingsToIpsAllocations,
} from "./krTrendPortfolio";
import { formatMarketCapWon, MIN_KR_MARKET_CAP_WON, passesMarketCapFloor } from "./krGainers";
import {
  buildConfirmedPortfolioMetrics,
  equalWeightCumulativePct,
  metricsFromCumulativePct,
} from "./confirmedEquityMetrics";
import {
  DIRECT_BOND_CATALOG,
  isBondEtfName,
  selectVerifiedDirectBonds,
} from "./directBonds";
import { buildDetailedHoldings } from "@/lib/portfolio";
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
      bar("2026-02-01", 12000, 11900),
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

const baseHoldings: PortfolioDetailHolding[] = [
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
    name: "국고채 3년 지표물 (직접투자)",
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

describe("krTrendPortfolio confirmed selection", () => {
  it("체크(확정)한 종목만 주식형 자산에 반영", () => {
    const { holdings, equityPending } = applyPbSelectedKoreanStocks(
      baseHoldings,
      [
        { ticker: "005930", name: "삼성전자" },
        { ticker: "000660", name: "SK하이닉스" },
      ],
      60,
    );
    assert.equal(equityPending, false);
    const equity = holdings.filter((h) => h.bucket === "etf");
    assert.equal(equity.length, 2);
    assert.ok(equity.every((h) => h.role.includes("PB 확정 국내 주식")));
    assert.ok(equity.some((h) => h.name.includes("005930")));
    assert.ok(equity.some((h) => h.name.includes("000660")));
    assert.ok(!equity.some((h) => h.name.includes("KODEX")));
    const eqWeight = equity.reduce((s, h) => s + h.weight, 0);
    assert.ok(Math.abs(eqWeight - 60) < 1e-9);
  });

  it("선택 종목 2개면 주식형 자산에 정확히 2개만", () => {
    const { holdings } = applyPbSelectedKoreanStocks(
      baseHoldings,
      [
        { ticker: "005930", name: "삼성전자" },
        { ticker: "000660", name: "SK하이닉스" },
      ],
      60,
    );
    assert.equal(holdings.filter((h) => h.bucket === "etf").length, 2);
  });

  it("선택 종목이 없으면 PB 확정 대기", () => {
    const { holdings, equityPending } = applyPbSelectedKoreanStocks(baseHoldings, [], 60);
    assert.equal(equityPending, true);
    const equity = holdings.filter((h) => h.bucket === "etf");
    assert.equal(equity.length, 1);
    assert.equal(equity[0].name, "PB 확정 대기");
    assert.equal(equity[0].weight, 60);
  });

  it("IPS에 최종 확정 종목명이 정확히 반영", () => {
    const { holdings } = applyPbSelectedKoreanStocks(
      baseHoldings,
      [
        { ticker: "005930", name: "삼성전자" },
        { ticker: "000660", name: "SK하이닉스" },
      ],
      60,
    );
    const ips = holdingsToIpsAllocations(holdings);
    const equityLines = ips.filter((a) => a.assetClass.startsWith("주식형:"));
    assert.equal(equityLines.length, 2);
    assert.ok(equityLines.some((a) => a.assetClass.includes("삼성전자(005930)")));
    assert.ok(equityLines.some((a) => a.assetClass.includes("SK하이닉스(000660)")));
    assert.ok(!equityLines.some((a) => /반도체 ETF|KODEX/i.test(a.assetClass)));
  });
});

describe("market cap floor 1조", () => {
  it("시가총액 1조 원 미만 종목 제외", () => {
    assert.deepEqual(passesMarketCapFloor(1_000_000_000_000), { passed: true, reason: "ok" });
    assert.deepEqual(passesMarketCapFloor(999_999_999_999), { passed: false, reason: "below_floor" });
    assert.deepEqual(passesMarketCapFloor(500_000_000_000), { passed: false, reason: "below_floor" });
    assert.deepEqual(passesMarketCapFloor(null), { passed: false, reason: "unverifiable" });
    assert.deepEqual(passesMarketCapFloor(0), { passed: false, reason: "unverifiable" });
    assert.equal(MIN_KR_MARKET_CAP_WON, 1_000_000_000_000);
    assert.match(formatMarketCapWon(1_000_000_000_000), /1\.00조원|1조원/);
  });
});

describe("confirmed metrics recalc", () => {
  it("후보 확정 후 예상수익률/변동성/MDD가 선택 종목 기준으로 재계산", () => {
    const seriesByTicker = {
      "005930": [
        { date: "2025-01-02", close: 100 },
        { date: "2025-02-03", close: 110 },
        { date: "2025-03-03", close: 120 },
        { date: "2025-04-01", close: 115 },
        { date: "2025-05-02", close: 130 },
      ],
      "000660": [
        { date: "2025-01-02", close: 200 },
        { date: "2025-02-03", close: 210 },
        { date: "2025-03-03", close: 220 },
        { date: "2025-04-01", close: 200 },
        { date: "2025-05-02", close: 240 },
      ],
    };
    const eq = equalWeightCumulativePct(seriesByTicker);
    assert.equal(eq.status, "ok");
    assert.ok(eq.cumulativePct.length >= 2);

    const nonEquity = eq.cumulativePct.map((_, i) => i * 0.5);
    const confirmed = buildConfirmedPortfolioMetrics({
      seriesByTicker,
      equityWeightPct: 60,
      nonEquityWeightPct: 40,
      nonEquityCumulativePct: nonEquity,
      asOf: "2026-08-21T00:00:00.000Z",
      source: "test",
    });
    assert.equal(confirmed.status, "ok");
    assert.ok(Number.isFinite(confirmed.expectedReturnPct));
    assert.ok(Number.isFinite(confirmed.volatilityPct));
    assert.ok(Number.isFinite(confirmed.mddPct));
    assert.ok(confirmed.portfolioCumulativePct.length >= 2);

    const onlyA = buildConfirmedPortfolioMetrics({
      seriesByTicker: { "005930": seriesByTicker["005930"] },
      equityWeightPct: 60,
      nonEquityWeightPct: 40,
      nonEquityCumulativePct: nonEquity,
    });
    // 선택 종목 집합이 바뀌면 지표도 달라져야 함 (임시 후보 ≠ 확정)
    assert.notEqual(confirmed.expectedReturnPct, onlyA.expectedReturnPct);

    const m = metricsFromCumulativePct(confirmed.portfolioCumulativePct);
    assert.equal(m.expectedReturnPct, confirmed.expectedReturnPct);
    assert.equal(m.volatilityPct, confirmed.volatilityPct);
    assert.equal(m.mddPct, confirmed.mddPct);
  });
});

describe("direct bonds not ETF", () => {
  it("채권형 자산이 ETF가 아니라 직접투자형 채권명으로 표시", () => {
    const bonds = selectVerifiedDirectBonds({ maxCount: 4 });
    assert.ok(bonds.length >= 2);
    for (const b of bonds) {
      assert.equal(b.isEtf, false);
      assert.equal(b.status, "verified");
      assert.equal(isBondEtfName(b.name), false);
      assert.ok(b.maturity.length > 0);
      assert.ok(b.coupon.length > 0);
      assert.ok(b.currency);
      assert.ok(b.creditOrRisk.length > 0);
      assert.ok(b.asOf.length > 0);
      assert.ok(b.source.length > 0);
    }
    assert.ok(DIRECT_BOND_CATALOG.some((b) => b.status === "blocked" && /SpaceX/i.test(b.name)));

    const holdings = buildDetailedHoldings(
      { etf: 40, bond: 30, els: 0, mmf: 20, gold: 5, dollar: 5, raw: 0 },
      {
        rawText: "",
        hasRequirement: false,
        overseasSingleStock: false,
        stockOnly: false,
        rejectsOtherProducts: false,
        highRiskAccepted: false,
        benchmarkOutperformance: false,
        benchmarkTargets: [],
        taxPriority: false,
        tags: [],
        warnings: [],
        actions: [],
      },
      "balanced",
    );
    const bondHoldings = holdings.filter((h) => h.bucket === "bond");
    assert.ok(bondHoldings.length > 0);
    for (const h of bondHoldings) {
      assert.equal(isBondEtfName(h.name), false, `ETF bond slipped in: ${h.name}`);
      assert.match(h.role, /만기|쿠폰|통화|출처|as-of/i);
    }
  });
});
