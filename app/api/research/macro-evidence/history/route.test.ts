import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  createPbSessionToken,
  PB_SESSION_COOKIE,
} from "@/lib/auth/session.server";
import type { MacroTrendResult } from "@/lib/researchCopilot/macroEvidence/historyTypes";
import {
  handleMacroHistoryRequest,
  type MacroHistoryRouteDependencies,
} from "./handler.server";

const SESSION_SECRET = "macro-history-route-session-secret-at-least-32-bytes";
const PB_ID = "pb-demo-youngcreator";
const CLIENT_ID = "client-allowed";

async function withSessionSecret<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.PB_SESSION_SECRET;
  process.env.PB_SESSION_SECRET = SESSION_SECRET;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PB_SESSION_SECRET;
    else process.env.PB_SESSION_SECRET = previous;
  }
}

function signedRequest(query: string, pbId = PB_ID) {
  const { token } = createPbSessionToken(
    { pbId, pbName: "데모 PB" },
    { secret: SESSION_SECRET, nonce: "macro-history-fixed-session-nonce" },
  );
  return new NextRequest(`http://localhost/api/research/macro-evidence/history?${query}`, {
    headers: { cookie: `${PB_SESSION_COOKIE}=${token}` },
  });
}

function readyResult(): MacroTrendResult {
  const hash = "a".repeat(64);
  return {
    status: "ready",
    seriesId: "ktb-3y",
    title: "국고채 3년",
    sectionId: "korea-macro",
    providerId: "ecos",
    provider: "한국은행 경제통계시스템(ECOS)",
    frequency: "D",
    unit: "연%",
    definitionVersion: "ecos-market-yield-ktb-3y",
    range: "1D",
    anchorObservationDate: "2026-08-31",
    requestedStartDate: "2026-08-30",
    requestedEndDate: "2026-08-31",
    observations: [{
      observationDate: "2026-08-31",
      observationDateRaw: "20260831",
      valueRaw: "2.72",
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
    }],
    originalObservationCount: 1,
    normalizedObservationCount: 1,
    inRangeObservationCount: 1,
    validObservationCount: 1,
    missingObservationCount: 0,
    returnedObservationCount: 1,
    displayMode: "latest",
    actualCoverage: { startDate: "2026-08-31", endDate: "2026-08-31", calendarDaySpan: 0 },
    gaps: [],
    sourceUrl: "https://ecos.bok.or.kr/api/",
    retrievedAt: "2026-09-01T03:00:00.000Z",
    datasetContentHash: hash,
    rightsStatus: "pb-internal-use-approved",
    isEducationalFixture: false,
    captures: [{
      captureId: `macro-raw:ecos:StatisticSearch:${hash}`,
      providerId: "ecos",
      contentHash: hash,
      bodyByteLength: 128,
      retrievedAt: "2026-09-01T03:00:00.000Z",
      responseStatus: 200,
      contentType: "application/json",
      sanitizedRequest: {
        providerId: "ecos",
        operation: "StatisticSearch:rows:1-1000",
        seriesIds: ["ktb-3y"],
        frequency: "D",
        startDate: "20260830",
        endDate: "20260831",
      },
    }],
  };
}

function dependencies(overrides: Partial<MacroHistoryRouteDependencies> = {}): MacroHistoryRouteDependencies {
  return {
    listClients: async () => [{ id: CLIENT_ID }],
    loadSeries: async () => readyResult(),
    readEcosCredential: () => "server-ecos-secret",
    ...overrides,
  };
}

function assertPrivate(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.headers.get("vary"), "Cookie");
}

test("an authorized PB can load a client-scoped trend without exposing secrets", async () => {
  await withSessionSecret(async () => {
    const response = await handleMacroHistoryRequest(
      signedRequest(`pbId=${PB_ID}&clientId=${CLIENT_ID}&seriesId=ktb-3y&range=1D`),
      dependencies(),
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.pbId, PB_ID);
    assert.equal(body.clientId, CLIENT_ID);
    assert.equal(body.result.status, "ready");
    assert.equal(JSON.stringify(body).includes("server-ecos-secret"), false);
    assert.equal("rawBase64" in body.result.captures[0], false);
    assertPrivate(response);
  });
});

