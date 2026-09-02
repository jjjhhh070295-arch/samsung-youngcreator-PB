import assert from "node:assert/strict";
import test from "node:test";
import {
  captureKoreaMacroRawResponse,
  fetchKoreaMacroSeries,
  hasEcosApiKeyBinding,
  preserveKoreaMacroRawCapture,
  type KoreaMacroFetch,
} from "./koreaConnector.server";

function input(raw = '{"StatisticSearch":{"row":[]}}') {
  return {
    seriesId: "bok-policy-rate" as const,
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    rawBytes: new TextEncoder().encode(raw),
    retrievedAt: "2026-08-31T09:00:00.000Z",
    environment: { ECOS_API_KEY: "opaque-test-placeholder" },
  };
}

test("credential check observes presence without reading or exposing the value", () => {
  const environment = {};
  Object.defineProperty(environment, "ECOS_API_KEY", {
    enumerable: false,
    get() {
      throw new Error("credential value must not be read");
    },
  });
  assert.equal(hasEcosApiKeyBinding(environment), true);
  assert.equal(hasEcosApiKeyBinding({}), false);
});

test("missing key binding and missing bytes fail closed", () => {
  const missingKey = captureKoreaMacroRawResponse({ ...input(), environment: {} });
  assert.equal(missingKey.ok, false);
  if (!missingKey.ok) assert.equal(missingKey.issues[0]?.code, "KEY_MISSING");

  const missingRaw = captureKoreaMacroRawResponse({ ...input(), rawBytes: new Uint8Array() });
  assert.equal(missingRaw.ok, false);
  if (!missingRaw.ok) assert.equal(missingRaw.issues[0]?.code, "RAW_RESPONSE_MISSING");
});

test("raw bytes, hash, retrieval time and unknown source statuses are preserved", () => {
  const result = captureKoreaMacroRawResponse(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(Buffer.from(result.capture.raw.rawBase64, "base64").toString("utf8"), '{"StatisticSearch":{"row":[]}}');
  assert.match(result.capture.raw.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.capture.raw.retrievedAt, "2026-08-31T09:00:00.000Z");
  assert.equal(result.capture.raw.sanitizedRequest.providerId, "ecos");
  assert.equal("url" in result.capture.raw.sanitizedRequest, false);
  assert.equal(result.capture.releaseDate.status, "source_not_provided");
  assert.equal(result.capture.vintageDate.value, null);
  assert.equal(result.capture.preliminaryFinal.value, null);
  assert.equal(result.capture.revisionStatus.value, null);
});

test("same raw capture is idempotent", () => {
  const first = captureKoreaMacroRawResponse(input());
  const repeated = captureKoreaMacroRawResponse({ ...input(), retrievedAt: "2026-08-31T09:05:00.000Z" });
  assert.equal(first.ok && repeated.ok, true);
  if (!first.ok || !repeated.ok) return;

  const archived = preserveKoreaMacroRawCapture([], first.capture);
  const repeatedArchive = preserveKoreaMacroRawCapture(archived.archive, repeated.capture);
  assert.equal(repeatedArchive.created, false);
  assert.equal(repeatedArchive.archive.length, 1);
  assert.equal(repeatedArchive.entry.raw.retrievedAt, first.capture.raw.retrievedAt);
});

test("changed bytes are archived as a detected revision without overwriting the original", () => {
  const first = captureKoreaMacroRawResponse(input("first-original"));
  const changed = captureKoreaMacroRawResponse(input("later-changed"));
  assert.equal(first.ok && changed.ok, true);
  if (!first.ok || !changed.ok) return;

  const initial = preserveKoreaMacroRawCapture([], first.capture);
  const revision = preserveKoreaMacroRawCapture(initial.archive, changed.capture);
  assert.equal(revision.created, true);
  assert.equal(revision.revisionDetected, true);
  assert.equal(revision.archive.length, 2);
  assert.equal(Buffer.from(revision.archive[0]!.raw.rawBase64, "base64").toString("utf8"), "first-original");
  assert.equal(revision.entry.revisionDetection, "hash_changed");
  assert.equal(revision.entry.revisionStatus.status, "source_not_provided");
  assert.equal(revision.entry.supersedesCaptureId, first.capture.captureId);
});

function statisticPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    StatisticSearch: {
      row: [{
        STAT_CODE: "817Y002",
        ITEM_CODE1: "010200000",
        UNIT_NAME: "연%",
        TIME: "20260829",
        DATA_VALUE: "2.60",
        ...overrides,
      }],
    },
  });
}

