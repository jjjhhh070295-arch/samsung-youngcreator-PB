import { NextRequest, NextResponse } from "next/server";
import { buildRecommendResult } from "@/lib/advisory/recommend";
import { applyJudge, attachCitations, emptyBundle, judgeRecommend, sha256Hex, stableStringify } from "@/lib/advisory/control";
import { advisoryInputPayload } from "@/lib/advisory/integrity";
import { listAuthorizedResearchClients } from "@/lib/auth/pbAccess.server";
import {
  PB_SESSION_COOKIE,
  PbSessionConfigurationError,
  verifyPbSessionToken,
} from "@/lib/auth/session.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

function privateJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    // 브라우저의 localStorage·헤더·고객 객체보다 서명된 HttpOnly 세션을 먼저 검증합니다.
    const session = verifyPbSessionToken(req.cookies.get(PB_SESSION_COOKIE)?.value);
    if (!session) {
      return privateJson(
        { ok: false, code: "PB_SESSION_REQUIRED", error: "PB 로그인이 필요합니다." },
        401,
      );
    }

    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return privateJson({ ok: false, code: "INVALID_JSON", error: "JSON이 필요합니다." }, 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return privateJson(
        { ok: false, code: "CLIENT_ID_REQUIRED", error: "clientId가 필요합니다." },
        400,
      );
    }

    const body = parsed as Record<string, unknown>;
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    if (!clientId || clientId.length > 128) {
      return privateJson(
        { ok: false, code: "CLIENT_ID_REQUIRED", error: "clientId가 필요합니다." },
        400,
      );
    }
    if (body.constraintText !== undefined && typeof body.constraintText !== "string") {
      return privateJson(
        { ok: false, code: "INVALID_CONSTRAINT", error: "추가 조건 형식이 올바르지 않습니다." },
        400,
      );
    }
    const constraintText = typeof body.constraintText === "string" ? body.constraintText : "";
    if (constraintText.length > 4_000) {
      return privateJson(
        { ok: false, code: "INVALID_CONSTRAINT", error: "추가 조건은 4,000자 이하여야 합니다." },
        400,
      );
    }

    // 서버 데이터 원본에서 현재 PB에게 허용된 고객만 찾습니다. 요청에 섞인 client 객체는 읽지 않습니다.
    const authorizedClients = await listAuthorizedResearchClients(session.pbId);
    const client = authorizedClients.find((candidate) => candidate.id === clientId);
    if (!client) {
      return privateJson(
        { ok: false, code: "CLIENT_NOT_AUTHORIZED", error: "허용되지 않은 고객입니다." },
        404,
      );
    }

    const asOf = new Date().toISOString();
    const result = buildRecommendResult(client, constraintText, asOf);
    const judge = judgeRecommend(result);
    const inputHash = await sha256Hex(
      stableStringify({
        client: advisoryInputPayload(client, { assignedPbDisplay: session.pbName }),
        constraintText,
      }),
    );
    const outputHash = await sha256Hex(stableStringify(result));

    let bundle = emptyBundle(client.id);
    bundle = {
      ...bundle,
      inputHash,
      outputHash,
      runs: [
        {
          id: `run-${Date.now().toString(36)}`,
          at: asOf,
          kind: "recommend",
          engine: "deterministic-catalog",
          inputHash,
          outputHash,
          notes: `A/B/C 추천 산출 · 제약 ${result.constraints.tags.join(", ") || "없음"}`,
        },
      ],
    };
    if (result.citations?.length) {
      bundle = attachCitations(bundle, result.citations);
    }
    if (bundle.status !== "blocked") {
      bundle = applyJudge(bundle, judge, "engine");
    }

    const failedFindings = judge.findings.filter((finding) => finding.severity === "fail");
    if (!judge.passed || bundle.citation?.passed === false) {
      const reason = failedFindings[0]?.message || bundle.citation?.message || "추천 근거 검증 실패";
      return privateJson(
        {
          ok: false,
          error: `고객 제안 차단: ${reason}`,
          judge,
          bundle,
        },
        422,
      );
    }

    return privateJson(
      {
        ok: true,
        result,
        judge,
        bundle,
      },
      200,
    );
  } catch (error) {
    if (error instanceof PbSessionConfigurationError) {
      return privateJson(
        {
          ok: false,
          code: "PB_SESSION_CONFIGURATION_UNAVAILABLE",
          error: "PB 세션 보안키가 설정되지 않았습니다.",
        },
        503,
      );
    }
    return privateJson(
      {
        ok: false,
        code: "RECOMMENDATION_CONTEXT_UNAVAILABLE",
        error: "상품추천 고객 문맥을 확인하지 못했습니다.",
      },
      503,
    );
  }
}
