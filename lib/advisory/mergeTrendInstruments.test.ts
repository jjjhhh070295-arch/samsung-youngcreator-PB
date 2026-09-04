import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeTrendConfirmedIntoSelected } from "./mergeTrendInstruments";

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
