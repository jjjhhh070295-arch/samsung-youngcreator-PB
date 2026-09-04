// GET /api/briefing/list — 지난 모닝 브리핑 리포트 목록(날짜순, 최신 먼저)
//
// 고객 데이터는 없지만 1건당 $1 가까이 드는 생성물이고, 예전에는 주석에
// "PB 화면에서만 호출된다"고만 적어 둔 채 코드 가드가 없어 URL 만 알면 누구나
// 전량을 읽을 수 있었다. isKnownPbRequest 로 최소한의 문턱을 둔다 —
// 한계는 lib/pbRequestAuth.ts 주석 참고(진짜 인가가 아니다).

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isKnownPbRequest } from "@/lib/pbRequestAuth";

const MISSING_TABLE_ERROR_CODES = new Set(["42P01", "PGRST205"]);

export async function GET(req: Request) {
  if (!(await isKnownPbRequest(req))) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", error: "Unauthorized" }, { status: 401 });
  }

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
