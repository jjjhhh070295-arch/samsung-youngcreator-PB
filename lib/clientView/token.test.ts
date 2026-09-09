import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildClientViewToken,
  verifyClientViewToken,
  CLIENT_VIEW_MAX_TTL_SEC,
} from "./token";

const SECRET = "test-client-view-secret-0123456789";
const OTHER = "another-secret-0123456789abcdef";
const CLIENT = "9079c157-1b9c-41b3-ac67-fc410755bcb2";

describe("고객 공유 링크 토큰", () => {
  it("발급한 토큰은 같은 시크릿으로 검증되고 clientId 를 돌려준다", () => {
    const { token, expiresAt } = buildClientViewToken(CLIENT, SECRET);
    const result = verifyClientViewToken(token, SECRET);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.clientId, CLIENT);
      assert.equal(result.expiresAt, expiresAt);
    }
  });

  it("다른 시크릿으로는 검증되지 않는다 — 수신거부 키 재사용을 막는 이유", () => {
    const { token } = buildClientViewToken(CLIENT, SECRET);
    const result = verifyClientViewToken(token, OTHER);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "bad_signature");
  });

  it("clientId 를 바꿔치기하면 서명이 깨진다 — 남의 화면을 열 수 없다", () => {
    const { token } = buildClientViewToken(CLIENT, SECRET);
    const [, sig] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ v: 1, c: "victim-party-id", e: Math.floor(Date.now() / 1000) + 3600 }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = verifyClientViewToken(`${forgedPayload}.${sig}`, SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "bad_signature");
  });

  it("만료 시각을 늘려도 서명이 깨진다 — 만료가 서명 안에 있기 때문", () => {
    // 수신거부 토큰처럼 만료를 서명 밖(?exp=)에 두면 이 조작이 통한다.
    const { token } = buildClientViewToken(CLIENT, SECRET, 60);
    const [payload, sig] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    claims.e += 86_400;
    const tampered = Buffer.from(JSON.stringify(claims), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const result = verifyClientViewToken(`${tampered}.${sig}`, SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "bad_signature");
  });

  it("만료된 토큰은 expired 로 구분된다", () => {
    // 과거 만료를 직접 만들 수 없으므로(빌더가 최소 60초를 강제한다) 시계를 옮긴다.
    const { token } = buildClientViewToken(CLIENT, SECRET, 60);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 61_000;
      const result = verifyClientViewToken(token, SECRET);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "expired");
    } finally {
      Date.now = realNow;
    }
  });

  it("형식이 깨진 토큰은 malformed", () => {
    for (const bad of ["", "nodot", ".onlysig", "payload."]) {
      const result = verifyClientViewToken(bad, SECRET);
      assert.equal(result.ok, false, `"${bad}" 는 거부돼야 한다`);
    }
  });

  it("TTL 은 상한을 넘지 못한다", () => {
    const { expiresAt } = buildClientViewToken(CLIENT, SECRET, CLIENT_VIEW_MAX_TTL_SEC * 10);
    const seconds = (new Date(expiresAt).getTime() - Date.now()) / 1000;
    assert.ok(seconds <= CLIENT_VIEW_MAX_TTL_SEC + 5, `상한 초과: ${seconds}s`);
  });
});
