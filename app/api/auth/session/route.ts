import { NextRequest, NextResponse } from "next/server";
import { authenticatePbCredentials } from "@/lib/auth/pbAccess.server";
import {
  PB_SESSION_COOKIE,
  PB_SESSION_MAX_AGE_SECONDS,
  PbSessionConfigurationError,
  createPbSessionToken,
  verifyPbSessionToken,
} from "@/lib/auth/session.server";

export const dynamic = "force-dynamic";

function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}

function unavailable() {
  return privateJson(
    { ok: false, error: "PB 세션 보안키가 설정되지 않아 로그인을 차단했습니다." },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = verifyPbSessionToken(request.cookies.get(PB_SESSION_COOKIE)?.value);
    if (!session) return privateJson({ ok: false, error: "Unauthorized" }, { status: 401 });
    return privateJson({
      ok: true,
      session: { pbId: session.pbId, pbName: session.pbName, expiresAt: session.expiresAt },
    });
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) return unavailable();
    return privateJson({ ok: false, error: "세션 확인에 실패했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as unknown;
    if (!body || typeof body !== "object") {
      return privateJson({ ok: false, error: "사원번호와 비밀번호가 필요합니다." }, { status: 400 });
    }
    const credentials = body as Record<string, unknown>;
    if (typeof credentials.employeeId !== "string" || typeof credentials.password !== "string") {
      return privateJson({ ok: false, error: "사원번호와 비밀번호가 필요합니다." }, { status: 400 });
    }
    const identity = await authenticatePbCredentials({
      employeeId: credentials.employeeId,
      password: credentials.password,
    });
    if (!identity) {
      return privateJson({ ok: false, error: "사원번호 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }
    const { token, session } = createPbSessionToken(identity);
    const response = privateJson({
      ok: true,
      session: { pbId: session.pbId, pbName: session.pbName, expiresAt: session.expiresAt },
    });
    response.cookies.set(PB_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: PB_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) return unavailable();
    return privateJson({ ok: false, error: "로그인 처리에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE() {
  const response = privateJson({ ok: true });
  response.cookies.set(PB_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
