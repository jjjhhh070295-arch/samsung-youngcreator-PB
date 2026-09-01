import assert from "node:assert/strict";
import test from "node:test";
import { fetchTreasuryYieldEvidence } from "./treasuryConnector.server";

function treasuryEntry(
  date: string,
  values: Partial<Record<"BC_2YEAR" | "BC_5YEAR" | "BC_10YEAR" | "BC_30YEAR", string>>,
): string {
  const fields = Object.entries(values)
    .map(([name, value]) => `<d:${name} m:type="Edm.Decimal">${value}</d:${name}>`)
    .join("");
  return `<entry><content type="application/xml"><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>${fields}</m:properties></content></entry>`;
}

function treasuryXml(entries: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">${entries.join("")}</feed>`;
}

function completeEntry(date = "2026-08-28", twoYear = "4.20"): string {
  return treasuryEntry(date, {
    BC_2YEAR: twoYear,
    BC_5YEAR: "4.10",
    BC_10YEAR: "4.05",
    BC_30YEAR: "4.25",
  });
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/atom+xml; charset=utf-8" },
  });
}

test("Treasury connector preserves exact raw bytes and returns four verified PB-internal series", async () => {
  const xml = treasuryXml([completeEntry()]);
  const result = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(xml),
    now: () => new Date("2026-08-31T09:00:00.000Z"),
  });

  assert.equal(result.ok, true);
  assert.equal(result.results.length, 4);
  assert.equal(result.captureCreated, true);
  assert.equal(result.archive.length, 1);
  assert.equal(Buffer.from(result.capture?.rawBase64 ?? "", "base64").toString("utf8"), xml);
  assert.match(result.capture?.contentHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.capture?.retrievedAt, "2026-08-31T09:00:00.000Z");
  assert.equal("url" in (result.capture?.sanitizedRequest ?? {}), false);
  for (const series of result.results) {
    assert.equal(series.status, "ready");
    if (series.status !== "ready") continue;
    assert.equal(series.rightsStatus, "pb-internal-use-approved");
    assert.equal(series.latestObservation.observationDate, "2026-08-28");
    assert.equal(series.latestObservation.releaseDate, null);
    assert.equal(series.latestObservation.vintageDate, null);
    assert.equal(series.latestObservation.preliminaryFinal, null);
    assert.equal(series.latestObservation.revisionStatus, null);
    assert.deepEqual(series.latestObservation.availability, {
      releaseDate: "source_not_provided",
      vintageDate: "source_not_provided",
      preliminaryFinal: "source_not_provided",
      revisionStatus: "source_not_provided",
    });
  }
});

test("latest Treasury row with a missing tenor fails closed instead of falling back", async () => {
  const xml = treasuryXml([
    completeEntry("2026-08-27"),
    treasuryEntry("2026-08-28", {
      BC_2YEAR: "4.20",
      BC_5YEAR: "4.10",
      BC_10YEAR: "4.05",
    }),
  ]);
  const result = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(xml),
    now: () => new Date("2026-08-31T09:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.results.every((item) => item.status === "blocked" && item.code === "DATA_MISSING"), true);
  assert.equal(result.archive.length, 1);
});

test("stale Treasury observations fail closed", async () => {
  const result = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(treasuryXml([completeEntry("2026-08-20") ])),
    now: () => new Date("2026-08-31T09:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.results.every((item) => item.status === "blocked" && item.code === "STALE"), true);
});

test("identical Treasury input is idempotent and retains the first retrieval capture", async () => {
  const xml = treasuryXml([completeEntry()]);
  const first = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(xml),
    now: () => new Date("2026-08-31T09:00:00.000Z"),
  });
  const repeated = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(xml),
    now: () => new Date("2026-08-31T10:00:00.000Z"),
    archive: first.archive,
  });
  assert.equal(first.ok && repeated.ok, true);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.captureCreated, false);
  assert.equal(repeated.archive.length, 1);
  assert.equal(repeated.capture?.retrievedAt, first.capture?.retrievedAt);
});

test("changed Treasury bytes are archived without overwriting the original", async () => {
  const first = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(treasuryXml([completeEntry("2026-08-28", "4.20")])),
    now: () => new Date("2026-08-31T09:00:00.000Z"),
  });
  const changed = await fetchTreasuryYieldEvidence({
    fetcher: async () => xmlResponse(treasuryXml([completeEntry("2026-08-28", "4.21")])),
    now: () => new Date("2026-08-31T10:00:00.000Z"),
    archive: first.archive,
  });
  assert.equal(first.ok && changed.ok, true);
  assert.equal(changed.rawChangeDetected, true);
  assert.equal(changed.archive.length, 2);
  assert.notEqual(changed.capture?.contentHash, first.capture?.contentHash);
  assert.equal(changed.archive[0]?.contentHash, first.capture?.contentHash);
  assert.equal(changed.results[0]?.status === "ready" && changed.results[0].latestObservation.valueRaw, "4.21");
  assert.equal(changed.results[0]?.status === "ready" && changed.results[0].latestObservation.revisionStatus, null);
});
