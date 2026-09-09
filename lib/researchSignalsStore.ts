// 리서치 분석 결과 캐시 (Supabase research_signals)
// 테이블/키 없으면 조용히 비캐시로 동작(매번 분석). 있으면 새 리포트만 분석.

import { supabase } from "./supabase";
import type { MarketResearchItem } from "./portfolioResearch";
import type { ReportAnalysis } from "./researchAnalysis";

export type SavedResearchAnalysis = {
  report_id: string; title: string; source: string; url: string; date: string | null;
  summary: string; signals: ReportAnalysis["signals"]; model: string; analyzed_at?: string;
};

// Shared by the research tab and Market Intelligence so they read the same saved reports.
export async function getSavedResearchReports(db = supabase): Promise<SavedResearchAnalysis[]> {
  if (!db) throw new Error("Supabase 미설정");
  const { data, error } = await db.from("research_signals")
    .select("report_id,title,source,url,date,summary,signals,model,analyzed_at")
    .order("date", { ascending: false }).limit(120);
  if (error) throw error;
  return (data ?? []) as SavedResearchAnalysis[];
}

export async function getCachedAnalyses(ids: string[]): Promise<Map<string, ReportAnalysis>> {
  const map = new Map<string, ReportAnalysis>();
  if (!supabase || ids.length === 0) return map;
  const want = new Set(ids);
  try {
    // 주의: id가 길어(한글 slug ~115자) .in("report_id", ids[30+]) 는 URL 길이 초과로 요청이 실패한다.
    // → 캐시가 항상 비어 매번 전체 재분석되는 버그가 됨. 그래서 최근 행을 넉넉히 받아 JS에서 교집합 필터.
    const { data, error } = await supabase
      .from("research_signals")
      .select("report_id, summary, signals, model")
      .order("analyzed_at", { ascending: false })
      .limit(500);
    if (error) return map;
    for (const row of data ?? []) {
      if (!want.has(row.report_id)) continue;
      map.set(row.report_id, {
        id: row.report_id,
        summary: row.summary ?? "",
        signals: (row.signals ?? []) as ReportAnalysis["signals"],
        model: row.model ?? "cache",
      });
    }
  } catch {
    /* 캐시 없으면 무시 */
  }
  return map;
}

export async function putCachedAnalysis(
  item: MarketResearchItem,
  analysis: ReportAnalysis,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("research_signals").upsert({
      report_id: analysis.id,
      title: item.title,
      source: item.source,
      url: item.url,
      date: item.date ?? null,
      summary: analysis.summary,
      signals: analysis.signals,
      model: analysis.model,
      analyzed_at: new Date().toISOString(),
    });
  } catch {
    /* 저장 실패해도 흐름 유지 */
  }
}
