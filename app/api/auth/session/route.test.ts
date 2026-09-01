import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const SECRET = "test-only-pb-session-secret-with-at-least-32-bytes";

async function withSecret<T>(secret: string | undefined, run: () => Promise<T>): Promise<T> {
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

test("normal login sets a signed HttpOnly SameSite cookie without returning credentials", async () => {
  await withSecret(SECRET, async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ employeeId: "PB-001", password: "1234" }),
      headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.session.pbId, "pb-demo-youngcreator");
    assert.equal("password" in body.session, false);
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.match(cookie, /pb-demo-session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
  });
});

test("key missing fails closed with 503 and no session cookie", async () => {
  await withSecret(undefined, async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ employeeId: "PB-001", password: "1234" }),
      headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

test("forged localStorage/header identity cannot authorize a request without the signed cookie", async () => {
  await withSecret(SECRET, async () => {
    const response = await GET(new NextRequest("http://localhost/api/auth/session", {
      headers: { "x-pb-id": "pb-demo-youngcreator" },
    }));
    assert.equal(response.status, 401);
  });
});

test("forged cookie is rejected", async () => {
  await withSecret(SECRET, async () => {
    const response = await GET(new NextRequest("http://localhost/api/auth/session", {
      headers: { cookie: "pb-demo-session=forged.payload" },
    }));
    assert.equal(response.status, 401);
  });
});
