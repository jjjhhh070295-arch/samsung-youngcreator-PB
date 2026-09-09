// 고객화면 공유 링크 토큰 — PB 계정 없이 고객 본인 화면만 여는 서명 토큰.
//
// 형태:  base64url({v,c,e}) + "." + base64url(HMAC-SHA256(payload, secret))
//
// 수신거부 토큰(lib/briefing/email.ts)과 같은 HMAC 패턴이지만 일부러 분리했다:
//   · 시크릿이 다르다. 같은 키를 쓰면 이미 발송된 메일의 수신거부 링크가 그대로
//     고객화면 열쇠가 된다. CLIENT_VIEW_SECRET 전용이고 폴백을 두지 않는다.
//   · 만료를 서명 안에 넣는다. 수신거부 토큰은 clientId 만 서명하고 만료가 없다.
//     만료를 ?exp= 로 따로 붙이면 받는 쪽이 고쳐 쓸 수 있으므로 payload 에 함께 담는다.
//   · 자르지 않는다. 수신거부는 32 hex 로 자르지만 여기서는 그럴 이유가 없다.
//
// ⚠️ 무상태 토큰이라 발급한 링크 하나만 취소할 수 없다. 유일한 취소 수단은
//    CLIENT_VIEW_SECRET 회전이고 그러면 발급된 링크가 전부 죽는다.
//    링크별 폐기가 필요해지면 발급 이력 테이블이 있어야 한다.

import crypto from "node:crypto";

export const CLIENT_VIEW_TOKEN_VERSION = 1;

/** 기본 24시간 — 상담 당일과 당일 재확인을 덮고, 남은 링크는 다음 날 죽는다. */
export const CLIENT_VIEW_DEFAULT_TTL_SEC = 24 * 60 * 60;
export const CLIENT_VIEW_MAX_TTL_SEC = 7 * 24 * 60 * 60;

/**
 * 전용 시크릿. 폴백 없음 — 없으면 링크 발급도 열람도 하지 않는다.
 * UNSUBSCRIBE_SECRET·CRON_SECRET 으로 폴백하지 않는 이유는 파일 상단 주석 참고.
 */
export function clientViewSecret(): string | null {
  return process.env.CLIENT_VIEW_SECRET?.trim() || null;
}

interface TokenClaims {
  v: number;
  c: string; // clientId
  e: number; // 만료 epoch seconds
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payload: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(payload).digest());
}

export interface IssuedClientViewToken {
  token: string;
  /** 만료 시각(ISO). 화면에 "이 링크는 …까지 유효합니다"로 띄운다. */
  expiresAt: string;
}

export function buildClientViewToken(
  clientId: string,
  secret: string,
  ttlSec: number = CLIENT_VIEW_DEFAULT_TTL_SEC,
): IssuedClientViewToken {
  const ttl = Math.min(Math.max(Math.floor(ttlSec), 60), CLIENT_VIEW_MAX_TTL_SEC);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const claims: TokenClaims = { v: CLIENT_VIEW_TOKEN_VERSION, c: clientId, e: exp };
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return {
    token: `${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export type ClientViewTokenResult =
  | { ok: true; clientId: string; expiresAt: string }
  | { ok: false; reason: "malformed" | "version" | "bad_signature" | "expired" };

/**
 * 검증 순서가 중요하다 — 서명을 먼저 본 다음 만료를 본다.
 * 만료를 먼저 보면 서명이 틀린 토큰의 만료 시각을 신뢰하는 셈이 된다.
 */
export function verifyClientViewToken(token: string, secret: string): ClientViewTokenResult {
  const raw = (token ?? "").trim();
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, reason: "malformed" };

  const payload = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = sign(payload, secret);

  // 길이가 다르면 timingSafeEqual 이 던진다. 먼저 길이를 확인한다
  // (verifyUnsubscribeToken 과 같은 방식).
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let claims: TokenClaims;
  try {
    claims = JSON.parse(fromB64url(payload).toString("utf8")) as TokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims?.v !== CLIENT_VIEW_TOKEN_VERSION) return { ok: false, reason: "version" };
  if (typeof claims.c !== "string" || !claims.c.trim()) return { ok: false, reason: "malformed" };
  if (typeof claims.e !== "number" || !Number.isFinite(claims.e)) {
    return { ok: false, reason: "malformed" };
  }
  if (claims.e * 1000 <= Date.now()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    clientId: claims.c,
    expiresAt: new Date(claims.e * 1000).toISOString(),
  };
}
