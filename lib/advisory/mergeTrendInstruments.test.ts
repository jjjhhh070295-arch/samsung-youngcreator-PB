import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeTrendConfirmedIntoSelected, redistributeAssetClassWeights } from "./mergeTrendInstruments";

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
        symbol: "273130.KS",
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
      { ...base, symbol: "273130.KS", name: "단기채", weightWithinClass: 100 },
      { ...base, symbol: "114260.KS", name: "중기채", weightWithinClass: 0 },
      { ...base, symbol: "148070.KS", name: "장기채", weightWithinClass: 0 },
    ], "domesticBond");
    assert.deepEqual(result.map((item) => item.weightWithinClass), [33.33, 33.33, 33.34]);
    assert.equal(result.reduce((sum, item) => sum + item.weightWithinClass, 0), 100);
  });
});