test("book is accepted as PB-common market context without querying a customer list", async () => {
  let clientListCalls = 0;
  await withSessionSecret(async () => {
    const response = await handleMacroHistoryRequest(
      signedRequest(`pbId=${PB_ID}&clientId=book&seriesId=ktb-3y&range=1D`),
      dependencies({ listClients: async () => { clientListCalls += 1; return []; } }),
    );
    assert.equal(response.status, 200);
    assert.equal(clientListCalls, 0);
  });
});

test("missing session is rejected before client lookup, env access, or connector invocation", async () => {
  let sideEffects = 0;
  await withSessionSecret(async () => {
    const response = await handleMacroHistoryRequest(
      new NextRequest(`http://localhost/api/research/macro-evidence/history?pbId=${PB_ID}&clientId=book&seriesId=ktb-3y&range=1D`),
      dependencies({
        listClients: async () => { sideEffects += 1; return []; },
        readEcosCredential: () => { sideEffects += 1; return "secret"; },
        loadSeries: async () => { sideEffects += 1; return readyResult(); },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(sideEffects, 0);
    assertPrivate(response);
  });
});

test("PB mismatch is rejected before client lookup, env access, or connector invocation", async () => {
  let sideEffects = 0;
  await withSessionSecret(async () => {
    const response = await handleMacroHistoryRequest(
      signedRequest("pbId=pb-other&clientId=book&seriesId=ktb-3y&range=1D"),
      dependencies({
        listClients: async () => { sideEffects += 1; return []; },
        readEcosCredential: () => { sideEffects += 1; return "secret"; },
        loadSeries: async () => { sideEffects += 1; return readyResult(); },
      }),
    );
    assert.equal(response.status, 403);
    assert.equal(sideEffects, 0);
  });
});

test("foreign client is returned as 404 before env access or connector invocation", async () => {
  let connectorSideEffects = 0;
  await withSessionSecret(async () => {
    const response = await handleMacroHistoryRequest(
      signedRequest(`pbId=${PB_ID}&clientId=foreign&seriesId=ktb-3y&range=1D`),
      dependencies({
        readEcosCredential: () => { connectorSideEffects += 1; return "secret"; },
        loadSeries: async () => { connectorSideEffects += 1; return readyResult(); },
      }),
    );
    assert.equal(response.status, 404);
    assert.equal(connectorSideEffects, 0);
  });
});

test("invalid series and range are rejected before env access or connector invocation", async () => {
  let sideEffects = 0;
  await withSessionSecret(async () => {
    for (const query of [
      `pbId=${PB_ID}&clientId=book&seriesId=forged-series&range=1D`,
      `pbId=${PB_ID}&clientId=book&seriesId=ktb-3y&range=ALL`,
    ]) {
      const response = await handleMacroHistoryRequest(
        signedRequest(query),
        dependencies({
          readEcosCredential: () => { sideEffects += 1; return "secret"; },
          loadSeries: async () => { sideEffects += 1; return readyResult(); },
        }),
      );
      assert.equal(response.status, 400);
    }
    assert.equal(sideEffects, 0);
  });
});

test("missing ECOS key returns a validated blocked result without fetching or leaking a key", async () => {
  let fetchCount = 0;
  const previousKey = process.env.ECOS_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.ECOS_API_KEY;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("must not fetch");
  };
  try {
    await withSessionSecret(async () => {
      const { GET } = await import("./route");
      const response = await GET(signedRequest(`pbId=${PB_ID}&clientId=book&seriesId=ktb-3y&range=1D`));
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.result.status, "blocked");
      assert.equal(body.result.code, "KEY_MISSING");
      assert.equal(fetchCount, 0);
      assert.equal(JSON.stringify(body).includes("ECOS_API_KEY"), false);
      assertPrivate(response);
    });
  } finally {
    if (previousKey === undefined) delete process.env.ECOS_API_KEY;
    else process.env.ECOS_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
