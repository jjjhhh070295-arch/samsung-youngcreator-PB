import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  article62ComparisonTax,
  crossesFinancialIncomeThreshold,
  FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON,
  foreignStockCapitalGainsTax,
  interestWithholdingParts,
  ordinaryDomesticListedShareCgtWon,
  progressiveNationalTax,
} from "./koreanResidentTax2026";
import {
  calculateDepositInterest,
  termDepositSimpleInterest,
  type DepositProduct,
} from "./depositInterest";
import {
  buildPreviewFromApprovedPortfolio,
  projectPortfolioPreviewTax,
  type CustomerTaxContext,
} from "./portfolioPreviewTax";
import { emptyIPS } from "../types";
import type { Client, Portfolio } from "../types";

describe("deposit interest", () => {
  it("100m at 3% for 1 year → 3m interest and 462k withholding", () => {
    const r = termDepositSimpleInterest({
      principalWon: 100_000_000,
      annualRatePct: 3,
      openedAt: "2026-01-01",
      maturesAt: "2027-01-01",
    });
    assert.equal(r.grossInterestWon, 3_000_000);
    const wh = interestWithholdingParts(r.grossInterestWon);
    assert.equal(wh.totalWon, 462_000);
  });

  it("installment savings uses balance plus future months", () => {
    const p: DepositProduct = {
      id: "inst",
      institution: "",
      productName: "",
      productType: "installment",
      currency: "KRW",
      principalWon: 6_000_000,
      annualRatePct: 3,
      openedAt: "2026-01-01",
      termYears: 1,
      maturesAt: "2027-01-01",
      interestSchedule: null,
      convention: "simple",
      taxStatus: "taxable",
      contributionAmountWon: 1_000_000,
      includeInManagedPreview: true,
      identifiedInCashBalance: false,
      source: "test",
      asOf: "2026-07-01",
    };
    const r = calculateDepositInterest(p);
    assert.equal(r.status, "ok");
    assert.ok((r.grossInterestWon ?? 0) > 0);
    assert.ok((r.grossInterestWon ?? 0) < 12_000_000 * 0.03);
  });

  it("exempt product has zero withholding", () => {
    const p: DepositProduct = {
      id: "d1",
      institution: "은행",
      productName: "비과세",
      productType: "deposit",
      currency: "KRW",
      principalWon: 10_000_000,
      annualRatePct: 3,
      openedAt: "2026-01-01",
      maturesAt: "2027-01-01",
      interestSchedule: null,
      convention: "simple",
      taxStatus: "exempt",
      includeInManagedPreview: true,
      identifiedInCashBalance: false,
      source: "test",
      asOf: "2026-06-01",
    };
    const r = calculateDepositInterest(p);
    assert.equal(r.status, "exempt");
    assert.equal(r.withholdingTotalWon, 0);
  });
});

describe("korean tax rules", () => {
  it("threshold: 19_999_999 / 20_000_000 / 20_000_001", () => {
    assert.equal(crossesFinancialIncomeThreshold(19_999_999), false);
    assert.equal(crossesFinancialIncomeThreshold(20_000_000), false);
    assert.equal(crossesFinancialIncomeThreshold(20_000_001), true);
    assert.equal(FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON, 20_000_000);
  });

  it("ordinary domestic listed share CGT is zero", () => {
    assert.equal(ordinaryDomesticListedShareCgtWon(1_000_000), 0);
  });

  it("foreign stock CGT: (10m - 2.5m) x 22% = 1.65m", () => {
    const r = foreignStockCapitalGainsTax({ netTaxableGainsWon: 10_000_000 });
    assert.equal(r.deductionAppliedWon, 2_500_000);
    assert.equal(r.taxableAfterDeductionWon, 7_500_000);
    assert.equal(r.totalWon, 1_650_000);
  });

  it("foreign gains at or below allowance give zero tax", () => {
    assert.equal(foreignStockCapitalGainsTax({ netTaxableGainsWon: 2_500_000 }).totalWon, 0);
    assert.equal(foreignStockCapitalGainsTax({ netTaxableGainsWon: 0 }).totalWon, 0);
  });

  it("article 62 does not use guessed marginal-rate shortcut", () => {
    const r = article62ComparisonTax({
      otherTaxableBaseWon: 50_000_000,
      eligibleFinancialIncomeWon: 25_000_000,
    });
    assert.equal(r.exceedsThreshold, true);
    const otherOnly = progressiveNationalTax(50_000_000);
    const withFin = progressiveNationalTax(75_000_000);
    assert.ok(r.detail.taxOtherOnlyNational === otherOnly);
    assert.ok(r.detail.taxWithFinancialNational === withFin);
    assert.ok(r.totalExtraWon >= 0);
  });
});

