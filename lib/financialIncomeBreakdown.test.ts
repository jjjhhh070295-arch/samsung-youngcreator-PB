import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinancialIncomeBreakdown,
  baselineExistingInterestWon,
  depositInterestSnapshotFromProducts,
  partitionDepositInterestForTaxContext,
  annualFinancialIncomeFromBreakdown,
} from "./financialIncomeBreakdown";
import type { FinancialIncomeProfile } from "./types";
import type { DepositProduct } from "./tax/depositInterest";
import { annualFinancialIncomeFromProfile } from "./financialIncome";

function profile(p: Partial<FinancialIncomeProfile> = {}): FinancialIncomeProfile {
  return {
    interestIncomeWon: null,
    dividendIncomeWon: null,
    parseStatus: "none",
    ...p,
  };
}

function deposit(overrides: Partial<DepositProduct> = {}): DepositProduct {
  return {
    id: overrides.id ?? "d1",
    institution: "",
    productName: "",
    productType: "deposit",
    currency: "KRW",
    principalWon: 100_000_000,
    annualRatePct: 3,
    openedAt: "2026-01-01",
    termYears: 1,
    maturesAt: "2027-01-01",
    interestSchedule: "만기일시",
    convention: "simple",
    taxStatus: "taxable",
    contributionAmountWon: null,
    contributionFrequency: null,
    contributionDates: null,
    includeInManagedPreview: true,
    identifiedInCashBalance: false,
    source: "manual",
    asOf: "2026-01-01",
    ...overrides,
  };
}

describe("financialIncomeBreakdown", () => {
  it("sums external 100만 + deposit 10만 + bond 20만 = 130만 exactly once", () => {
    const b = buildFinancialIncomeBreakdown(
      profile({
        interestIncomeWon: 1_000_000,
        derivedBondInterestWon: 200_000,
      }),
      {
        depositSnapshot: {
          totalGrossWon: 100_000,
          incomplete: false,
          allIncomplete: false,
        },
      },
    );
    assert.equal(b.totalInterestWon, 1_300_000);
    assert.equal(annualFinancialIncomeFromBreakdown(b), 1_300_000);
  });

  it("blank external field does not hide derived deposit total", () => {
    const b = buildFinancialIncomeBreakdown(profile(), {
      depositSnapshot: { totalGrossWon: 77_397, incomplete: false, allIncomplete: false },
    });
    assert.equal(b.externalInterestWon, null);
    assert.equal(b.derivedDepositInterestWon, 77_397);
    assert.equal(b.totalInterestWon, 77_397);
  });

  it("all-incomplete deposits yield pending not fake zero", () => {
    const b = buildFinancialIncomeBreakdown(profile(), {
      depositSnapshot: { totalGrossWon: null, incomplete: true, allIncomplete: true },
    });
    assert.equal(b.interestPending, true);
    assert.equal(b.totalInterestWon, null);
    assert.ok(b.incompleteReasons.length > 0);
  });

  it("genuine zero deposit total displays as zero", () => {
    const b = buildFinancialIncomeBreakdown(profile({ interestIncomeWon: 0 }), {
      depositSnapshot: { totalGrossWon: 0, incomplete: false, allIncomplete: false },
    });
    assert.equal(b.totalInterestWon, 0);
    assert.equal(b.interestPending, false);
  });

  it("legacy profile without derived fields stays usable", () => {
    const p = profile({ interestIncomeWon: 500_000, dividendIncomeWon: 100_000 });
    assert.equal(annualFinancialIncomeFromProfile(p), 600_000);
    const b = buildFinancialIncomeBreakdown(p);
    assert.equal(b.totalFinancialIncomeWon, 600_000);
  });

  it("valid deposit snapshot from products is non-null positive interest", () => {
    const snap = depositInterestSnapshotFromProducts([deposit()], {
      asOf: "2026-06-01",
      projectionYear: 2026,
    });
    assert.equal(snap.allIncomplete, false);
    assert.ok(snap.totalGrossWon != null && snap.totalGrossWon > 0);
  });

  it("incomplete default product is allIncomplete", () => {
    const snap = depositInterestSnapshotFromProducts(
      [deposit({ principalWon: null, annualRatePct: null })],
      { asOf: "2026-06-01", projectionYear: 2026 },
    );
    assert.equal(snap.allIncomplete, true);
    assert.equal(snap.totalGrossWon, null);
  });

  it("does not double-count preview deposits in baseline existing interest", () => {
    const products = [
      deposit({ id: "preview", includeInManagedPreview: true, principalWon: 50_000_000, annualRatePct: 4 }),
      deposit({
        id: "owned",
        includeInManagedPreview: false,
        principalWon: 10_000_000,
        annualRatePct: 2,
      }),
    ];
    const part = partitionDepositInterestForTaxContext(products, {
      asOf: "2026-06-01",
      projectionYear: 2026,
    });
    assert.deepEqual(part.previewProductIds, ["preview"]);
    const baseline = baselineExistingInterestWon(
      profile({ interestIncomeWon: 1_000_000 }),
      products,
      { asOf: "2026-06-01", projectionYear: 2026 },
    );
    // external 1m + non-preview only — not full deposit cache
    assert.ok(baseline != null && baseline >= 1_000_000);
    assert.ok(baseline! < 1_000_000 + 50_000_000); // not adding huge principal
    const previewOnlyBaseline = baselineExistingInterestWon(
      profile({ interestIncomeWon: 0 }),
      [products[0]],
      { asOf: "2026-06-01", projectionYear: 2026 },
    );
    // only preview product → non-preview interest 0 + external 0
    assert.equal(previewOnlyBaseline, 0);
  });

  it("profile cache is ignored for baseline when products list is provided", () => {
    const products = [
      deposit({ id: "p1", includeInManagedPreview: true, principalWon: 10_000_000, annualRatePct: 3 }),
    ];
    const baseline = baselineExistingInterestWon(
      profile({
        interestIncomeWon: 0,
        derivedDepositInterestWon: 9_999_999, // stale all-products cache — must not be added
      }),
      products,
      { asOf: "2026-06-01", projectionYear: 2026 },
    );
    assert.equal(baseline, 0);
  });
});
