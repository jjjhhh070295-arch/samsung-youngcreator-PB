import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  createPbSessionToken,
  PB_SESSION_COOKIE,
} from "@/lib/auth/session.server";
import { GET } from "./route";

const SESSION_SECRET = "route-test-pb-session-secret-with-at-least-32-bytes";
const ECOS_SECRET = "route-test-ecos-secret-must-never-be-returned";

type EnvironmentOptions = {
  sessionSecret?: string;
  ecosKey?: string;
  onFetch?: typeof fetch;
};

async function withRouteEnvironment<T>(
  options: EnvironmentOptions,
  run: () => Promise<T>,
): Promise<T> {
  const previousSessionSecret = process.env.PB_SESSION_SECRET;
  const previousEcosKey = process.env.ECOS_API_KEY;
  const previousFetch = globalThis.fetch;

  if (options.sessionSecret === undefined) delete process.env.PB_SESSION_SECRET;
  else process.env.PB_SESSION_SECRET = options.sessionSecret;
  if (options.ecosKey === undefined) delete process.env.ECOS_API_KEY;
  else process.env.ECOS_API_KEY = options.ecosKey;
  globalThis.fetch = options.onFetch ?? (async () => new Response("unavailable", { status: 503 }));

  try {
    return await run();
  } finally {
    if (previousSessionSecret === undefined) delete process.env.PB_SESSION_SECRET;
    else process.env.PB_SESSION_SECRET = previousSessionSecret;
    if (previousEcosKey === undefined) delete process.env.ECOS_API_KEY;
    else process.env.ECOS_API_KEY = previousEcosKey;
    globalThis.fetch = previousFetch;
  }
}

function requestWithToken(token?: string) {
  return new NextRequest("http://localhost/api/research/macro-evidence", {
    headers: token ? { cookie: `${PB_SESSION_COOKIE}=${token}` } : undefined,
  });
}

function validToken() {
  return createPbSessionToken(
    { pbId: "pb-demo-youngcreator", pbName: "데모 PB" },
    { secret: SESSION_SECRET, nonce: "fixed-route-session-nonce-123" },
  ).token;
}

function assertPrivateCookieResponse(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.headers.get("vary"), "Cookie");
}

test("a valid signed PB session can read the macro dashboard without exposing secrets", async () => {
  await withRouteEnvironment(
    { sessionSecret: SESSION_SECRET, ecosKey: ECOS_SECRET },
    async () => {
      const response = await GET(requestWithToken(validToken()));
      const serialized = JSON.stringify(await response.json());

      assert.equal(response.status, 200);
      assertPrivateCookieResponse(response);
      assert.equal(serialized.includes(SESSION_SECRET), false);
      assert.equal(serialized.includes(ECOS_SECRET), false);
    },
  );
});

test("a request without a session is rejected before any connector fetch", async () => {
  let fetchCount = 0;
  await withRouteEnvironment(
    {
      sessionSecret: SESSION_SECRET,
      ecosKey: ECOS_SECRET,
      onFetch: async () => {
        fetchCount += 1;
        throw new Error(`connector must not run: ${ECOS_SECRET}`);
      },
    },
    async () => {
      const response = await GET(requestWithToken());
      const body = await response.json();

      assert.equal(response.status, 401);
      assert.equal(body.code, "PB_SESSION_REQUIRED");
      assert.equal(fetchCount, 0);
      assertPrivateCookieResponse(response);
    },
  );
});

test("a tampered PB session is rejected before any connector fetch", async () => {
  let fetchCount = 0;
  const token = validToken();
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

  await withRouteEnvironment(
    {
      sessionSecret: SESSION_SECRET,
      ecosKey: ECOS_SECRET,
      onFetch: async () => {
        fetchCount += 1;
        throw new Error("connector must not run");
      },
    },
    async () => {
      const response = await GET(requestWithToken(tampered));
      assert.equal(response.status, 401);
      assert.equal(fetchCount, 0);
      assertPrivateCookieResponse(response);
    },
  );
});

test("an expired PB session is rejected before any connector fetch", async () => {
  let fetchCount = 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const { token } = createPbSessionToken(
    { pbId: "pb-demo-youngcreator", pbName: "데모 PB" },
    {
      secret: SESSION_SECRET,
      nowSeconds: nowSeconds - 10,
      maxAgeSeconds: 1,
      nonce: "expired-route-session-nonce",
    },
  );

  await withRouteEnvironment(
    {
      sessionSecret: SESSION_SECRET,
      ecosKey: ECOS_SECRET,
      onFetch: async () => {
        fetchCount += 1;
        throw new Error("connector must not run");
      },
    },
    async () => {
      const response = await GET(requestWithToken(token));
      assert.equal(response.status, 401);
      assert.equal(fetchCount, 0);
      assertPrivateCookieResponse(response);
    },
  );
});

test("a missing PB session secret fails closed with 503 before any connector fetch", async () => {
  let fetchCount = 0;
  await withRouteEnvironment(
    {
      ecosKey: ECOS_SECRET,
      onFetch: async () => {
        fetchCount += 1;
        throw new Error(`connector must not run: ${ECOS_SECRET}`);
      },
    },
    async () => {
      const response = await GET(requestWithToken(validToken()));
      const serialized = JSON.stringify(await response.json());

      assert.equal(response.status, 503);
      assert.equal(fetchCount, 0);
      assert.equal(serialized.includes(SESSION_SECRET), false);
      assert.equal(serialized.includes(ECOS_SECRET), false);
      assertPrivateCookieResponse(response);
    },
  );
});
