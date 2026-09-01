import assert from "node:assert/strict";
import test from "node:test";
import { isMacroDashboardResult } from "./publicValidation";

const availability = {
  releaseDate: "source_not_provided",
  vintageDate: "source_not_provided",
  preliminaryFinal: "source_not_provided",
  revisionStatus: "source_not_provided",
} as const;

function payload() {
  return {
    ok: true,
    mode: "official-live-with-blocked-rights-placeholders",
    retrievedAt: "2026-08-31T00:00:00.000Z",
    consumerPolicy: {
      pbInternalResearchDisplay: true,
      portfolio: false,
      productRecommendation: false,
      customerOutput: false,
      aiNumericGeneration: false,
    },
    captures: [{
      captureId: "capture-1",
      providerId: "us-treasury",
      contentHash: "abc",
      bodyByteLength: 12,
      retrievedAt: "2026-08-31T00:00:00.000Z",
      responseStatus: 200,
      contentType: "application/xml",
      sanitizedRequest: { providerId: "us-treasury", operation: "daily_treasury_yield_curve", seriesIds: ["ust-cmt-10y"] },
    }],
    sections: {
      "korea-macro": [],
      "us-rates": [{
        status: "ready",
        mode: "official-live",
        seriesId: "ust-cmt-10y",
        sectionId: "us-rates",
        providerId: "us-treasury",
        provider: "U.S. Department of the Treasury",
        title: "U.S. Treasury Constant Maturity 10-Year",
        frequency: "D",
        unit: "Percent",
        definitionVersion: "treasury-daily-par-yield-10y-v1",
        observations: [{
          observationDate: "2026-08-28",
          observationDateRaw: "2026-08-28",
          valueRaw: "3.63",
          releaseDate: null,
          vintageDate: null,
          preliminaryFinal: null,
          revisionStatus: null,
          availability,
        }],
        latestObservation: {
          observationDate: "2026-08-28",
          observationDateRaw: "2026-08-28",
          valueRaw: "3.63",
          releaseDate: null,
          vintageDate: null,
          preliminaryFinal: null,
          revisionStatus: null,
          availability,
        },
        sourceUrl: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=2026",
        retrievedAt: "2026-08-31T00:00:00.000Z",
        contentHash: "abc",
        rightsStatus: "pb-internal-use-approved",
        isEducationalFixture: false,
      }],
      "credit-volatility": [{
        status: "blocked",
        seriesId: "vix",
        sectionId: "credit-volatility",
        title: "VIX",
        code: "DATA_RIGHTS_REVIEW_REQUIRED",
        message: "이용권 확인 필요",
        sourceUrl: "https://www.cboe.com/",
        rightsStatus: "licensed-data-required",
      }],
    },
  };
}

test("a source-backed dashboard response passes the public boundary", () => {
  assert.equal(isMacroDashboardResult(payload()), true);
});

test("raw bytes, invented consumer permissions and zero-filled blocked data fail closed", () => {
  const withRaw = payload();
  (withRaw.captures[0] as Record<string, unknown>).rawBase64 = "secret";
  assert.equal(isMacroDashboardResult(withRaw), false);

  const portfolio = payload();
  portfolio.consumerPolicy.portfolio = true;
  assert.equal(isMacroDashboardResult(portfolio), false);

  const zeroFilled = payload();
  (zeroFilled.sections["credit-volatility"][0] as Record<string, unknown>).observations = [];
  assert.equal(isMacroDashboardResult(zeroFilled), false);
});

test("an unknown series, a registry metadata change and non-chronological observations fail closed", () => {
  const unknown = payload();
  unknown.sections["us-rates"][0].seriesId = "invented-series";
  assert.equal(isMacroDashboardResult(unknown), false);

  const wrongUnit = payload();
  wrongUnit.sections["us-rates"][0].unit = "bp";
  assert.equal(isMacroDashboardResult(wrongUnit), false);

  const duplicateDate = payload();
  duplicateDate.sections["us-rates"][0].observations.push({
    ...duplicateDate.sections["us-rates"][0].latestObservation,
  });
  assert.equal(isMacroDashboardResult(duplicateDate), false);
});
