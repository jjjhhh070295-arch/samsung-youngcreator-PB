import { NextRequest, NextResponse } from "next/server";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  verifyPbSessionToken,
} from "@/lib/auth/session.server";
import { loadMacroEvidenceDashboard } from "@/lib/researchCopilot/macroEvidence/macroEvidenceService.server";
import { isMacroDashboardResult } from "@/lib/researchCopilot/macroEvidence/publicValidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    // 인증을 먼저 끝내야 connector 실행과 서버 비밀 조회가 일어나지 않습니다.
    const session = verifyPbSessionToken(request.cookies.get(PB_SESSION_COOKIE)?.value);
    if (!session) {
      return privateJson({ ok: false, code: "PB_SESSION_REQUIRED" }, 401);
    }

    // 서버 전용 바인딩을 이 경계에서만 읽습니다. 값은 응답·로그·오류에 포함하지 않습니다.
    const result = await loadMacroEvidenceDashboard({ ecosCredential: process.env.ECOS_API_KEY });
    if (!isMacroDashboardResult(result)) {
      return privateJson({ ok: false, code: "MACRO_EVIDENCE_VALIDATION_FAILED" }, 503);
    }
    return privateJson(result, 200);
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) {
      return privateJson({ ok: false, code: "PB_SESSION_CONFIGURATION_UNAVAILABLE" }, 503);
    }
    return privateJson({ ok: false, code: "MACRO_EVIDENCE_UNAVAILABLE" }, 503);
  }
}
