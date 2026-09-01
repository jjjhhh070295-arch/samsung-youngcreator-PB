import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchTreasuryHistory } from "./treasuryHistoryConnector.server";

const RETRIEVED_AT = "2026-09-01T03:00:00.000Z";

function feed(date: string, value: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
    <entry><content><d:NEW_DATE>${date}T00:00:00</d:NEW_DATE><d:BC_10YEAR>${value}</d:BC_10YEAR></content></entry>
  </feed>`;
}

function feedWithEntries(entries: string) {
  return `<?xml version="1.0" encoding="utf-8"?><feed>${entries}</feed>`;
}

function xmlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/atom+xml" },
  });
}

test("Treasury history fetches each required year and preserves exact response hashes", async () => {
  const xmlByYear: Record<string, string> = {
    "2025": feed("2025-12-31", "4.38"),
    "2026": feed("2026-08-31", "4.22"),
  };
  const requested: string[] = [];
  const result = await fetchTreasuryHistory({
    seriesId: "ust-cmt-10y",
    startDate: "2025-12-30",
    endDate: "2026-08-31",
    retrievedAt: RETRIEVED_AT,
    fetcher: async (url) => {
      const year = new URL(url).searchParams.get("field_tdr_date_value") ?? "";
      requested.push(year);
      return xmlResponse(xmlByYear[year]);
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(requested, ["2025", "2026"]);
  assert.deepEqual(result.observations.map((item) => item.valueRaw), ["4.38", "4.22"]);
  assert.equal(result.captures.length, 2);
  assert.deepEqual(
    result.captures.map((capture) => capture.contentHash),
    ["2025", "2026"].map((year) => createHash("sha256").update(Buffer.from(xmlByYear[year])).digest("hex")),
  );
  assert.equal(result.captures.every((capture) => !("rawBase64" in JSON.parse(JSON.stringify({
    captureId: capture.captureId,
    contentHash: capture.contentHash,
  })))), true);
});

test("Treasury history blocks a missing required year instead of silently shortening the range", async () => {
  const result = await fetchTreasuryHistory({
    seriesId: "ust-cmt-10y",
    startDate: "2025-12-30",
    endDate: "2026-08-31",
    retrievedAt: RETRIEVED_AT,
    fetcher: async (url) => {
      const year = new URL(url).searchParams.get("field_tdr_date_value");
      return xmlResponse(year === "2025" ? feed("2025-12-31", "4.38") : "<feed></feed>");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DATA_MISSING");
  assert.equal(result.captures.length, 2);
});

test("Treasury history blocks conflicting duplicate dates", async () => {
  const result = await fetchTreasuryHistory({
    seriesId: "ust-cmt-10y",
    startDate: "2025-12-30",
    endDate: "2026-08-31",
    retrievedAt: RETRIEVED_AT,
    fetcher: async (url) => {
      const year = new URL(url).searchParams.get("field_tdr_date_value");
      return xmlResponse(year === "2025"
        ? feed("2026-01-02", "4.38")
        : feed("2026-01-02", "4.99"));
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DATA_CONFLICT");
});

test("Treasury history rejects unapproved series without any fetch", async () => {
  let fetchCount = 0;
  const result = await fetchTreasuryHistory({
    seriesId: "nyfed-effr" as never,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    retrievedAt: RETRIEVED_AT,
    fetcher: async () => {
      fetchCount += 1;
      return xmlResponse(feed("2026-08-31", "5.33"));
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "SERIES_NOT_ALLOWED");
  assert.equal(fetchCount, 0);
});

test("Treasury nil and N/A tenors remain missing and are never converted to zero", async () => {
  const xml = feedWithEntries(`
    <entry><d:NEW_DATE>2026-08-27T00:00:00</d:NEW_DATE><d:BC_10YEAR m:null="true" /></entry>
    <entry><d:NEW_DATE>2026-08-28T00:00:00</d:NEW_DATE><d:BC_10YEAR>N/A</d:BC_10YEAR></entry>
    <entry><d:NEW_DATE>2026-08-31T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.22</d:BC_10YEAR></entry>
  `);
  const result = await fetchTreasuryHistory({
    seriesId: "ust-cmt-10y",
    startDate: "2026-08-27",
    endDate: "2026-08-31",
    retrievedAt: RETRIEVED_AT,
    fetcher: async () => xmlResponse(xml),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.observations.map((item) => item.valueRaw), ["", "", "4.22"]);
  assert.equal(result.observations.some((item) => item.valueRaw === "0"), false);
});
