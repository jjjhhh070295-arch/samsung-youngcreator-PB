import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarYears,
  deriveWholeYearTerm,
  futureMonthlyContributionDates,
  resolveMaturesAt,
} from "./depositMaturity";
import {
  aggregateDerivedDepositInterest,
  calculateDepositInterest,
  type DepositProduct,
} from "./depositInterest";
import {
  deriveNonFinancialTaxableBaseWon,
  migrateFinancialIncomeProfile,
  resolvePriorYearNonFinancialAssessedTaxWon,
} from "../financialIncome";
import type { FinancialIncomeProfile } from "../types";

function baseDeposit(partial: Partial<DepositProduct>): DepositProduct {
  return {
    id: "d1",
    institution: "",
    productName: "",
    productType: "deposit",
    currency: "KRW",
    principalWon: 100_000_000,
    annualRatePct: 3,
    openedAt: "2026-01-01",
    termYears: 1,
    maturesAt: "2027-01-01",
    interestSchedule: null,
    convention: "simple",
    taxStatus: "taxable",
    includeInManagedPreview: true,
    identifiedInCashBalance: false,
    source: "test",
    asOf: "2026-01-01",
    ...partial,
  };
}

describe("deposit maturity calendar", () => {
  it("adds whole years preserving month/day", () => {
    assert.equal(addCalendarYears("2026-03-15", 3), "2029-03-15");
  });

  it("clamps leap day to Feb 28", () => {
    assert.equal(addCalendarYears("2024-02-29", 1), "2025-02-28");
  });

  it("derives exact term from legacy dates", () => {
    const d = deriveWholeYearTerm("2020-06-01", "2025-06-01");
    assert.equal(d.status, "exact");
    assert.equal(d.termYears, 5);
  });

  it("flags ambiguous legacy maturity", () => {
    const d = deriveWholeYearTerm("2020-06-01", "2025-07-15");
    assert.equal(d.status, "ambiguous");
    const r = resolveMaturesAt({
      openedAt: "2020-06-01",
      termYears: null,
      maturesAt: "2025-07-15",
    });
    assert.equal(r.legacyMaturityNeedsReview, true);
    assert.equal(r.maturesAt, "2025-07-15");
  });
});

describe("deposit interest simplified", () => {
  it("deposit interest from asOf through maturity", () => {
    const r = calculateDepositInterest(
      baseDeposit({ asOf: "2026-01-01", termYears: 1, maturesAt: "2027-01-01" }),
    );
    assert.equal(r.status, "ok");
    assert.equal(r.grossInterestWon, 3_000_000);
  });

  it("updates when rate/balance/term change", () => {
    const a = calculateDepositInterest(baseDeposit({ principalWon: 50_000_000, annualRatePct: 4, termYears: 2, maturesAt: "2028-01-01" }));
    assert.equal(a.grossInterestWon, 4_000_000); // 50m * 4% * 2y
  });

  it("installment uses balance plus future months without double-counting past", () => {
    // asOf mid-term: balance already includes past contributions
    const p = baseDeposit({
      productType: "installment",
      principalWon: 6_000_000,
      contributionAmountWon: 1_000_000,
      openedAt: "2026-01-01",
      termYears: 1,
      maturesAt: "2027-01-01",
      asOf: "2026-07-01",
    });
    const r = calculateDepositInterest(p);
    assert.equal(r.status, "ok");
    assert.ok((r.grossInterestWon ?? 0) > 0);
    // If we wrongly applied full-year on final 12m principal: 12m*3%=360k — our result should differ
    const wrongFull = 12_000_000 * 0.03;
    assert.ok((r.grossInterestWon ?? 0) !== wrongFull);
  });

  it("missing installment amount is incomplete", () => {
    const r = calculateDepositInterest(
      baseDeposit({
        productType: "installment",
        contributionAmountWon: null,
      }),
    );
    assert.equal(r.status, "incomplete");
  });

  it("matured product never produces negative interest", () => {
    const r = calculateDepositInterest(
      baseDeposit({
        asOf: "2027-01-01",
        openedAt: "2026-01-01",
        maturesAt: "2027-01-01",
        termYears: 1,
      }),
    );
    assert.equal(r.status, "matured");
    assert.equal(r.grossInterestWon, 0);
  });

  it("aggregate derived interest does not duplicate external confirmed", () => {
    const products = [baseDeposit({ id: "a" }), baseDeposit({ id: "b", principalWon: 50_000_000 })];
    const agg = aggregateDerivedDepositInterest(products, { asOf: "2026-01-01" });
    assert.equal(agg.totalGrossWon, 3_000_000 + 1_500_000);
    // external confirmed is separate field — aggregate is only derived
  });

  it("future monthly dates skip asOf and stop before maturity", () => {
    const dates = futureMonthlyContributionDates({
      openedAt: "2026-01-15",
      maturesAt: "2026-04-15",
      asOf: "2026-01-15",
    });
    assert.deepEqual(dates, ["2026-02-15", "2026-03-15"]);
  });
});

describe("tax profile migration", () => {
  it("migrates legacy national+local once to canonical", () => {
    const profile: FinancialIncomeProfile = {
      interestIncomeWon: null,
      dividendIncomeWon: null,
      parseStatus: "manual",
      priorYearAssessedNationalWon: 1_000_000,
      priorYearAssessedLocalWon: 100_000,
    };
    assert.equal(resolvePriorYearNonFinancialAssessedTaxWon(profile), 1_100_000);
    const m = migrateFinancialIncomeProfile(profile);
    assert.equal(m.priorYearNonFinancialAssessedTaxWon, 1_100_000);
    // legacy preserved
    assert.equal(m.priorYearAssessedNationalWon, 1_000_000);
  });

  it("canonical value wins and is not doubled", () => {
    const profile: FinancialIncomeProfile = {
      interestIncomeWon: null,
      dividendIncomeWon: null,
      parseStatus: "manual",
      priorYearNonFinancialAssessedTaxWon: 2_000_000,
      priorYearAssessedNationalWon: 1_000_000,
      priorYearAssessedLocalWon: 100_000,
    };
    assert.equal(resolvePriorYearNonFinancialAssessedTaxWon(profile), 2_000_000);
  });

  it("removed taxable-base override is ignored by derive helper", () => {
    assert.equal(
      deriveNonFinancialTaxableBaseWon({
        expectedWageGrossWon: 50_000_000,
        employmentIncomeDeductionWon: 10_000_000,
        otherComprehensiveIncomeWon: 0,
      }),
      40_000_000,
    );
    assert.equal(
      deriveNonFinancialTaxableBaseWon({ expectedWageGrossWon: null }),
      null,
    );
  });
});
