import assert from "node:assert/strict";
import test from "node:test";
import {
  createRawMacroCapture,
  decodeRawMacroCapture,
  preserveRawMacroCapture,
  toPublicMacroCaptureManifest,
} from "./rawCapture.server";

const encoder = new TextEncoder();

function capture(raw: string) {
  return createRawMacroCapture({
    bytes: encoder.encode(raw),
    retrievedAt: "2026-08-31T00:00:00.000Z",
    responseStatus: 200,
    contentType: "application/json",
    sanitizedRequest: {
      providerId: "ecos",
      operation: "StatisticSearch",
      seriesIds: ["bok-policy-rate-daily"],
    },
  });
}

test("raw bytes are preserved exactly while the public manifest excludes them", () => {
  const raw = "{\"DATA_VALUE\":\"2.50\",\"한글\":true}";
  const item = capture(raw);
  assert.equal(decodeRawMacroCapture(item), raw);
  const manifest = toPublicMacroCaptureManifest(item);
  assert.equal("rawBase64" in manifest, false);
  assert.equal(manifest.contentHash, item.contentHash);
});
test("raw preservation is idempotent and never overwrites a conflicting capture", () => {
  const first = capture("{\"value\":1}");
  const stored = preserveRawMacroCapture([], first);
  assert.equal(stored.ok, true);
  if (!stored.ok) return;
  const duplicate = preserveRawMacroCapture(stored.archive, first);
  assert.deepEqual(duplicate, { ok: true, archive: stored.archive, created: false });

  const conflict = { ...first, responseStatus: 206 };
  const rejected = preserveRawMacroCapture(stored.archive, conflict);
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.archive, stored.archive);
});
