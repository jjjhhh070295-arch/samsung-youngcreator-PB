import assert from "node:assert/strict";
import test from "node:test";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  createPbSessionToken,
  readPbSession,
  verifyPbSessionToken,
} from "./session.server";

const SECRET = "test-only-pb-session-secret-with-at-least-32-bytes";

test("normal: signed HttpOnly-cookie payload verifies for the expected PB", () => {
  const { token } = createPbSessionToken(
    { pbId: "pb-a", pbName: "테스트" },
    { secret: SECRET, nowSeconds: 100, nonce: "fixed-test-nonce-123456" },
  );
  const session = readPbSession(
    { get: (name) => (name === PB_SESSION_COOKIE ? { value: token } : undefined) },
    { secret: SECRET, nowSeconds: 101, expectedPbId: "pb-a" },
  );
  assert.equal(session?.pbId, "pb-a");
  assert.equal(session?.pbName, "테스트");
});

test("attack: changing the signed PB identity invalidates the token", () => {
  const { token } = createPbSessionToken(
    { pbId: "pb-a", pbName: "테스트" },
    { secret: SECRET, nowSeconds: 100, nonce: "fixed-test-nonce-123456" },
  );
  const [payload, signature] = token.split(".");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  parsed.pbId = "pb-b";
  const forged = `${Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url")}.${signature}`;
  assert.equal(verifyPbSessionToken(forged, { secret: SECRET, nowSeconds: 101 }), null);
});

test("identity: a valid session cannot authorize another PB URL", () => {
  const { token } = createPbSessionToken(
    { pbId: "pb-a", pbName: "테스트" },
    { secret: SECRET, nowSeconds: 100, nonce: "fixed-test-nonce-123456" },
  );
  assert.equal(
    verifyPbSessionToken(token, { secret: SECRET, nowSeconds: 101, expectedPbId: "pb-b" }),
    null,
  );
});

test("expired sessions fail closed", () => {
  const { token } = createPbSessionToken(
    { pbId: "pb-a", pbName: "테스트" },
    { secret: SECRET, nowSeconds: 100, maxAgeSeconds: 10, nonce: "fixed-test-nonce-123456" },
  );
  assert.equal(verifyPbSessionToken(token, { secret: SECRET, nowSeconds: 110 }), null);
});

test("key missing: creating or verifying a session fails closed", () => {
  assert.throws(
    () => createPbSessionToken({ pbId: "pb-a", pbName: "테스트" }, { secret: "" }),
    PbSessionConfigurationError,
  );
  assert.throws(() => verifyPbSessionToken("payload.signature", { secret: "" }), PbSessionConfigurationError);
});
