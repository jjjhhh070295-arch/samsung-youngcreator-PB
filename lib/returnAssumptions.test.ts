import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decimalReturnToPctPoints,
  pctPointsToDecimalReturn,
  getAssumptionForSymbol,
  buildReturnAssumptionsMap,
  type PortfolioAnalyticsSnapshot,
} from "./returnAssumptions";

describe("returnAssumptions unit adapters", () => {
  it("decimal 0.08 and percent-point 8 are identical through adapters", () => {
    assert.equal(decimalReturnToPctPoints(0.08), 8);
    assert.equal(pctPointsToDecimalReturn(8), 0.08);
    assert.equal(decimalReturnToPctPoints(pctPointsToDecimalReturn(8)), 8);
    assert.equal(pctPointsToDecimalReturn(decimalReturnToPctPoints(0.08)), 0.08);
  });

  it("preserves genuine zero and negative returns", () => {
    assert.equal(decimalReturnToPctPoints(0), 0);
    assert.equal(decimalReturnToPctPoints(-0.05), -5);
    assert.equal(pctPointsToDecimalReturn(0), 0);
    assert.equal(pctPointsToDecimalReturn(-5), -0.05);
  });

  it("null/non-finite stay null (missing ≠ zero)", () => {
    assert.equal(decimalReturnToPctPoints(null), null);
    assert.equal(decimalReturnToPctPoints(Number.NaN), null);
    assert.equal(pctPointsToDecimalReturn(undefined), null);
  });

  it("resolves instrument assumptions across symbol identity keys", () => {
    const snap: PortfolioAnalyticsSnapshot = {
      compositionKey: "k",
      asOf: "2026-01-01",
      expectedReturnDecimal: 0.08,
      expectedRiskDecimal: null,
      returnStatus: "ok",
      riskStatus: "unavailable",
      portfolioReturnBasis: "total_return",
      instrumentAssumptionsPct: {
        "005930.KS": { totalReturnPct: 8, returnBasis: "total_return" },
      },
    };
    const map = buildReturnAssumptionsMap(snap)!;
    assert.ok(getAssumptionForSymbol(map, "005930"));
    assert.equal(getAssumptionForSymbol(map, "005930")!.totalReturnPct, 8);
  });
});
