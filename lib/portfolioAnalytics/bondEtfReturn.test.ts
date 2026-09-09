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
import {
  parseAceBondEtfFundamentals,
  parseLqdBondEtfFundamentals,
} from "./bondEtfFundamentals";
import { expectedReturn } from "./expectedReturn";
import { selectionToHoldings } from "./selection";
import type { Holding } from "./types";

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

  it("is connected to production expectedReturn with rate and spread shocks", () => {
    const holding: Holding = {
      ticker: "LQD",
      name: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
      weight: 1,
      currency: "USD",
      assetType: "etf",
      subType: "bond",
      bondEtfScenario: {
        rateChangeBp: 100,
        spreadChangeBp: 50,
        allowMissingSpreadDuration: false,
      },
    };
    const estimate = expectedReturn(holding, {
      prices: [],
      source: ["official-fixture"],
      fundamentals: {
        yieldToMaturity: 0.05,
        expenseRatio: 0.001,
        duration: 2,
        spreadDuration: 1.5,
        factsAsOf: "2026-09-08",
        factsSourceLabel: "fixture",
      },
    }, "2026-09-09");
    assert.equal(estimate.method, "bond_etf_ytm_scenario");
    assert.ok(estimate.value != null);
    assert.ok(Math.abs(estimate.value! - 0.0215) < 1e-12);
    assert.equal(estimate.bondScenario?.ratePriceEffect, -0.02);
    assert.equal(estimate.bondScenario?.spreadPriceEffect, -0.0075);
  });

  it("requires spread duration in the production path when a spread shock is used", () => {
    const holding: Holding = {
      ticker: "LQD",
      name: "LQD",
      weight: 1,
      currency: "USD",
      assetType: "etf",
      subType: "bond",
      bondEtfScenario: {
        rateChangeBp: 0,
        spreadChangeBp: 100,
        allowMissingSpreadDuration: false,
      },
    };
    const estimate = expectedReturn(holding, {
      prices: [],
      source: ["fixture"],
      fundamentals: { yieldToMaturity: 0.05, expenseRatio: 0.001, duration: 2 },
    }, "2026-09-09");
    assert.equal(estimate.value, null);
    assert.equal(estimate.method, "bond_etf_scenario_unavailable");
  });
});

describe("official bond ETF fundamentals", () => {
  it("parses ACE YTM, modified duration, fee and as-of date", () => {
    const facts = parseAceBondEtfFundamentals(
      { ytm: 4.7982, duration: 1.832575, std_DT: "20260908", totalPee: 0.095 },
      { fundDur: 2.5127, fundYtm: 4.7, total_FEE: 0.1 },
    );
    assert.equal(facts.yieldToMaturity, 0.047982);
    assert.equal(facts.duration, 1.832575);
    assert.equal(facts.expenseRatio, 0.00095);
    assert.equal(facts.factsAsOf, "2026-09-08");
  });

  it("parses entity-encoded iShares product facts without confusing yield and duration", () => {
    const html = [
      "{&quot;asOfDate&quot;:&quot;2026-09-08T00:00:00.000&quot;,&quot;formattedValue&quot;:&quot;5.72%&quot;,&quot;label&quot;:&quot;Average Yield to Maturity&quot;}",
      "{&quot;asOfDate&quot;:&quot;2026-09-08T00:00:00.000&quot;,&quot;formattedValue&quot;:&quot;7.72 yrs&quot;,&quot;label&quot;:&quot;Effective Duration&quot;}",
      "{&quot;asOfDate&quot;:&quot;2026-09-04T00:00:00.000&quot;,&quot;formattedValue&quot;:&quot;5.60%&quot;,&quot;label&quot;:&quot;30 Day SEC Yield&quot;}",
      "{&quot;formattedValue&quot;:&quot;4.76%&quot;,&quot;label&quot;:&quot;12m Trailing Yield&quot;}",
      "{&quot;name&quot;:&quot;Expense Ratio:&quot;,&quot;value&quot;:&quot;0.14&quot;}",
    ].join("");
    const facts = parseLqdBondEtfFundamentals(html);
    assert.equal(facts.yieldToMaturity, 0.0572);
    assert.equal(facts.duration, 7.72);
    assert.ok(Math.abs((facts.secYield ?? 0) - 0.056) < 1e-12);
    assert.ok(Math.abs((facts.distributionYield ?? 0) - 0.0476) < 1e-12);
    assert.ok(Math.abs((facts.expenseRatio ?? 0) - 0.0014) < 1e-12);
    assert.equal(facts.factsAsOf, "2026-09-08");
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

  it("attaches persisted shocks and a matching PB override to the analytics holding", () => {
    const holdings = selectionToHoldings(
      { globalBond: 100, cash: 0 },
      [{
        symbol: "LQD",
        name: "LQD",
        currency: "USD",
        kind: "채권 ETF",
        assetClass: "globalBond",
        weightWithinClass: 100,
      }],
      {
        rateChangeBp: 25,
        spreadChangeBp: 40,
        allowMissingSpreadDuration: false,
        overridesBySymbol: {
          lqd: {
            ytmPct: 5.5,
            effectiveDurationYears: 7.5,
            spreadDurationYears: 7.2,
            expenseRatioPct: 0.14,
            asOf: "2026-09-08",
            sourceLabel: "PB checked filing",
          },
        },
      },
    );
    assert.equal(holdings[0].bondEtfScenario?.rateChangeBp, 25);
    assert.equal(holdings[0].bondEtfScenario?.override?.ytmPct, 5.5);
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
