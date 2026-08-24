import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { aggregateAnalyses, type ReportAnalysis } from "@/lib/researchAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 화면용 읽기 전용 — 캐시(research_signals)에 저장된 리포트별 분석을 빠르게 반환.
// (LLM 호출 없음. 분석은 /api/research/ingest 가 미리 채워둠)
export async function GET() {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 미설정", reports: [], aggregated: [] });
  }
  try {
    const { data, error } = await supabase
      .from("research_signals")
      .select("report_id, title, source, url, date, summary, signals, model, analyzed_at")
      .order("date", { ascending: false })
      .limit(120); // 캐시는 누적되므로 지난 주 리포트도 목록에 남도록 넉넉히
    if (error) throw error;

    const reports = (data ?? [])
      .map((r) => ({
        id: r.report_id,
        title: r.title,
        source: r.source,
        url: r.url,
        date: r.date,
        summary: r.summary ?? "",
        signals: (r.signals ?? []) as ReportAnalysis["signals"],
        model: r.model,
        analyzedAt: r.analyzed_at,
      }))
      // 본문 추출 실패 등으로 신호를 하나도 못 뽑은 리포트(표·차트 only 등)는 목록에서 제외
      .filter((r) => r.signals.length > 0);

    const aggregated = aggregateAnalyses(
      reports.map((r) => ({ id: r.id, summary: r.summary, signals: r.signals, model: r.model })),
    );

    return NextResponse.json({
      ok: true,
      count: reports.length,
      lastAnalyzedAt: reports[0]?.analyzedAt ?? null,
      aggregated,
      reports,
    });
  } catch (e: any) {
    console.error("[/api/research/signals]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "조회 실패", reports: [], aggregated: [] });
  }
}
