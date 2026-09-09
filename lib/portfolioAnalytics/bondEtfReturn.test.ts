import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approximateBondEtfOneYearTotalReturn,
  decomposeBondEtfTotalReturn,
  projectedBondEtfTerminalPrice,
} from "./bondEtfScenario";
import {
  bondEtfUnrealizedHoldingPnL,
  bondEtfRealizedPricePnL,
  weightedPortfolioReturn,
} from "./bondEtfPnL";
import { selectionToHoldings } from "./selection";

describe("bondEtfPnL", () => {
  it("fixture: 100 shares @10000, mark 10200, dist 300 → price 20k, total 50k", () => {
    const r = bondEtfUnrealizedHoldingPnL({
      shares: 100,
      avgAcquisitionPrice: 10_000,
      currentMarketPrice: 10_200,
      distributionsPerShareDuringHold: 300,
    });
    assert.equal(r.unrealizedPricePnL, 20_000);
    assert.equal(r.holdingPeriodDistributions, 30_000);
    assert.equal(r.holdingPeriodTotalPnLBeforeCosts, 50_000);
    assert.equal(r.isRealized, false);
  });

  it("distinguishes realized sale P/L", () => {
    const r = bondEtfRealizedPricePnL({
      sharesSold: 40,
      salePrice: 10_500,
      acquisitionPriceAllocated: 10_000,
    });
    assert.equal(r.realizedPricePnL, 20_000);
    assert.equal(r.isRealized, true);
  });

  it("does not renormalize missing instrument returns to 100%", () => {
    const r = weightedPortfolioReturn([
      { weight: 0.6, returnRate: 0.08 },
      { weight: 0.2, returnRate: 0.04 },
      { weight: 0.2, returnRate: null },
    ]);
    assert.equal(r.status, "partial");
    assert.ok(r.portfolioReturn != null);
    assert.ok(Math.abs(r.portfolioReturn! - (0.6 * 0.08 + 0.2 * 0.04)) < 1e-12);
    assert.equal(r.missingWeight, 0.2);
  });

  it("complete weighted example 60/20/20 → 6.6%", () => {
    const r = weightedPortfolioReturn([
      { weight: 0.6, returnRate: 0.08 },
      { weight: 0.2, returnRate: 0.04 },
      { weight: 0.2, returnRate: 0.05 },
    ]);
    assert.equal(r.status, "complete");
    assert.ok(r.portfolioReturn != null);
    assert.ok(Math.abs(r.portfolioReturn! - 0.066) < 1e-12);
  });
});

describe("bondEtfScenario", () => {
  it("YTM 5%, expense 0.1%, duration 2, +1%p rate → ~2.9%", () => {
    const r = approximateBondEtfOneYearTotalReturn({
      portfolioYtm: 0.05,
      expenseNotAlreadyInYtm: 0.001,
      effectiveDuration: 2,
      spreadDuration: null,
      rateChange: 0.01,
      spreadChange: 0,
      allowMissingSpreadDuration: false,
    });
    assert.equal(r.status, "ok");
    assert.ok(r.totalReturn != null);
    assert.ok(Math.abs(r.totalReturn! - 0.029) < 1e-12);
  });

  it("5% total with 3% cash distribution → 2% price return, not 8%", () => {
    const d = decomposeBondEtfTotalReturn({ totalReturn: 0.05, cashDistributionRate: 0.03 });
    assert.equal(d.status, "ok");
    assert.ok(Math.abs((d.priceReturn ?? 0) - 0.02) < 1e-12);
    const projected = projectedBondEtfTerminalPrice({
      currentPrice: 100,
      shares: 10,
      totalReturn: 0.05,
      cashDistributionPerShare: 3,
    });
    assert.equal(projected.projectedTotalProfit, 50);
    assert.equal(projected.projectedPricePnL, 20);
    assert.equal(projected.projectedTerminalPrice, 102);
  });

  it("preserves total when distribution decomposition unavailable", () => {
    const d = decomposeBondEtfTotalReturn({ totalReturn: 0.05, cashDistributionRate: null });
    assert.equal(d.status, "partial");
    assert.equal(d.priceReturn, null);
  });

  it("refuses spread shock without spread duration unless PB allows", () => {
    const blocked = approximateBondEtfOneYearTotalReturn({
      portfolioYtm: 0.05,
      expenseNotAlreadyInYtm: 0,
      effectiveDuration: 2,
      spreadDuration: null,
      rateChange: 0,
      spreadChange: 0.01,
      allowMissingSpreadDuration: false,
    });
    assert.equal(blocked.status, "unavailable");
  });
});

describe("selectionToHoldings bond ETF routing", () => {
  it("routes bond ETF to etf/bond and never stock EPS path", () => {
    const holdings = selectionToHoldings(
      { domesticBond: 100, cash: 0 },
      [
        {
          symbol: "0099L0.KS",
          name: "ACE 우량회사채(AA-이상)액티브",
          currency: "KRW",
          kind: "채권 ETF",
          assetClass: "domesticBond",
          weightWithinClass: 100,
        },
      ],
    );
    assert.equal(holdings[0].assetType, "etf");
    assert.equal(holdings[0].subType, "bond");
  });

  it("routes direct bond labels away from stock", () => {
    const holdings = selectionToHoldings(
      { domesticBond: 100, cash: 0 },
      [
        {
          symbol: "BOND-KEPCO",
          name: "한전채",
          currency: "KRW",
          kind: "직접투자 채권",
          assetClass: "domesticBond",
          weightWithinClass: 100,
        },
      ],
    );
    assert.equal(holdings[0].assetType, "other");
    assert.equal(holdings[0].subType, "bond");
  });
});
