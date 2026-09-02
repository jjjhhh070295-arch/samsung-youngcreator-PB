import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateKoreaCpiYearOverYear,
  calculateKoreaCreditSpread,
  calculateKoreaRealGdpGrowth,
} from "./koreaCalculations";
import { getKoreaMacroDefinition, type KoreaMacroSeriesId } from "./koreaRegistry";
import type { MacroObservation, MacroSeriesEvidence } from "./types";

function observation(date: string, rawDate: string, valueRaw: string): MacroObservation {
  return {
    observationDate: date,
    observationDateRaw: rawDate,
    valueRaw,
    releaseDate: null,
    vintageDate: null,
    preliminaryFinal: null,
    revisionStatus: null,
    availability: {
      releaseDate: "source_not_provided",
      vintageDate: "source_not_provided",
      preliminaryFinal: "source_not_provided",
      revisionStatus: "source_not_provided",
    },
  };
}

function evidence(
  seriesId: KoreaMacroSeriesId,
  latestObservation: MacroObservation,
  overrides: Partial<MacroSeriesEvidence> = {},
): MacroSeriesEvidence {
  const definition = getKoreaMacroDefinition(seriesId);
  return {
    status: "ready",
    mode: "official-live",
    seriesId,
    sectionId: "korea-macro",
    providerId: "ecos",
    provider: "한국은행 경제통계시스템(ECOS)",
    title: definition.label,
    frequency: definition.frequency,
    unit: definition.unit,
    definitionVersion: definition.definitionId,
    observations: [latestObservation],
    latestObservation,
    sourceUrl: definition.sourceUrl,
    retrievedAt: "2026-08-31T00:00:00.000Z",
    contentHash: "a".repeat(64),
    rightsStatus: "pb-internal-use-approved",
    isEducationalFixture: false,
    ...overrides,
  };
}

test("same-date AA- spread is deterministic and keeps revision unknown", () => {
  const date = observation("2026-08-29", "20260829", "3.10");
  const result = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", date),
    evidence("ktb-3y", { ...date, valueRaw: "2.60" }),
    "2026-08-31T00:00:00.000Z",
  );
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.ok(Math.abs(result.basisPoints - 50) < 1e-10);
  assert.equal(result.revisionStatus, "source_not_provided");
});

test("spread fails closed for missing values, stale data, unit and definition mismatches", () => {
  const fresh = observation("2026-08-29", "20260829", "3.10");
  const benchmark = evidence("ktb-3y", { ...fresh, valueRaw: "2.60" });
  const missing = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", { ...fresh, valueRaw: "" }),
    benchmark,
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(missing.status === "blocked" && missing.issues.map((issue) => issue.code), ["DATA_MISSING"]);

  const stale = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", observation("2026-08-01", "20260801", "3.10")),
    evidence("ktb-3y", observation("2026-08-01", "20260801", "2.60")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(stale.status === "blocked" && stale.issues.map((issue) => issue.code), ["STALE"]);

  const unit = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", fresh, { unit: "bp" }),
    benchmark,
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(unit.status === "blocked" && unit.issues.map((issue) => issue.code), ["UNIT_MISMATCH"]);

  const definition = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", fresh, { definitionVersion: "unapproved-definition" }),
    benchmark,
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(definition.status === "blocked" && definition.issues.map((issue) => issue.code), ["DEFINITION_MISMATCH"]);

  const dateMismatch = calculateKoreaCreditSpread(
    evidence("corp-aa-minus-3y", fresh),
    evidence("ktb-3y", observation("2026-08-28", "20260828", "2.60")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(dateMismatch.status === "blocked" && dateMismatch.issues.map((issue) => issue.code), ["DATE_MISMATCH"]);
});

test("real GDP q/q and y/y use exact adjacent and year-ago quarters", () => {
  const result = calculateKoreaRealGdpGrowth(
    evidence("real-gdp-sa", observation("2026-06-30", "2026Q2", "110")),
    evidence("real-gdp-sa", observation("2026-03-31", "2026Q1", "100")),
    evidence("real-gdp-sa", observation("2025-06-30", "2025Q2", "105")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.ok(Math.abs(result.qoqPercent - 10) < 1e-10);
  assert.ok(Math.abs(result.yoyPercent - (110 / 105 - 1) * 100) < 1e-10);
  assert.equal(result.revisionStatus, "source_not_provided");
});

test("GDP calculation blocks wrong comparison quarter and missing denominator", () => {
  const wrongPeriod = calculateKoreaRealGdpGrowth(
    evidence("real-gdp-sa", observation("2026-06-30", "2026Q2", "110")),
    evidence("real-gdp-sa", observation("2025-12-31", "2025Q4", "100")),
    evidence("real-gdp-sa", observation("2025-06-30", "2025Q2", "105")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(wrongPeriod.status === "blocked" && wrongPeriod.issues.map((issue) => issue.code), ["DATE_MISMATCH"]);

  const missing = calculateKoreaRealGdpGrowth(
    evidence("real-gdp-sa", observation("2026-06-30", "2026Q2", "110")),
    evidence("real-gdp-sa", observation("2026-03-31", "2026Q1", "0")),
    evidence("real-gdp-sa", observation("2025-06-30", "2025Q2", "105")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(missing.status === "blocked" && missing.issues.map((issue) => issue.code), ["DATA_MISSING"]);
});

test("headline and core CPI y/y require the exact same series and month", () => {
  const current = evidence("cpi-headline", observation("2026-08-01", "202608", "104"));
  const yearAgo = evidence("cpi-headline", observation("2025-08-01", "202508", "100"));
  const result = calculateKoreaCpiYearOverYear(current, yearAgo, "2026-08-31T00:00:00.000Z");
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.ok(Math.abs(result.yoyPercent - 4) < 1e-10);

  const mixed = calculateKoreaCpiYearOverYear(
    current,
    evidence("cpi-core-food-energy-excluded", observation("2025-08-01", "202508", "100")),
    "2026-08-31T00:00:00.000Z",
  );
  assert.deepEqual(mixed.status === "blocked" && mixed.issues.map((issue) => issue.code), ["SERIES_MISMATCH"]);
});
