import assert from "node:assert/strict";
import test from "node:test";
import type { MacroTrendObservation, MacroTrendResponse } from "./historyTypes";
import {
  downsampleMacroTrendObservations,
  isMacroTrendResponse,
  normalizeMacroTrendObservations,
  prepareMacroTrendObservations,
} from "./historyValidation";

function observation(observationDate: string, valueRaw: string): MacroTrendObservation {
  return {
    observationDate,
    observationDateRaw: observationDate.replaceAll("-", ""),
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

function dateAt(index: number): string {
  return new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10);
}

test("normalization sorts and removes exact duplicates only", () => {
  const later = observation("2026-09-01", "2.5");
  const earlier = observation("2026-08-31", "2.4");
  const result = normalizeMacroTrendObservations([later, earlier, { ...earlier }]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.originalObservationCount, 3);
  assert.deepEqual(result.observations.map(({ observationDate }) => observationDate), [
    "2026-08-31",
    "2026-09-01",
  ]);
});

test("same-date conflicts fail closed and nonnumeric source text is not coerced", () => {
  const conflict = normalizeMacroTrendObservations([
    observation("2026-09-01", "2.5"),
    observation("2026-09-01", "2.6"),
  ]);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok ? null : conflict.code, "DATA_CONFLICT");

  const invalid = normalizeMacroTrendObservations([observation("2026-09-01", "2.5%")]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.ok ? null : invalid.code, "RESPONSE_INVALID");

  const inconsistentAvailability = observation("2026-09-01", "2.5");
  inconsistentAvailability.availability.releaseDate = "provided";
  const inconsistent = normalizeMacroTrendObservations([inconsistentAvailability]);
  assert.equal(inconsistent.ok, false);
  assert.equal(inconsistent.ok ? null : inconsistent.code, "RESPONSE_INVALID");
});

test("missing values stay missing and never become zero or an interpolated point", () => {
  const prepared = prepareMacroTrendObservations({
    observations: [
      observation("2026-08-31", "2.5"),
      observation("2026-09-01", ""),
    ],
    range: "1W",
    frequency: "D",
  });
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  assert.equal(prepared.validObservationCount, 1);
  assert.equal(prepared.missingObservationCount, 1);
  assert.equal(prepared.displayMode, "latest");
  assert.equal(prepared.observations[1].valueRaw, "");
  assert.equal(prepared.observations.some(({ valueRaw }) => valueRaw === "0"), false);
});

test("zero valid observations is blocked and 2-7 / 8+ valid observations choose table / line", () => {
  const missing = prepareMacroTrendObservations({
    observations: [observation("2026-09-01", "")],
    range: "1D",
    frequency: "D",
  });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.status === "blocked" && missing.code, "DATA_MISSING");

  const seven = prepareMacroTrendObservations({
    observations: Array.from({ length: 7 }, (_, index) => observation(dateAt(index), String(index))),
    range: "1M",
    frequency: "D",
  });
  assert.equal(seven.status === "ready" && seven.displayMode, "table");

  const eight = prepareMacroTrendObservations({
    observations: Array.from({ length: 8 }, (_, index) => observation(dateAt(index), String(index))),
    range: "1M",
    frequency: "D",
  });
  assert.equal(eight.status === "ready" && eight.displayMode, "line");
});

test("range preparation anchors to the latest source observation and retains counts and coverage", () => {
  const source = [
    observation("2026-08-20", "1"),
    observation("2026-08-25", "2"),
    observation("2026-09-01", "3"),
  ];
  const prepared = prepareMacroTrendObservations({ observations: source, range: "1W", frequency: "D" });
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  assert.equal(prepared.anchorObservationDate, "2026-09-01");
  assert.equal(prepared.requestedStartDate, "2026-08-25");
  assert.equal(prepared.requestedEndDate, "2026-09-01");
  assert.equal(prepared.originalObservationCount, 3);
  assert.equal(prepared.normalizedObservationCount, 3);
  assert.equal(prepared.inRangeObservationCount, 2);
  assert.deepEqual(prepared.actualCoverage, {
    startDate: "2026-08-25",
    endDate: "2026-09-01",
    calendarDaySpan: 7,
  });
});

test("deterministic min/max buckets cap long history and preserve endpoints and global extrema", () => {
  const source = Array.from({ length: 1_002 }, (_, index) => {
    const value = index === 333 ? -999 : index === 777 ? 999 : index % 41;
    return observation(dateAt(index), index === 500 ? "" : String(value));
  });
  const first = downsampleMacroTrendObservations(source);
  const second = downsampleMacroTrendObservations(source);
  assert.deepEqual(first, second);
  assert.ok(first.length <= 480);
  assert.equal(first[0].observationDate, source[0].observationDate);
  assert.equal(first.at(-1)?.observationDate, source.at(-1)?.observationDate);
  assert.ok(first.some(({ valueRaw }) => valueRaw === "-999"));
  assert.ok(first.some(({ valueRaw }) => valueRaw === "999"));
  assert.ok(first.some(({ valueRaw }) => valueRaw === ""));
  assert.ok(first.every((point) => source.includes(point)));
});

