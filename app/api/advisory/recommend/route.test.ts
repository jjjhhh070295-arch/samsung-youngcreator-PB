import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createPbSessionToken, PB_SESSION_COOKIE } from "@/lib/auth/session.server";
import { getServerDemoClient } from "@/lib/store";
import { POST } from "./route";

const SESSION_SECRET = "recommend-route-session-secret-with-at-least-32-bytes";
const CLIENT_ID = "client-hanbit-cashflow-sample";

async function withSessionSecret<T>(secret: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PB_SESSION_SECRET;
  if (secret === undefined) delete process.env.PB_SESSION_SECRET;
  else process.env.PB_SESSION_SECRET = secret;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PB_SESSION_SECRET;
    else process.env.PB_SESSION_SECRET = previous;
  }
}

function signedToken(pbId = "pb-demo-youngcreator") {
  return createPbSessionToken(
    { pbId, pbName: "테스트 PB" },
    { secret: SESSION_SECRET, nonce: `recommend-route-${pbId}-nonce` },
  ).token;
}

function request(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/advisory/recommend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { cookie: `${PB_SESSION_COOKIE}=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function assertPrivateResponse(response: Response) {
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
  assert.equal(response.headers.get("vary"), "Cookie");
}

test("a request without a signed PB session is rejected", async () => {
  await withSessionSecret(SESSION_SECRET, async () => {
    const response = await POST(request({ clientId: CLIENT_ID }));
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "PB_SESSION_REQUIRED");
    assertPrivateResponse(response);
  });
});

test("a PB cannot request a foreign or mismatched client", async () => {
  await withSessionSecret(SESSION_SECRET, async () => {
    const response = await POST(request({ clientId: CLIENT_ID }, signedToken("pb-foreign")));
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.code, "CLIENT_NOT_AUTHORIZED");
    assert.equal("result" in body, false);
    assertPrivateResponse(response);
  });
});

test("a forged browser client object cannot replace the server customer", async () => {
  await withSessionSecret(SESSION_SECRET, async () => {
    const missingIdentifier = await POST(request({
      client: { id: CLIENT_ID, name: "공격자 고객", assignedPbId: "pb-demo-youngcreator" },
    }, signedToken()));
    assert.equal(missingIdentifier.status, 400);
    assert.equal((await missingIdentifier.json()).code, "CLIENT_ID_REQUIRED");

    const response = await POST(request({
      clientId: CLIENT_ID,
      constraintText: "",
      client: {
        id: CLIENT_ID,
        name: "공격자 고객",
        assetSize: 999_999_999_999,
        assignedPbId: "pb-demo-youngcreator",
      },
    }, signedToken()));
    const body = await response.json();
    const serverClient = getServerDemoClient(CLIENT_ID);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(serverClient);
    assert.ok(body.result.narrativePromptFacts.includes(`고객=${serverClient.name}`));
    assert.equal(JSON.stringify(body).includes("공격자 고객"), false);
    assertPrivateResponse(response);
  });
});

test("an authorized signed PB session receives a deterministic recommendation", async () => {
  await withSessionSecret(SESSION_SECRET, async () => {
    const response = await POST(request(
      { clientId: CLIENT_ID, constraintText: "신탁만 검토" },
      signedToken(),
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.bundle.clientId, CLIENT_ID);
    assert.equal(body.result.source, "deterministic-catalog+rrttllu+cashflow");
    assertPrivateResponse(response);
  });
});

test("a missing PB session secret fails closed without returning recommendation data", async () => {
  const token = signedToken();
  await withSessionSecret(undefined, async () => {
    const response = await POST(request({ clientId: CLIENT_ID }, token));
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, "PB_SESSION_CONFIGURATION_UNAVAILABLE");
    assert.equal("result" in body, false);
    assertPrivateResponse(response);
  });
});
