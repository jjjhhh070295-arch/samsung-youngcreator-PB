// 고객 공유 링크 — 발급(POST)과 조회(GET).
//
// POST /api/client-view   { clientId, pbId, ttlSec? } → { url, expiresAt }
//   PB 화면의 "고객 링크 생성" 버튼이 부른다. 서명은 서버에서만 한다 —
//   CLIENT_VIEW_SECRET 이 브라우저로 나가면 누구나 아무 고객의 링크를 만들 수 있다.
//
// GET  /api/client-view?t=<token> → ClientViewPayload
//   화면 렌더는 app/view/[token]/page.tsx 가 서버에서 직접 조립하므로 이 GET 을 타지
//   않는다. 토큰 경로를 코드 배포 없이 확인하고, 나중에 클라이언트에서 갱신이 필요해질
//   때를 위해 열어 둔다.
//
// ⚠️ 발급 인가의 한계 — 1차에서는 완전하지 않다.
//    pbId 는 서명 없는 localStorage 세션에서 오고, parties 는 아직 anon 으로 읽힌다
//    (2차 대상). 즉 작정한 사람은 clientId·pbId 를 알아내 링크를 만들 수 있다.
//    토큰이 막는 것은 "링크를 받은 고객이 다른 고객 화면을 여는 것"이지
//    "공격자가 링크를 만드는 것"이 아니다. 후자는 서버 세션이 있어야 닫힌다.

import { NextResponse } from "next/server";
import {
  buildClientViewToken,
  clientViewSecret,
  CLIENT_VIEW_DEFAULT_TTL_SEC,
  verifyClientViewToken,
} from "@/lib/clientView/token";
import { assertClientBelongsToPb, loadClientViewPayload } from "@/lib/clientView/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

/** 메일 링크와 같은 우선순위(lib/briefing/email.ts 의 resolvePublicBaseUrl). */
function resolveBaseUrl(req: Request): string {
  const explicit =
    process.env.BRIEFING_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const secret = clientViewSecret();
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_CLIENT_VIEW_SECRET",
        error:
          "CLIENT_VIEW_SECRET 이 설정되지 않아 고객 링크를 만들 수 없습니다. 수신거부·크론 시크릿으로 대체하지 않습니다.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: { clientId?: string; pbId?: string; ttlSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "JSON 본문이 필요합니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  const clientId = body.clientId?.trim() ?? "";
  const pbId = body.pbId?.trim() ?? "";
  if (!clientId || !pbId) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "clientId 와 pbId 가 필요합니다." },
      { status: 400, headers: NO_STORE },
    );
  }

  const owns = await assertClientBelongsToPb(clientId, pbId);
  if (!owns.ok) {
    const status = owns.code === "NO_SERVER_DB" ? 503 : owns.code === "FORBIDDEN" ? 403 : 404;
    return NextResponse.json(
      { ok: false, code: owns.code, error: owns.error },
      { status, headers: NO_STORE },
    );
  }

  const { token, expiresAt } = buildClientViewToken(
    clientId,
    secret,
    typeof body.ttlSec === "number" ? body.ttlSec : CLIENT_VIEW_DEFAULT_TTL_SEC,
  );

  return NextResponse.json(
    { ok: true, url: `${resolveBaseUrl(req)}/view/${token}`, token, expiresAt },
    { headers: NO_STORE },
  );
}

export async function GET(req: Request) {
  const secret = clientViewSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, code: "NO_CLIENT_VIEW_SECRET", error: "서버에 CLIENT_VIEW_SECRET 이 없습니다." },
      { status: 503, headers: NO_STORE },
    );
  }

  const token = new URL(req.url).searchParams.get("t")?.trim() ?? "";
  const verified = verifyClientViewToken(token, secret);
  if (!verified.ok) {
    // 만료만 구분해 안내하고, 나머지는 한 덩어리로 묶는다 — 서명 실패와 형식 오류를
    // 나눠 알려 주면 토큰을 맞춰 보는 데 단서가 된다.
    const expired = verified.reason === "expired";
    return NextResponse.json(
      {
        ok: false,
        code: expired ? "EXPIRED" : "INVALID_TOKEN",
        error: expired ? "링크가 만료되었습니다." : "링크가 올바르지 않습니다.",
      },
      { status: expired ? 410 : 401, headers: NO_STORE },
    );
  }

  const loaded = await loadClientViewPayload(verified.clientId, verified.expiresAt);
  if (!loaded.ok) {
    const status = loaded.code === "NOT_FOUND" ? 404 : loaded.code === "NO_SERVER_DB" ? 503 : 500;
    return NextResponse.json(
      { ok: false, code: loaded.code, error: loaded.error },
      { status, headers: NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, payload: loaded.payload }, { headers: NO_STORE });
}