test("downsampling fails closed when all missing-run sentinels cannot fit", () => {
  const source = Array.from({ length: 20 }, (_, index) =>
    observation(dateAt(index), index % 2 === 0 ? String(index) : "")
  );
  const prepared = prepareMacroTrendObservations({
    observations: source,
    range: "1M",
    frequency: "D",
    maxPoints: 4,
  });
  assert.equal(prepared.status, "blocked");
  assert.equal(prepared.status === "blocked" && prepared.code, "RESPONSE_TOO_LARGE");
});

function readyResponse(): MacroTrendResponse {
  const source = Array.from({ length: 10 }, (_, index) => observation(dateAt(index), String(index + 1)));
  const prepared = prepareMacroTrendObservations({ observations: source, range: "1M", frequency: "D" });
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") throw new Error("test preparation failed");
  return {
    ok: true,
    pbId: "pb-demo",
    clientId: "client-demo",
    range: "1M",
    result: {
      status: "ready",
      seriesId: "bok-policy-rate",
      title: "한국은행 기준금리",
      sectionId: "korea-macro",
      providerId: "ecos",
      provider: "한국은행 경제통계시스템(ECOS)",
      frequency: "D",
      unit: "%",
      definitionVersion: "test-definition-v1",
      range: "1M",
      anchorObservationDate: prepared.anchorObservationDate,
      requestedStartDate: prepared.requestedStartDate,
      requestedEndDate: prepared.requestedEndDate,
      observations: prepared.observations,
      originalObservationCount: prepared.originalObservationCount,
      normalizedObservationCount: prepared.normalizedObservationCount,
      inRangeObservationCount: prepared.inRangeObservationCount,
      validObservationCount: prepared.validObservationCount,
      missingObservationCount: prepared.missingObservationCount,
      returnedObservationCount: prepared.returnedObservationCount,
      displayMode: prepared.displayMode,
      actualCoverage: prepared.actualCoverage,
      gaps: prepared.gaps,
      sourceUrl: "https://ecos.bok.or.kr/",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      datasetContentHash: "a".repeat(64),
      rightsStatus: "pb-internal-use-approved",
      isEducationalFixture: false,
      captures: [{
        captureId: "capture-1",
        providerId: "ecos",
        contentHash: "b".repeat(64),
        bodyByteLength: 123,
        retrievedAt: "2026-09-01T00:00:00.000Z",
        responseStatus: 200,
        contentType: "application/json",
        sanitizedRequest: {
          providerId: "ecos",
          operation: "history",
          seriesIds: ["bok-policy-rate"],
        },
      }],
    },
    consumerPolicy: {
      pbInternalResearchDisplay: true,
      portfolio: false,
      productRecommendation: false,
      customerOutput: false,
      aiNumericGeneration: false,
    },
  };
}

test("public response validation is context-bound and rejects raw bytes or malformed counts", () => {
  const response = readyResponse();
  assert.equal(isMacroTrendResponse(response, {
    pbId: "pb-demo",
    clientId: "client-demo",
    seriesId: "bok-policy-rate",
    range: "1M",
  }), true);
  assert.equal(isMacroTrendResponse(response, { clientId: "other-client" }), false);

  const leaked = structuredClone(response) as MacroTrendResponse & { rawBase64: string };
  leaked.rawBase64 = "secret-source-bytes";
  assert.equal(isMacroTrendResponse(leaked), false);

  const malformed = structuredClone(response);
  if (malformed.result.status === "ready") malformed.result.returnedObservationCount += 1;
  assert.equal(isMacroTrendResponse(malformed), false);

  const inconsistentAvailability = structuredClone(response);
  if (inconsistentAvailability.result.status === "ready") {
    inconsistentAvailability.result.observations[0].availability.releaseDate = "provided";
  }
  assert.equal(isMacroTrendResponse(inconsistentAvailability), false);
});

test("strict response validation accepts a fail-closed blocked result", () => {
  const response: MacroTrendResponse = {
    ok: true,
    pbId: "pb-demo",
    clientId: "client-demo",
    range: "3Y",
    result: {
      status: "blocked",
      seriesId: "us-ig-oas",
      title: "미국 회사채 IG 스프레드",
      sectionId: "credit-volatility",
      range: "3Y",
      code: "RIGHTS_BLOCKED",
      message: "데이터 이용권 확인 필요",
      sourceUrl: "https://fred.stlouisfed.org/series/BAMLC0A0CM",
      rightsStatus: "licensed-data-required",
    },
    consumerPolicy: {
      pbInternalResearchDisplay: true,
      portfolio: false,
      productRecommendation: false,
      customerOutput: false,
      aiNumericGeneration: false,
    },
  };
  assert.equal(isMacroTrendResponse(response), true);
});