describe("portfolio preview tax", () => {
  function client(): Client {
    return {
      id: "c1",
      code: "C1",
      name: "테스트",
      clientType: "individual",
      birthDate: "1980-01-01",
      assetSize: 350_000_000_000,
      assignedPbId: "pb1",
      consultationNotes: "",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: { portfolio: true, stress: true },
      financialIncomeComprehensiveTax: false,
      financialIncomeProfile: {
        interestIncomeWon: 18_000_000,
        dividendIncomeWon: 0,
        parseStatus: "manual",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  function portfolio(instruments: Portfolio["instruments"]): Portfolio {
    return {
      id: "manual-1",
      label: "맞춤",
      allocations: [{ assetClass: "국내주식", weight: 100 }],
      instruments,
      metricsStatus: "ok",
      expectedReturn: 8,
      expectedRisk: 12,
      taxNote: "",
      rationale: "",
      editedByPb: true,
    };
  }

  it("8% total return with 2% dividend is 8% gross not 10%", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1000,
        priceSnapshot: 100000,
        bookkeepingNote: "장부",
      },
    ]);
    const assumptions = new Map([
      [
        "005930",
        {
          totalReturnPct: 8,
          dividendYieldPct: 2,
          returnBasis: "total_return" as const,
        },
      ],
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: assumptions,
    })!;
    const line = preview.instruments[0];
    assert.equal(line.priceReturnWon + line.dividendWon, 8_000_000);
    assert.equal(line.grossReturnWon, 8_000_000);
  });

  it("price-only 8% plus 2% dividend is 10% gross", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1000,
        priceSnapshot: 100000,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([
        ["005930", { priceReturnPct: 8, dividendYieldPct: 2, returnBasis: "price_only" }],
      ]),
    })!;
    assert.equal(preview.instruments[0].grossReturnWon, 10_000_000);
  });

  it("portfolio-level 8% on 100m yields 8m pre-tax without instrument map", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1000,
        priceSnapshot: 100000,
        bookkeepingNote: "장부",
      },
    ]);
    pf.expectedReturn = 8;
    pf.metricsStatus = "ok";
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
    })!;
    assert.equal(preview.instruments[0].grossReturnWon, 8_000_000);
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: {
        taxYear: 2026,
        declaredComprehensiveHistorically: true,
        existingInterestWon: 0,
        existingDividendWon: 0,
        expectedWageGrossWon: 50_000_000,
        otherComprehensiveIncomeWon: 0,
        confirmedNonFinancialTaxableBaseWon: null,
        employmentIncomeDeductionWon: null,
        otherDeductionsWon: null,
        taxCreditsWon: null,
        withheldOrPrepaidWon: null,
        priorYearWageGrossWon: null,
        priorYearAssessedNationalWon: null,
        priorYearAssessedLocalWon: null,
        isLargeShareholderConfirmed: false,
        majorShareholderStatus: "no",
        cgtDeductionUsedWon: 0,
        outsideTaxableCgtGainsWon: 0,
      },
    });
    assert.equal(result.preTaxExpectedProfitWon, 8_000_000);
    assert.equal(result.status, "ok");
  });

  it("decimal adapter 0.08 and pct 8 agree for portfolio expectedReturn path", () => {
    const { decimalReturnToPctPoints } = require("../returnAssumptions") as typeof import("../returnAssumptions");
    assert.equal(decimalReturnToPctPoints(0.08), 8);
  });

  it("domestic-only portfolio has zero foreign CGT and zero domestic listed CGT", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1000,
        priceSnapshot: 100000,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([["005930", { priceReturnPct: 1, dividendYieldPct: 0 }]]),
    })!;
    const ctx: CustomerTaxContext = {
      taxYear: 2026,
      declaredComprehensiveHistorically: false,
      existingInterestWon: 0,
      existingDividendWon: 0,
      expectedWageGrossWon: 50_000_000,
      otherComprehensiveIncomeWon: 0,
      confirmedNonFinancialTaxableBaseWon: null,
      employmentIncomeDeductionWon: null,
      otherDeductionsWon: null,
      taxCreditsWon: null,
      withheldOrPrepaidWon: null,
      priorYearWageGrossWon: null,
      priorYearAssessedNationalWon: null,
      priorYearAssessedLocalWon: null,
      isLargeShareholderConfirmed: false,
      majorShareholderStatus: "no",
      cgtDeductionUsedWon: 0,
      outsideTaxableCgtGainsWon: 0,
    };
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: ctx,
      assumeForeignShareSaleAfterHorizon: true,
    });
    assert.equal(result.taxes.domesticListedShareCgtWon, 0);
    assert.equal(result.taxes.foreignStockCgtWon, 0);
  });

  it("18m existing + 3m proposed dividends triggers income form when declared no", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([["005930", { priceReturnPct: 0, dividendYieldPct: 3 }]]),
    })!;
    const ctx = {
      ...({
        taxYear: 2026,
        declaredComprehensiveHistorically: false,
        existingInterestWon: 18_000_000,
        existingDividendWon: 0,
        expectedWageGrossWon: null,
        otherComprehensiveIncomeWon: null,
        confirmedNonFinancialTaxableBaseWon: null,
        employmentIncomeDeductionWon: null,
        otherDeductionsWon: null,
        taxCreditsWon: null,
        withheldOrPrepaidWon: null,
        priorYearWageGrossWon: null,
        priorYearAssessedNationalWon: null,
        priorYearAssessedLocalWon: null,
        isLargeShareholderConfirmed: false,
        majorShareholderStatus: "no" as const,
        cgtDeductionUsedWon: 0,
        outsideTaxableCgtGainsWon: 0,
      } satisfies CustomerTaxContext),
    };
    const result = projectPortfolioPreviewTax({ preview, taxContext: ctx });
    assert.equal(result.needsIncomeForm, true);
    assert.equal(result.status, "pending_income");
    assert.equal(result.estimatedTaxWon, null);
    assert.equal(result.afterTaxExpectedProfitWon, null);
  });

  it("uses 100억 preview principal not 350억 registered AUM", () => {
    const pf = portfolio([
      {
        symbol: "AAPL",
        name: "Apple",
        assetClassKey: "globalEquity",
        assetClassLabel: "해외주식",
        currency: "USD",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 10_000_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({ client: client(), portfolio: pf })!;
    assert.equal(preview.principalWon, 10_000_000_000);
  });

  it("ignores legacy confirmedNonFinancial override and pending when wage missing", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([["005930", { priceReturnPct: 0, dividendYieldPct: 3 }]]),
    })!;
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: {
        taxYear: 2026,
        declaredComprehensiveHistorically: true,
        existingInterestWon: 18_000_000,
        existingDividendWon: 0,
        expectedWageGrossWon: null,
        otherComprehensiveIncomeWon: null,
        confirmedNonFinancialTaxableBaseWon: 99_000_000,
        employmentIncomeDeductionWon: null,
        otherDeductionsWon: null,
        taxCreditsWon: null,
        withheldOrPrepaidWon: null,
        priorYearWageGrossWon: null,
        priorYearAssessedNationalWon: null,
        priorYearAssessedLocalWon: null,
        isLargeShareholderConfirmed: false,
        majorShareholderStatus: "no",
        cgtDeductionUsedWon: 0,
        outsideTaxableCgtGainsWon: 0,
      },
    });
    assert.equal(result.status, "pending_income");
    assert.equal(result.estimatedTaxWon, null);
  });

  it("accounting identity: after-tax ending = principal + after-tax profit", () => {
    const pf = portfolio([
      {
        symbol: "BND",
        name: "Bond",
        assetClassKey: "globalBond",
        assetClassLabel: "해외채권",
        currency: "USD",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([["BND", { couponPct: 4, priceReturnPct: 0 }]]),
    })!;
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: {
        taxYear: 2026,
        declaredComprehensiveHistorically: true,
        existingInterestWon: 0,
        existingDividendWon: 0,
        expectedWageGrossWon: 80_000_000,
        otherComprehensiveIncomeWon: 0,
        confirmedNonFinancialTaxableBaseWon: null,
        employmentIncomeDeductionWon: 30_000_000,
        otherDeductionsWon: null,
        taxCreditsWon: null,
        withheldOrPrepaidWon: null,
        priorYearWageGrossWon: null,
        priorYearAssessedNationalWon: null,
        priorYearAssessedLocalWon: null,
        isLargeShareholderConfirmed: false,
        majorShareholderStatus: "no",
        cgtDeductionUsedWon: 0,
        outsideTaxableCgtGainsWon: 0,
      },
    });
    assert.ok(result.afterTaxExpectedProfitWon != null);
    assert.equal(
      result.afterTaxEndingAssetsWon,
      result.principalWon + result.afterTaxExpectedProfitWon!,
    );
  });

  it("marks incomplete when return assumptions are missing (no fake zero profit)", () => {
    const pf = portfolio([
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    pf.expectedReturn = null;
    pf.metricsStatus = "unavailable";
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
    })!;
    assert.equal(preview.instruments[0].missingReturnAssumption, true);
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: {
        taxYear: 2026,
        declaredComprehensiveHistorically: true,
        existingInterestWon: 0,
        existingDividendWon: 0,
        expectedWageGrossWon: 50_000_000,
        otherComprehensiveIncomeWon: 0,
        confirmedNonFinancialTaxableBaseWon: null,
        employmentIncomeDeductionWon: null,
        otherDeductionsWon: null,
        taxCreditsWon: null,
        withheldOrPrepaidWon: null,
        priorYearWageGrossWon: null,
        priorYearAssessedNationalWon: null,
        priorYearAssessedLocalWon: null,
        isLargeShareholderConfirmed: false,
        majorShareholderStatus: "no",
        cgtDeductionUsedWon: 0,
        outsideTaxableCgtGainsWon: 0,
      },
    });
    assert.equal(result.status, "incomplete");
    assert.equal(result.statusMessageKo, "수익률 정보 확인 필요");
    assert.equal(result.preTaxExpectedProfitWon, null);
    assert.equal(result.estimatedTaxWon, null);
  });

  it("resolves assumptions via identity-aware symbol keys", () => {
    const pf = portfolio([
      {
        symbol: "aapl",
        name: "Apple",
        assetClassKey: "globalEquity",
        assetClassLabel: "해외주식",
        currency: "USD",
        weightWithinClass: 100,
        totalWeightPct: 100,
        allocationAmountWon: 100_000_000,
        quantity: 1,
        priceSnapshot: 1,
        bookkeepingNote: "장부",
      },
    ]);
    pf.expectedReturn = null;
    const preview = buildPreviewFromApprovedPortfolio({
      client: client(),
      portfolio: pf,
      returnAssumptions: new Map([["AAPL", { totalReturnPct: 8 }]]),
    })!;
    assert.equal(preview.instruments[0].missingReturnAssumption, false);
    assert.equal(preview.instruments[0].grossReturnWon, 8_000_000);
  });
});
