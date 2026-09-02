import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { loadMacroEvidenceDashboard } from "./macroEvidenceService.server";
import { isMacroDashboardResult } from "./publicValidation";
import { getKoreaMacroDefinition, type KoreaMacroSeriesId } from "./koreaRegistry";
import { getUsMacroDefinition, NY_FED_SERIES_IDS, TREASURY_SERIES_IDS } from "./usRegistry";
import type {
  MacroObservation,
  MacroSeriesBlocked,
  MacroSeriesEvidence,
  RawMacroCapture,
} from "./types";

const NOW = new Date("2026-08-31T09:00:00.000Z");

function observation(raw: string, valueRaw: string): MacroObservation {
  const observationDate = raw.includes("Q")
    ? `${raw.slice(0, 4)}-${String(Number(raw.at(-1)) * 3).padStart(2, "0")}-${String(new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.at(-1)) * 3, 0)).getUTCDate()).padStart(2, "0")}`
    : raw.length === 6
      ? new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), 0)).toISOString().slice(0, 10)
      : `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return {
    observationDate,
    observationDateRaw: raw,
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

function seriesObservations(seriesId: KoreaMacroSeriesId): MacroObservation[] {
  if (seriesId === "real-gdp-sa") {
    return [
      observation("2025Q2", "520000"),
      observation("2025Q3", "525000"),
      observation("2025Q4", "530000"),
      observation("2026Q1", "535000"),
      observation("2026Q2", "540000"),
    ];
  }
  if (seriesId === "cpi-headline" || seriesId === "cpi-core-food-energy-excluded") {
    return [
      observation("202508", seriesId === "cpi-headline" ? "114.2" : "112.0"),
      observation("202608", seriesId === "cpi-headline" ? "116.5" : "113.8"),
    ];
  }
  const values: Partial<Record<KoreaMacroSeriesId, string>> = {
    "ktb-3y": "2.80",
    "corp-aa-minus-3y": "3.30",
    "corp-bbb-minus-3y": "8.90",
  };
  return [observation("20260828", values[seriesId] ?? "3.10")];
}

async function koreaReady(input: Parameters<NonNullable<Parameters<typeof loadMacroEvidenceDashboard>[0]["fetchKorea"]>>[0]) {
  const definition = getKoreaMacroDefinition(input.seriesId);
  const bytes = Buffer.from(`official:${input.seriesId}`);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const observations = seriesObservations(input.seriesId);
  const raw: RawMacroCapture = {
    captureId: `test:${input.seriesId}:${contentHash}`,
    providerId: "ecos",
    rawBase64: bytes.toString("base64"),
    contentHash,
    bodyByteLength: bytes.byteLength,
    retrievedAt: input.retrievedAt,
    responseStatus: 200,
    contentType: "application/json",
    sanitizedRequest: {
      providerId: "ecos",
      operation: "StatisticSearch",
      seriesIds: [input.seriesId],
      frequency: definition.frequency,
      startDate: input.requestedStartPeriod,
      endDate: input.requestedEndPeriod,
    },
  };
  const result: MacroSeriesEvidence = {
    status: "ready",
    mode: "official-live",
    seriesId: input.seriesId,
    sectionId: "korea-macro",
    providerId: "ecos",
    provider: definition.sourceInstitution,
    title: definition.label,
    frequency: definition.frequency,
    unit: definition.unit,
    definitionVersion: definition.definitionId,
    observations,
    latestObservation: observations.at(-1)!,
    sourceUrl: definition.sourceUrl,
    retrievedAt: input.retrievedAt,
    contentHash,
    rightsStatus: "pb-internal-use-approved",
    isEducationalFixture: false,
  };
  return {
    result,
    capture: {
      captureId: raw.captureId,
      queryKey: `${input.seriesId}:${input.requestedStartPeriod}:${input.requestedEndPeriod}`,
      seriesId: input.seriesId,
      requestedStartPeriod: input.requestedStartPeriod,
      requestedEndPeriod: input.requestedEndPeriod,
      raw,
      sourceUrl: definition.sourceUrl,
      releaseDate: definition.releaseDate,
      vintageDate: definition.vintageDate,
      preliminaryFinal: definition.preliminaryFinal,
      revisionStatus: definition.revisionStatus,
      revisionDetection: "not_detected" as const,
      supersedesCaptureId: null,
    },
  };
}

function usBlocked(seriesId: string): MacroSeriesBlocked {
  const definition = getUsMacroDefinition(seriesId as Parameters<typeof getUsMacroDefinition>[0]);
  return {
    status: "blocked",
    seriesId,
    sectionId: "us-rates",
    title: definition.title,
    code: "UPSTREAM_UNAVAILABLE",
    message: "테스트에서 공식 원천 응답을 차단했습니다.",
    sourceUrl: definition.sourceUrl,
    rightsStatus: "pb-internal-use-approved",
  };
}

const treasuryBlocked = async () => ({
  ok: false,
  results: TREASURY_SERIES_IDS.map(usBlocked),
  capture: null,
  archive: [] as RawMacroCapture[],
  captureCreated: false,
  duplicate: false,
  rawChangeDetected: false,
});

const nyFedBlocked = async () => ({
  ok: false,
  results: NY_FED_SERIES_IDS.map(usBlocked),
  capture: null,
  archive: [] as RawMacroCapture[],
  captureCreated: false,
  duplicate: false,
  rawChangeDetected: false,
});

test("official allowlisted sources and deterministic calculations form a valid public dashboard", async () => {
  const result = await loadMacroEvidenceDashboard({
    ecosCredential: "opaque-test-credential",
    now: () => NOW,
    fetchKorea: koreaReady,
    fetchTreasury: treasuryBlocked,
    fetchNyFed: nyFedBlocked,
  });
  assert.equal(isMacroDashboardResult(result), true);
  assert.equal(result.sections["credit-volatility"].some((item) => item.seriesId === "corp-aa-minus-3y-spread" && item.status === "ready"), true);
  assert.equal(result.sections["korea-macro"].some((item) => item.seriesId === "real-gdp-sa-qoq" && item.status === "ready"), true);
  assert.equal(result.sections["korea-macro"].some((item) => item.seriesId === "cpi-headline-yoy" && item.status === "ready"), true);
  assert.equal(JSON.stringify(result).includes("opaque-test-credential"), false);
});

test("missing ECOS key fails each Korean source closed while leaving no secret-shaped field", async () => {
  const result = await loadMacroEvidenceDashboard({
    ecosCredential: undefined,
    now: () => NOW,
    fetchTreasury: treasuryBlocked,
    fetchNyFed: nyFedBlocked,
  });
  assert.equal(isMacroDashboardResult(result), true);
  assert.equal(result.sections["korea-macro"].every((item) => item.status === "blocked"), true);
  assert.equal(JSON.stringify(result).includes("ECOS_API_KEY"), false);
  assert.equal(JSON.stringify(result).includes("credential"), false);
});

test("the same official captures are idempotent and do not multiply the public manifest", async () => {
  const options = {
    ecosCredential: "opaque-test-credential",
    now: () => NOW,
    fetchKorea: koreaReady,
    fetchTreasury: treasuryBlocked,
    fetchNyFed: nyFedBlocked,
  };
  const first = await loadMacroEvidenceDashboard(options);
  const second = await loadMacroEvidenceDashboard(options);
  assert.equal(first.captures.length, 14);
  assert.equal(second.captures.length, 14);
  assert.deepEqual(second.captures.map((item) => item.captureId), first.captures.map((item) => item.captureId));
});
