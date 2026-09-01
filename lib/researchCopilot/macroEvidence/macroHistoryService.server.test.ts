import assert from "node:assert/strict";
import test from "node:test";
import { createRawMacroCapture } from "./rawCapture.server";
import type { EcosHistoryConnectorOptions } from "./ecosHistoryConnector.server";
import {
  loadMacroTrendSeries,
  mergeAppendOnlyMacroHistoryArchive,
} from "./macroHistoryService.server";
import type { MacroObservation, RawMacroCapture } from "./types";

const NOW = new Date("2026-09-01T03:00:00.000Z");

function observation(date: string, valueRaw: string): MacroObservation {
  return {
    observationDate: date,
    observationDateRaw: date.replaceAll("-", ""),
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

function capture(options: EcosHistoryConnectorOptions, suffix: string): RawMacroCapture {
  return createRawMacroCapture({
    bytes: Buffer.from(`official-page:${options.seriesId}:${suffix}`),
    retrievedAt: NOW.toISOString(),
    responseStatus: 200,
    contentType: "application/json",
    sanitizedRequest: {
      providerId: "ecos",
      operation: `StatisticSearch:rows:${suffix}`,
      seriesIds: [options.seriesId],
      frequency: options.seriesId.startsWith("cpi") ? "M" : "D",
      startDate: options.startPeriod,
      endDate: options.endPeriod,
    },
  });
}

test("macro history service returns only public manifests and exact display thresholds", async () => {
  const points = Array.from({ length: 8 }, (_, index) =>
    observation(`2026-08-${String(24 + index).padStart(2, "0")}`, String(2.7 + index / 100))
  );
  const result = await loadMacroTrendSeries({
    seriesId: "ktb-3y",
    range: "1W",
    ecosCredential: "secret",
    now: () => NOW,
    fetchEcos: async (options) => {
      const raw = capture(options, "1-8");
      return {
        ok: true,
        observations: points,
        captures: [raw],
        archive: [...(options.archive ?? []), raw],
        totalCount: points.length,
      };
    },
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.displayMode, "line");
  assert.equal(result.validObservationCount, 8);
  assert.equal(result.returnedObservationCount, 8);
  assert.equal(result.captures.length, 1);
  assert.equal("rawBase64" in result.captures[0], false);
  assert.match(result.datasetContentHash, /^[a-f\d]{64}$/);
});

test("macro history service propagates page conflicts as a blocked result", async () => {
  const result = await loadMacroTrendSeries({
    seriesId: "ktb-3y",
    range: "1M",
    ecosCredential: "secret",
    now: () => NOW,
    fetchEcos: async (options) => ({
      ok: false,
      code: "DATA_CONFLICT",
      message: "page total conflict",
      captures: [],
      archive: options.archive ?? [],
    }),
  });
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.equal(result.code, "DATA_CONFLICT");
  assert.equal("observations" in result, false);
});

test("macro history service blocks stale source observations", async () => {
  const result = await loadMacroTrendSeries({
    seriesId: "ktb-3y",
    range: "1M",
    ecosCredential: "secret",
    now: () => NOW,
    fetchEcos: async (options) => {
      const raw = capture(options, "stale");
      return {
        ok: true,
        observations: [observation("2026-08-01", "2.70")],
        captures: [raw],
        archive: [...(options.archive ?? []), raw],
        totalCount: 1,
      };
    },
  });
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") return;
  assert.equal(result.code, "STALE");
});

test("spread history is calculated only from identical date sets and approved definitions", async () => {
  const dates = ["2026-08-29", "2026-08-30", "2026-08-31"];
  const result = await loadMacroTrendSeries({
    seriesId: "corp-aa-minus-3y-spread",
    range: "1W",
    ecosCredential: "secret",
    now: () => NOW,
    fetchEcos: async (options) => {
      const raw = capture(options, options.seriesId);
      const values = options.seriesId === "corp-aa-minus-3y" ? ["3.20", "3.22", "3.25"] : ["2.70", "2.71", "2.72"];
      return {
        ok: true,
        observations: dates.map((date, index) => observation(date, values[index])),
        captures: [raw],
        archive: [...(options.archive ?? []), raw],
        totalCount: dates.length,
      };
    },
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.unit, "bp");
  assert.deepEqual(result.observations.map((item) => item.valueRaw), ["50", "51", "53"]);
  assert.equal(result.captures.length, 2);
});

test("CPI change history uses exact prior-year periods and never invents a missing denominator", async () => {
  const months: MacroObservation[] = [];
  for (let index = 0; index < 20; index += 1) {
    const absolute = 2025 * 12 + index;
    const year = Math.floor(absolute / 12);
    const month = absolute % 12 + 1;
    const raw = `${year}${String(month).padStart(2, "0")}`;
    const date = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    months.push({ ...observation(date, String(100 + index)), observationDateRaw: raw });
  }
  const result = await loadMacroTrendSeries({
    seriesId: "cpi-headline-yoy",
    range: "1Y",
    ecosCredential: "secret",
    now: () => NOW,
    fetchEcos: async (options) => {
      const raw = capture(options, "cpi");
      return {
        ok: true,
        observations: months,
        captures: [raw],
        archive: [...(options.archive ?? []), raw],
        totalCount: months.length,
      };
    },
  });
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.frequency, "M");
  assert.equal(result.observations.length, 8);
  assert.equal(result.observations[0].observationDateRaw, "202601");
});

test("concurrent stale archive snapshots merge append-only and exact duplicates remain idempotent", () => {
  const baseOptions = {
    seriesId: "ktb-3y" as const,
    startPeriod: "20260801",
    endPeriod: "20260831",
    credential: "secret",
    retrievedAt: NOW.toISOString(),
  };
  const base = capture(baseOptions, "base");
  const concurrentA = capture(baseOptions, "concurrent-a");
  const concurrentB = capture(baseOptions, "concurrent-b");

  const afterA = mergeAppendOnlyMacroHistoryArchive([base], [base, concurrentA]);
  const afterB = mergeAppendOnlyMacroHistoryArchive(afterA, [base, concurrentB]);
  const duplicateAgain = mergeAppendOnlyMacroHistoryArchive(afterB, [concurrentA, concurrentB]);

  assert.deepEqual(
    duplicateAgain.map((item) => item.captureId),
    [base.captureId, concurrentA.captureId, concurrentB.captureId],
  );
});