function fakeFetch(body: string, options: { status?: number; contentType?: string; onUrl?: (url: string) => void } = {}): KoreaMacroFetch {
  return async (url) => {
    options.onUrl?.(url);
    const bytes = new TextEncoder().encode(body);
    return {
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      headers: { get: (name) => name.toLowerCase() === "content-type" ? (options.contentType ?? "application/json") : null },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
}

test("mocked ECOS StatisticSearch returns allowlisted evidence and never returns the key", async () => {
  const fakeCredential = "fake-secret-for-test-only";
  let requestedUrl = "";
  const output = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: fakeCredential,
    retrievedAt: "2026-08-31T09:00:00.000Z",
    nowIso: "2026-08-31T09:00:00.000Z",
    fetcher: fakeFetch(statisticPayload(), { onUrl: (url) => { requestedUrl = url; } }),
  });
  assert.match(requestedUrl, /fake-secret-for-test-only/);
  assert.equal(output.result.status, "ready");
  if (output.result.status !== "ready" || !output.capture) return;
  assert.equal(output.result.seriesId, "ktb-3y");
  assert.equal(output.result.latestObservation.valueRaw, "2.60");
  assert.equal(output.result.latestObservation.availability.revisionStatus, "source_not_provided");
  assert.equal(output.result.contentHash, output.capture.raw.contentHash);
  assert.doesNotMatch(JSON.stringify(output), new RegExp(fakeCredential));
  assert.equal("url" in output.capture.raw.sanitizedRequest, false);
});

test("live connector fails closed for key missing, data missing, stale and unit mismatch", async () => {
  let called = false;
  const missingKey = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: "",
    retrievedAt: "2026-08-31T09:00:00.000Z",
    nowIso: "2026-08-31T09:00:00.000Z",
    fetcher: async () => {
      called = true;
      throw new Error("must not run");
    },
  });
  assert.equal(called, false);
  assert.equal(missingKey.result.status, "blocked");
  if (missingKey.result.status === "blocked") assert.equal(missingKey.result.code, "KEY_MISSING");

  const missing = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: "fake-key",
    retrievedAt: "2026-08-31T09:00:00.000Z",
    nowIso: "2026-08-31T09:00:00.000Z",
    fetcher: fakeFetch(JSON.stringify({ StatisticSearch: { row: [] } })),
  });
  assert.equal(missing.result.status, "blocked");
  if (missing.result.status === "blocked") assert.equal(missing.result.code, "DATA_MISSING");

  const stale = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260701",
    requestedEndPeriod: "20260731",
    credential: "fake-key",
    retrievedAt: "2026-08-31T09:00:00.000Z",
    nowIso: "2026-08-31T09:00:00.000Z",
    fetcher: fakeFetch(statisticPayload({ TIME: "20260731" })),
  });
  assert.equal(stale.result.status, "blocked");
  if (stale.result.status === "blocked") assert.equal(stale.result.code, "STALE");

  const wrongUnit = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: "fake-key",
    retrievedAt: "2026-08-31T09:00:00.000Z",
    nowIso: "2026-08-31T09:00:00.000Z",
    fetcher: fakeFetch(statisticPayload({ UNIT_NAME: "bp" })),
  });
  assert.equal(wrongUnit.result.status, "blocked");
  if (wrongUnit.result.status === "blocked") assert.equal(wrongUnit.result.code, "UNIT_MISMATCH");
});

test("same-period duplicate ECOS rows dedupe exactly and conflicting values fail closed", async () => {
  const exactPayload = JSON.stringify({
    StatisticSearch: { row: [
      { STAT_CODE: "817Y002", ITEM_CODE1: "010200000", UNIT_NAME: "연%", TIME: "20260828", DATA_VALUE: "2.60" },
      { STAT_CODE: "817Y002", ITEM_CODE1: "010200000", UNIT_NAME: "연%", TIME: "20260828", DATA_VALUE: "2.60" },
    ] },
  });
  const exact = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: "opaque-test-key",
    retrievedAt: "2026-08-31T00:00:00.000Z",
    nowIso: "2026-08-31T00:00:00.000Z",
    fetcher: async () => new Response(exactPayload, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(exact.result.status, "ready");
  if (exact.result.status === "ready") assert.equal(exact.result.observations.length, 1);

  const conflictPayload = exactPayload.replace('"DATA_VALUE":"2.60"}]}', '"DATA_VALUE":"2.61"}]}');
  const conflict = await fetchKoreaMacroSeries({
    seriesId: "ktb-3y",
    requestedStartPeriod: "20260801",
    requestedEndPeriod: "20260831",
    credential: "opaque-test-key",
    retrievedAt: "2026-08-31T00:00:00.000Z",
    nowIso: "2026-08-31T00:00:00.000Z",
    fetcher: async () => new Response(conflictPayload, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(conflict.result.status, "blocked");
  if (conflict.result.status === "blocked") assert.equal(conflict.result.code, "DATA_CONFLICT");
});
