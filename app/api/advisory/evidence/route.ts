import { NextResponse } from "next/server";
import type { Client } from "@/lib/types";
import { applyCalcSnapshot, emptyBundle } from "@/lib/advisory/control";
import { buildEngineSnapshot } from "@/lib/advisory/snapshot";
import { resolveAssetBreakdown } from "@/lib/assets";
import { sampleBlockedBundle, sampleSuccessBundle } from "@/lib/advisory/sampleRuns";
import { evaluateGoldSet } from "@/lib/advisory/goldSet";
import type { AdvisoryInputContext } from "@/lib/advisory/integrity";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { client?: Client; inputContext?: AdvisoryInputContext };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  if (!body.client?.id) {
    return NextResponse.json({ ok: false, error: "client가 필요합니다." }, { status: 400 });
  }
  if (!body.inputContext?.assignedPbDisplay?.trim()) {
    return NextResponse.json(
      { ok: false, error: "PDF 표시 담당 PB 정보가 필요합니다." },
      { status: 400 },
    );
  }
  // 스트레스·세금 원금을 부동산 제외 투자가능자산으로 계산한다. 조회 실패 시 undefined 를
  // 넘겨 총자산 폴백(기존 동작)으로 떨어진다 — 근거 번들 생성 자체를 막지 않는다.
  const breakdown = await resolveAssetBreakdown(body.client.id).catch(() => null);
  const snap = buildEngineSnapshot(body.client, body.inputContext, undefined, breakdown?.investableKrw);
  let bundle = emptyBundle(body.client.id);
  bundle = applyCalcSnapshot(bundle, snap);
  return NextResponse.json({ ok: true, bundle, snap });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    samples: {
      success: sampleSuccessBundle(),
      blocked: sampleBlockedBundle(),
    },
    gold: evaluateGoldSet(),
  });
}
