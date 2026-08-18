import { NextResponse } from "next/server";
import type { Client } from "@/lib/types";
import { applyCalcSnapshot, emptyBundle } from "@/lib/advisory/control";
import { buildEngineSnapshot } from "@/lib/advisory/snapshot";
import { sampleBlockedBundle, sampleSuccessBundle } from "@/lib/advisory/sampleRuns";
import { evaluateGoldSet } from "@/lib/advisory/goldSet";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { client?: Client };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  if (!body.client?.id) {
    return NextResponse.json({ ok: false, error: "client가 필요합니다." }, { status: 400 });
  }
  const snap = buildEngineSnapshot(body.client);
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
