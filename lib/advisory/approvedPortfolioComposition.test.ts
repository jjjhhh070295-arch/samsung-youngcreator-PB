import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildApprovedPortfolio,
  buildInstrumentsFromDraft,
  draftMatchesApprovedInstruments,
  isLegacyIncompletePortfolio,
  portfolioHasDisplayableMetrics,
  recoverInstrumentsFromMatchingDraft,
  stampApprovedInstrumentsWithQuotes,
} from "./approvedPortfolioComposition";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";
import type { Portfolio } from "../types";
import {
  CONTRIBUTION_RETURN_TOLERANCE_PP,
  contributionsAgreeWithReturn,
  formatPercent1,
  formatPercentPoint1,
} from "../formatPercent";
import { buildReturnContributionResult } from "../portfolioReturnContribution";

function sampleDraft(overrides?: Partial<ManualPortfolioDraft>): ManualPortfolioDraft {
  return {
    version: 2,
    allocation: {
      domesticEquity: 40,
      globalEquity: 20,
      domesticBond: 20,
      globalBond: 10,
      alternatives: 0,
      cash: 10,
    },
    finalAllocation: {
      domesticEquity: 40,
      globalEquity: 20,
      domesticBond: 20,
      globalBond: 10,
      alternatives: 0,
      cash: 10,
    },
    selected: [
      {
        symbol: "005930",
        name: "삼성전자",
        assetClass: "domesticEquity",
        weightWithinClass: 100,
        currency: "KRW",
        quotationKind: "share",
      },
      {
        symbol: "AAPL",
        name: "Apple",
        assetClass: "globalEquity",
        weightWithinClass: 100,
        currency: "USD",
        quotationKind: "share",
      },
      {
        symbol: "KOSEF국고채",
        name: "KOSEF국고채",
        assetClass: "domesticBond",
        weightWithinClass: 100,
        currency: "KRW",
        quotationKind: "share",
      },
      {
        symbol: "BND",
        name: "Vanguard Total Bond",
        assetClass: "globalBond",
        weightWithinClass: 100,
        currency: "USD",
        quotationKind: "share",
      },
    ],
    investableWon: 100_000_000,
    allocatableWon: 100_000_000,
    savedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("approvedPortfolioComposition", () => {
  it("persists instruments with weights and amounts on approval", () => {
    const draft = sampleDraft();
    const pf = buildApprovedPortfolio({
      draft,
      expectedReturn: 9.170077,
      expectedRisk: 12.3,
      metricsStatus: "ok",
    });
    assert.ok(pf.instruments && pf.instruments.length >= 4);
    assert.ok(pf.compositionRevision?.startsWith("rev-"));
    const samsung = pf.instruments!.find((i) => i.symbol === "005930");
    assert.ok(samsung);
    assert.equal(samsung!.weightWithinClass, 100);
    assert.ok(Math.abs(samsung!.totalWeightPct - 40) < 0.01);
    assert.ok(samsung!.allocationAmountWon != null && samsung!.allocationAmountWon > 0);
    assert.equal(pf.expectedReturn, 9.170077);
    assert.equal(pf.metricsStatus, "ok");
  });

  it("marks metrics unavailable without fabricating zero", () => {
    const pf = buildApprovedPortfolio({
      draft: sampleDraft(),
      expectedReturn: null,
      expectedRisk: null,
      metricsStatus: "unavailable",
    });
    assert.equal(pf.expectedReturn, null);
    assert.equal(pf.expectedRisk, null);
    assert.equal(portfolioHasDisplayableMetrics(pf), false);
  });

  it("keeps expectedReturn when risk is missing", () => {
    const pf = buildApprovedPortfolio({
      draft: sampleDraft(),
      expectedReturn: 8.25,
      expectedRisk: null,
      metricsStatus: "ok",
    });
    assert.equal(pf.expectedReturn, 8.25);
    assert.equal(pf.expectedRisk, null);
    assert.equal(pf.metricsStatus, "ok");
    assert.equal(portfolioHasDisplayableMetrics(pf), true);
  });

  it("detects legacy incomplete portfolios", () => {
    const legacy: Portfolio = {
      id: "legacy",
      label: "맞춤",
      allocations: [{ assetClass: "국내주식", weight: 100 }],
      expectedReturn: 0,
      expectedRisk: 0,
      taxNote: "",
      rationale: "",
      editedByPb: true,
    };
    assert.equal(isLegacyIncompletePortfolio(legacy), true);
  });

  it("recovers instruments only when draft symbols align after recovery helper", () => {
    const draft = sampleDraft();
    const shell: Portfolio = {
      id: "legacy",
      label: "맞춤",
      allocations: [{ assetClass: "국내주식", weight: 40 }],
      expectedReturn: null,
      expectedRisk: null,
      metricsStatus: "legacy_incomplete",
      taxNote: "",
      rationale: "",
      editedByPb: true,
    };
    const recovered = recoverInstrumentsFromMatchingDraft(shell, draft);
    assert.ok((recovered.instruments?.length ?? 0) >= 4);
    assert.equal(draftMatchesApprovedInstruments(draft, recovered), true);
  });

  it("stamps KIS prices onto approved instruments without changing revision", () => {
    const draft = sampleDraft();
    const pf = buildApprovedPortfolio({
      draft,
      expectedReturn: 8,
      expectedRisk: 10,
      metricsStatus: "ok",
    });
    const rev = pf.compositionRevision;
    const stamped = stampApprovedInstrumentsWithQuotes(pf, {
      priceBySymbol: new Map([
        ["005930", 70000],
        ["AAPL", 180],
        ["KOSEF국고채", 10000],
        ["BND", 70],
      ]),
      fxUsdKrw: 1350,
    });
    assert.equal(stamped.compositionRevision, rev);
    const samsung = stamped.instruments!.find((i) => i.symbol === "005930");
    assert.equal(samsung!.priceSnapshot, 70000);
    assert.ok(samsung!.quantity != null && samsung!.quantity > 0);
  });

  it("buildInstrumentsFromDraft uses price map for quantity", () => {
    const rows = buildInstrumentsFromDraft(sampleDraft(), {
      priceBySymbol: new Map([["005930", 70000]]),
      fxUsdKrw: 1350,
    });
    const samsung = rows.find((r) => r.symbol === "005930");
    assert.ok(samsung?.quantity != null && samsung.quantity > 0);
  });
});

describe("formatPercent / contribution consistency", () => {
  it("formats to one decimal and shows em dash for null", () => {
    assert.equal(formatPercent1(9.170077), "9.2%");
    assert.equal(formatPercent1(90.829923), "90.8%");
    assert.equal(formatPercent1(null), "—");
    assert.equal(formatPercent1(undefined), "—");
    assert.equal(formatPercent1(0), "0.0%");
    assert.equal(formatPercentPoint1(1.23), "1.2%p");
  });

  it("does not fabricate contributions when return is missing", () => {
    const result = buildReturnContributionResult(
      [
        { assetClass: "국내주식", weight: 60 },
        { assetClass: "국내채권", weight: 40 },
      ],
      null,
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.rows.length, 0);
  });

  it("treats genuine zero return as ok with zero contributions when scaled", () => {
    const result = buildReturnContributionResult(
      [
        { assetClass: "국내주식", weight: 50 },
        { assetClass: "현금성", weight: 50 },
      ],
      0,
    );
    assert.equal(result.status, "ok");
    assert.ok(result.rows.every((r) => r.contributionPct === 0));
    assert.equal(contributionsAgreeWithReturn(result.sumContributionPct ?? 0, 0), true);
  });

  it("keeps contribution sum within tolerance of expected return", () => {
    const expected = 8.5;
    const result = buildReturnContributionResult(
      [
        { assetClass: "국내주식", weight: 40 },
        { assetClass: "해외주식", weight: 30 },
        { assetClass: "국내채권", weight: 30 },
      ],
      expected,
    );
    assert.equal(result.status, "ok");
    assert.ok(result.sumContributionPct != null);
    assert.ok(
      Math.abs(result.sumContributionPct! - expected) <= CONTRIBUTION_RETURN_TOLERANCE_PP + 0.05,
    );
    assert.equal(result.agreesWithExpected, contributionsAgreeWithReturn(result.sumContributionPct!, expected));
  });

  it("hides contributions when fallback proxy is disallowed and no market data", () => {
    const result = buildReturnContributionResult(
      [{ assetClass: "국내주식", weight: 100 }],
      8,
      undefined,
      { allowFallbackProxy: false },
    );
    assert.equal(result.status, "unavailable");
    assert.equal(result.rows.length, 0);
  });
});
