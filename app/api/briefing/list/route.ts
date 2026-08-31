// GET /api/briefing/list — 지난 모닝 브리핑 리포트 목록(날짜순, 최신 먼저)
//
// 시장 공통 리포트 조회일 뿐 고객 데이터가 없어 발송 트리거(cronAuth)만큼
// 엄격한 보호가 필요하지 않다 — PB 화면(로그인 뒤)에서만 호출된다.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const MISSING_TABLE_ERROR_CODES = new Set(["42P01", "PGRST205"]);

export async function GET() {
  if (!supabase) {
    return NextResponse.json({ ok: false, code: "NO_DB", error: "Supabase가 설정되지 않았습니다." }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("daily_reports")
    .select(
      "id, report_date, headline, html_body, text_body, sources, model, input_tokens, output_tokens, web_search_count, cost_usd, duration_sec, generated_at, status",
    )
    .order("report_date", { ascending: false })
    .limit(60);

  if (error) {
    if (MISSING_TABLE_ERROR_CODES.has((error as any).code)) {
      return NextResponse.json({ ok: true, reports: [], tableMissing: true });
    }
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", error: error.message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, reports: data ?? [] });
}
