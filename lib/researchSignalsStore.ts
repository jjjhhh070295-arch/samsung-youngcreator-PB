// 리서치 분석 결과 캐시 (Supabase research_signals)
// 테이블/키 없으면 조용히 비캐시로 동작(매번 분석). 있으면 새 리포트만 분석.

import { supabase } from "./supabase";
import type { MarketResearchItem } from "./portfolioResearch";
import type { ReportAnalysis } from "./researchAnalysis";

export async function getCachedAnalyses(ids: string[]): Promise<Map<string, ReportAnalysis>> {
  const map = new Map<string, ReportAnalysis>();
  if (!supabase || ids.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("research_signals")
      .select("report_id, summary, signals, model")
      .in("report_id", ids);
    if (error) return map;
    for (const row of data ?? []) {
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
