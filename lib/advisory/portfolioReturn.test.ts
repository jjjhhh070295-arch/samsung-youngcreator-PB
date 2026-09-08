import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calcPortfolioUnrealizedReturn,
  lossTagFromReturn,
} from "./portfolioReturn";
import {
  buildIpsPurchasePlan,
  floorToIncrement,
  weightedAveragePrice,
} from "./ipsPurchasePlan";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";

describe("lossTagFromReturn thresholds", () => {
  it("maps -4.99 / -5 / -9.99 / -10 / -10.01 correctly", () => {
    assert.equal(lossTagFromReturn(-4.99), null);
    assert.equal(lossTagFromReturn(-5), "손실중");
    assert.equal(lossTagFromReturn(-9.99), "손실중");
    assert.equal(lossTagFromReturn(-10), "관리필요");
    assert.equal(lossTagFromReturn(-10.01), "관리필요");
    assert.equal(lossTagFromReturn(0), null);
    assert.equal(lossTagFromReturn(null), null);
  });
});

describe("calcPortfolioUnrealizedReturn", () => {
  it("uses KRW sum formula, not average of percents", () => {
    const result = calcPortfolioUnrealizedReturn(
      [
        { quantity: 100, avgPrice: 10_000, lastPrice: 9_000, currency: "KRW" }, // -10%
        { quantity: 100, avgPrice: 10_000, lastPrice: 10_000, currency: "KRW" }, // 0%
      ],
      1350,
    );
    // (900k+1000k - 1000k-1000k) / 2000k = -5%
    assert.equal(result.status, "ok");
    assert.ok(result.returnPct != null);
    assert.ok(Math.abs(result.returnPct! - -5) < 1e-9);
    assert.equal(result.lossTag, "손실중");
  });

  it("marks incomplete when any quote is missing", () => {
    const result = calcPortfolioUnrealizedReturn(
      [
        { quantity: 1, avgPrice: 100, lastPrice: 90, currency: "KRW" },
        { quantity: 1, avgPrice: 100, lastPrice: null, currency: "KRW" },
      ],
      1350,
    );
    assert.equal(result.status, "incomplete");
    assert.equal(result.returnPct, null);
    assert.equal(result.lossTag, null);
  });

  it("marks unavailable when acquisition cost is zero", () => {
    const result = calcPortfolioUnrealizedReturn(
      [{ quantity: 1, avgPrice: null, lastPrice: 100, currency: "KRW" }],
      1350,
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.lossTag, null);
  });
});

describe("purchase plan helpers", () => {
  it("floors to whole shares and averages cost", () => {
    assert.equal(floorToIncrement(10.9, 1), 10);
    assert.equal(weightedAveragePrice(10, 100, 10, 200), 150);
  });

  it("builds purchase lines from designated prices", () => {
    const draft: ManualPortfolioDraft = {
      allocation: {
        domesticEquity: 100,
        globalEquity: 0,
        domesticBond: 0,
        globalBond: 0,
        alternatives: 0,
        cash: 0,
      },
      selected: [
        {
          symbol: "005930",
          name: "삼성전자",
          assetClass: "domesticEquity",
          weightWithinClass: 100,
          designatedPrice: 70_000,
          currency: "KRW",
          exchange: "KRX",
          kind: "stock",
          quotationKind: "share",
          quantityIncrement: 1,
        },
      ],
    };
    const plan = buildIpsPurchasePlan(draft, { investableWon: 350_000_000, fxUsdKrw: 1350 });
    assert.equal(plan.ok, true);
    assert.equal(plan.lines.length, 1);
    assert.equal(plan.lines[0].quantity, 5000); // 350e6 / 70000
    assert.ok(plan.lines[0].remainderKrw < 70_000);
  });
});
