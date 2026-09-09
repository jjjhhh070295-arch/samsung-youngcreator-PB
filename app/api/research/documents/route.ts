import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import type { ResearchDocumentInput } from "@/lib/topPicks/researchPipeline";
import { ingestCanonicalResearch } from "@/lib/topPicks/researchStore";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase 미설정" }, { status: 503 });
  const input = await request.json().catch(() => null) as ResearchDocumentInput | null;
  if (!input || !["STOCK","MARKET","INDUSTRY","MACRO"].includes(input.documentType) || !input.source || !input.title || !input.publishedAt || !input.rawText) {
    return NextResponse.json({ ok: false, error: "필수 리서치 필드가 없습니다." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await ingestCanonicalResearch(input)) });
  } catch (pipelineError: any) {
    return NextResponse.json({ ok: false, error: pipelineError?.message ?? "추출 파이프라인 실패" }, { status: 500 });
  }
}
