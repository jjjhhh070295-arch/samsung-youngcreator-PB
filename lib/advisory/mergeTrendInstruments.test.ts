import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergePortfolioPreviewRows, mergeTrendConfirmedIntoSelected, redistributeAssetClassWeights, type PortfolioPreviewRow } from "./mergeTrendInstruments";

describe("mergeTrendConfirmedIntoSelected", () => {
  it("adds confirmed stocks to domesticEquity without duplicates", () => {
    const first = mergeTrendConfirmedIntoSelected([], [
      { ticker: "005930", name: "삼성전자", price: 70000, asOf: "2026-09-04", source: "trend", exchange: "KOSPI" },
      { ticker: "000660", name: "SK하이닉스", price: 200000, exchange: "KOSPI" },
    ]);
    assert.equal(first.length, 2);
    assert.equal(first[0].weightWithinClass, 100);
    assert.equal(first[1].weightWithinClass, 0);
    assert.equal(first[0].symbol, "005930.KS");

    const second = mergeTrendConfirmedIntoSelected(first, [
      { ticker: "005930.KS", name: "삼성전자", price: 71000 },
      { ticker: "000660", name: "SK하이닉스" },
    ]);
    assert.equal(second.length, 2);
    assert.equal(second[0].price, 71000);
    assert.equal(second[0].weightWithinClass, 100);
  });

  it("keeps unrelated asset-class selections", () => {
    const current = [
      {
        symbol: "153130.KS",
        name: "KODEX 단기채권",
        exchange: "KRX",
        currency: "KRW",
        kind: "채권 ETF",
        price: null,
        changePct: null,
        asOf: null,
        source: "catalog",
        assetClass: "domesticBond" as const,
        weightWithinClass: 100,
      },
    ];
    const next = mergeTrendConfirmedIntoSelected(current, [
      { ticker: "005930", name: "삼성전자" },
    ]);
    assert.equal(next.length, 2);
    assert.ok(next.some((row) => row.assetClass === "domesticBond"));
    assert.ok(next.some((row) => row.assetClass === "domesticEquity"));
  });
});

describe("redistributeAssetClassWeights", () => {
  it("keeps every selected representative bond reflected by totaling 100%", () => {
    const base = {
      exchange: "KRX", currency: "KRW", kind: "채권 ETF", price: null,
      changePct: null, asOf: null, source: "catalog", assetClass: "domesticBond" as const,
    };
    const result = redistributeAssetClassWeights([
      { ...base, symbol: "153130.KS", name: "단기채", weightWithinClass: 100 },
      { ...base, symbol: "114260.KS", name: "중기채", weightWithinClass: 0 },
      { ...base, symbol: "148070.KS", name: "장기채", weightWithinClass: 0 },
    ], "domesticBond");
    assert.deepEqual(result.map((item) => item.weightWithinClass), [33.33, 33.33, 33.34]);
    assert.equal(result.reduce((sum, item) => sum + item.weightWithinClass, 0), 100);
  });
});

describe("mergePortfolioPreviewRows", () => {
  it("combines an existing holding and an additional purchase of the same ticker", () => {
    const common = {
      name: "삼성전자", exchange: "KOSPI", currency: "KRW", kind: "국내 종목",
      price: 70000, changePct: null, asOf: null, assetClass: "domesticEquity" as const,
    };
    const rows: PortfolioPreviewRow[] = [
      {
        ...common, symbol: "005930", source: "기본정보 기존 보유", weightWithinClass: 0,
        totalWeight: 8, amountWon: 2_800_000_000, fixed: true, hasExisting: true,
        hasNew: false, fixedAmountWon: 2_800_000_000, newAmountWon: 0, newWeightWithinClass: 0,
      },
      {
        ...common, symbol: "005930.KS", source: "검색", weightWithinClass: 22,
        totalWeight: 22, amountWon: 7_700_000_000, fixed: false, hasExisting: false,
        hasNew: true, fixedAmountWon: 0, newAmountWon: 7_700_000_000, newWeightWithinClass: 22,
      },
    ];

    const result = mergePortfolioPreviewRows(rows);
    assert.equal(result.length, 1);
    assert.equal(result[0].totalWeight, 30);
    assert.equal(result[0].amountWon, 10_500_000_000);
    assert.equal(result[0].fixedAmountWon, 2_800_000_000);
    assert.equal(result[0].newAmountWon, 7_700_000_000);
    assert.equal(result[0].newWeightWithinClass, 22);
    assert.equal(result[0].hasExisting, true);
    assert.equal(result[0].hasNew, true);
  });

  it("does not combine different tickers or asset classes", () => {
    const base: PortfolioPreviewRow = {
      symbol: "005930", name: "삼성전자", exchange: "KOSPI", currency: "KRW", kind: "국내 종목",
      price: null, changePct: null, asOf: null, source: "test", assetClass: "domesticEquity",
      weightWithinClass: 100, totalWeight: 10, amountWon: 1, fixed: false, hasExisting: false,
      hasNew: true, fixedAmountWon: 0, newAmountWon: 1, newWeightWithinClass: 100,
    };
    const result = mergePortfolioPreviewRows([
      base,
      { ...base, symbol: "000660.KS", name: "SK하이닉스" },
      { ...base, symbol: "005930.KS", assetClass: "globalEquity" },
    ]);
    assert.equal(result.length, 3);
  });
});
