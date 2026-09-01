import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchEcosHistory } from "./ecosHistoryConnector.server";

const RETRIEVED_AT = "2026-09-01T03:00:00.000Z";

function row(time: string, value: string, unit = "연%") {
  return {
    STAT_CODE: "817Y002",
    ITEM_CODE1: "010200000",
    UNIT_NAME: unit,
    TIME: time,
    DATA_VALUE: value,
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("ECOS history paginates from list_total_count and preserves every exact raw page hash", async () => {
  const payloads = [
    { StatisticSearch: { list_total_count: 3, row: [row("20260827", "2.70"), row("20260828", "2.71")] } },
    { StatisticSearch: { list_total_count: 3, row: [row("20260831", "2.72")] } },
  ];
  const rawPages = payloads.map((payload) => JSON.stringify(payload));
  let fetchCount = 0;
  const result = await fetchEcosHistory({
    seriesId: "ktb-3y",
    startPeriod: "20260827",
    endPeriod: "20260831",
    credential: "server-secret-never-returned",
    retrievedAt: RETRIEVED_AT,
    pageSize: 2,
    fetcher: async (url) => {
      assert.equal(url.includes("server-secret-never-returned"), true);
      return jsonResponse(payloads[fetchCount++]);
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(fetchCount, 2);
  assert.equal(result.totalCount, 3);
  assert.deepEqual(result.observations.map((item) => item.valueRaw), ["2.70", "2.71", "2.72"]);
  assert.equal(result.captures.length, 2);
  assert.deepEqual(
    result.captures.map((capture) => capture.contentHash),
    rawPages.map((raw) => createHash("sha256").update(Buffer.from(raw)).digest("hex")),
  );
  assert.equal(JSON.stringify(result.captures).includes("server-secret-never-returned"), false);
  assert.deepEqual(
    result.captures.map((capture) => capture.sanitizedRequest.operation),
    ["StatisticSearch:rows:1-2", "StatisticSearch:rows:3-4"],
  );
});

test("ECOS history fails closed before fetch when the server key is missing", async () => {
  let fetchCount = 0;
  const result = await fetchEcosHistory({
    seriesId: "ktb-3y",
    startPeriod: "20260827",
    endPeriod: "20260831",
    credential: "",
    retrievedAt: RETRIEVED_AT,
    fetcher: async () => {
      fetchCount += 1;
      throw new Error("must not fetch");
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "KEY_MISSING");
  assert.equal(fetchCount, 0);
});

test("ECOS history blocks inconsistent list_total_count while preserving both raw pages", async () => {
  const payloads = [
    { StatisticSearch: { list_total_count: 3, row: [row("20260827", "2.70"), row("20260828", "2.71")] } },
    { StatisticSearch: { list_total_count: 4, row: [row("20260831", "2.72"), row("20260901", "2.73")] } },
  ];
  let index = 0;
  const result = await fetchEcosHistory({
    seriesId: "ktb-3y",
    startPeriod: "20260827",
    endPeriod: "20260901",
    credential: "secret",
    retrievedAt: RETRIEVED_AT,
    pageSize: 2,
    fetcher: async () => jsonResponse(payloads[index++]),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DATA_CONFLICT");
  assert.equal(result.captures.length, 2);
  assert.equal(result.archive.length, 2);
});

test("ECOS history never replaces a missing value or a unit mismatch with zero", async () => {
  const result = await fetchEcosHistory({
    seriesId: "ktb-3y",
    startPeriod: "20260831",
    endPeriod: "20260831",
    credential: "secret",
    retrievedAt: RETRIEVED_AT,
    fetcher: async () => jsonResponse({
      StatisticSearch: { list_total_count: 1, row: [row("20260831", "", "Percent")] },
    }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "UNIT_MISMATCH");
  assert.equal(JSON.stringify(result).includes('"valueRaw":"0"'), false);
});

test("ECOS history blocks conflicting duplicates across pages", async () => {
  const payloads = [
    { StatisticSearch: { list_total_count: 4, row: [row("20260827", "2.70"), row("20260828", "2.71")] } },
    { StatisticSearch: { list_total_count: 4, row: [row("20260828", "9.99"), row("20260831", "2.72")] } },
  ];
  let index = 0;
  const result = await fetchEcosHistory({
    seriesId: "ktb-3y",
    startPeriod: "20260827",
    endPeriod: "20260831",
    credential: "secret",
    retrievedAt: RETRIEVED_AT,
    pageSize: 2,
    fetcher: async () => jsonResponse(payloads[index++]),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DATA_CONFLICT");
});
