import assert from "node:assert/strict";
import test from "node:test";
import { fetchNyFedRatesEvidence } from "./nyFedConnector.server";

function ratePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    refRates: [{
      effectiveDate: "2026-08-28",
      type: "EFFR",
      percentRate: 3.64,
      targetRateFrom: 3.5,
      targetRateTo: 3.75,
      revisionIndicator: "",
      ...overrides,
    }],
  });
}

function jsonResponse(payload: string): Response {
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("NY Fed connector preserves raw bytes but blocks display until the mandatory notice is approved", async () => {
  const payload = ratePayload();
  const result = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(payload),
    now: () => new Date("2026-08-31T14:00:00.000Z"),
  });

  assert.equal(result.ok, false);
  assert.equal(result.results.length, 3);
  assert.deepEqual(
    result.results.map((item) => item.seriesId),
    ["nyfed-effr", "nyfed-target-lower", "nyfed-target-upper"],
  );
  assert.deepEqual(
    result.results.map((item) => item.status === "blocked" ? item.code : null),
    ["RIGHTS_BLOCKED", "RIGHTS_BLOCKED", "RIGHTS_BLOCKED"],
  );
  assert.equal(Buffer.from(result.capture?.rawBase64 ?? "", "base64").toString("utf8"), payload);
  assert.match(result.capture?.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.capture?.retrievedAt, "2026-08-31T14:00:00.000Z");
  assert.equal("url" in (result.capture?.sanitizedRequest ?? {}), false);
  assert.equal(result.results.every((series) => series.status === "blocked"
    && series.rightsStatus === "official-source-rights-review-required"), true);
});

test("missing NY Fed target-range field fails all three series closed", async () => {
  const older = JSON.parse(ratePayload({ effectiveDate: "2026-08-27" })) as { refRates: unknown[] };
  const latestMissing = JSON.parse(ratePayload({ targetRateTo: undefined })) as { refRates: unknown[] };
  const payload = JSON.stringify({ refRates: [older.refRates[0], latestMissing.refRates[0]] });
  const result = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(payload),
    now: () => new Date("2026-08-31T14:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.results.every((item) => item.status === "blocked" && item.code === "DATA_MISSING"), true);
  assert.equal(result.archive.length, 1);
});

test("stale NY Fed observations fail closed", async () => {
  const result = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(ratePayload({ effectiveDate: "2026-08-20" })),
    now: () => new Date("2026-08-31T14:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.results.every((item) => item.status === "blocked" && item.code === "STALE"), true);
});

test("identical NY Fed input is idempotent and retains the first retrieval capture", async () => {
  const payload = ratePayload();
  const first = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(payload),
    now: () => new Date("2026-08-31T14:00:00.000Z"),
  });
  const repeated = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(payload),
    now: () => new Date("2026-08-31T15:00:00.000Z"),
    archive: first.archive,
  });
  assert.equal(first.ok || repeated.ok, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.captureCreated, false);
  assert.equal(repeated.archive.length, 1);
  assert.equal(repeated.capture?.retrievedAt, first.capture?.retrievedAt);
});

test("changed NY Fed bytes are preserved without overwriting the original while rights stay blocked", async () => {
  const first = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(ratePayload()),
    now: () => new Date("2026-08-31T14:00:00.000Z"),
  });
  const changed = await fetchNyFedRatesEvidence({
    fetcher: async () => jsonResponse(ratePayload({ percentRate: 3.65, revisionIndicator: "Y" })),
    now: () => new Date("2026-08-31T15:00:00.000Z"),
    archive: first.archive,
  });
  assert.equal(first.ok || changed.ok, false);
  assert.equal(changed.rawChangeDetected, true);
  assert.equal(changed.archive.length, 2);
  assert.notEqual(changed.capture?.contentHash, first.capture?.contentHash);
  assert.equal(changed.archive[0]?.contentHash, first.capture?.contentHash);
  assert.equal(changed.results.every((item) => item.status === "blocked" && item.code === "RIGHTS_BLOCKED"), true);
});
