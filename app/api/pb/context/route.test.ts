import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createPbSessionToken, PB_SESSION_COOKIE } from "@/lib/auth/session.server";
import { GET } from "./route";

const SECRET = "test-only-pb-session-secret-with-at-least-32-bytes";

async function withSecret<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.PB_SESSION_SECRET;
  process.env.PB_SESSION_SECRET = SECRET;
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.PB_SESSION_SECRET;
    else process.env.PB_SESSION_SECRET = previous;
  }
}

function request(path: string, pbId = "pb-demo-youngcreator") {
  const { token } = createPbSessionToken(
    { pbId, pbName: "데모 PB" },
    { secret: SECRET, nonce: "fixed-context-nonce-123" },
  );
  return new NextRequest(`http://localhost${path}`, {
    headers: { cookie: `${PB_SESSION_COOKIE}=${token}` },
  });
}

test("authorized response contains only the signed-session PB clients and no PB credentials", async () => {
  await withSecret(async () => {
    const response = await GET(request("/api/pb/context?pbId=pb-demo-youngcreator"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.clients.length > 0);
    assert.ok(body.clients.every((client: { assignedPbId: string }) => client.assignedPbId === "pb-demo-youngcreator"));
    assert.deepEqual(Object.keys(body.pb).sort(), ["id", "name"]);
    assert.equal(JSON.stringify(body).includes('"password"'), false);
  });
});

test("PB URL mismatch is rejected before any client response", async () => {
  await withSecret(async () => {
    const response = await GET(request("/api/pb/context?pbId=pb-other"));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal("clients" in body, false);
  });
});

test("foreign client ID returns 404 without a client list", async () => {
  await withSecret(async () => {
    const response = await GET(request("/api/pb/context?clientId=foreign-client"));
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal("clients" in body, false);
  });
});
