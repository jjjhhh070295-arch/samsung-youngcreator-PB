import { NextResponse } from "next/server";
import { buildRecommendResult } from "@/lib/advisory/recommend";
import { applyJudge, attachCitations, emptyBundle, judgeRecommend, sha256Hex, stableStringify } from "@/lib/advisory/control";
import type { Client } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { client?: Client; constraintText?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  if (!body.client?.id) {
    return NextResponse.json({ ok: false, error: "client가 필요합니다." }, { status: 400 });
  }

  const asOf = new Date().toISOString();
  const result = buildRecommendResult(body.client, body.constraintText ?? "", asOf);
  const judge = judgeRecommend(result);
  const inputHash = await sha256Hex(
    stableStringify({
      id: body.client.id,
      constraint: body.constraintText ?? "",
      notes: body.client.consultationNotes,
      ips: body.client.ips,
      cash: body.client.cashFlows,
    }),
  );
  const outputHash = await sha256Hex(stableStringify(result));

  let bundle = emptyBundle(body.client.id);
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
    return NextResponse.json(
      {
        ok: false,
        error: `고객 제안 차단: ${reason}`,
        judge,
        bundle,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    ok: true,
    result,
    judge,
    bundle,
  });
}
