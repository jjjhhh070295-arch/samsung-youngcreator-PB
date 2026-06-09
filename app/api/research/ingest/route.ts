import { NextResponse } from "next/server";
import type { MarketResearchItem } from "@/lib/portfolioResearch";
import { analyzeReport, aggregateAnalyses, type ReportAnalysis } from "@/lib/researchAnalysis";
import { getCachedAnalyses, putCachedAnalysis } from "@/lib/researchSignalsStore";
import { fetchReportContent } from "@/lib/reportContent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// 리서치 "내용" 분석 잡:
//  1) 기존 /api/research 에서 최신 리포트 목록을 받아
//  2) 이미 분석된 건 캐시(Supabase)에서 재사용, 새 것만 LLM 분석
//  3) 결과 저장 + 신호 집계 반환
// 무거우므로 화면이 아니라 "갱신" 시에만 호출(버튼/스케줄). 화면은 집계 결과만 읽는다.

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function GET(req: Request) {
  try {
    const origin = new URL(req.url).origin;

    // 1) 최신 리포트 목록 (기존 크롤러 재사용 — 박상혁 엔진 그대로)
    const res = await fetch(`${origin}/api/research`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/api/research ${res.status}`);
    const data = await res.json();
    const items: MarketResearchItem[] = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "분석할 리포트가 없습니다." }, { status: 200 });
    }

    // ?force=1 이면 캐시 무시하고 전체 재분석 (quota 리셋 후 사용)
    const force = new URL(req.url).searchParams.get("force") === "1";

    // 2) 캐시 조회 → 새 것만 분석 (force면 전부)
    const cached = force
      ? new Map<string, ReportAnalysis>()
      : await getCachedAnalyses(items.map((it) => it.id));
    const newItems = items.filter((it) => !cached.has(it.id));

    const freshAnalyses = await mapWithConcurrency(newItems, 2, async (it) => {
      const content = await fetchReportContent(it.url); // 본문(PDF/HTML) 추출
      const a = await analyzeReport(it, content);
      // 결과 캐시(더미 포함 — 구조가 비지 않게). 실제 분석은 ?force=1 로 재분석.
      await putCachedAnalysis(it, a);
      return a;
    });
    const freshById = new Map(freshAnalyses.map((a) => [a.id, a]));

    // 3) 원래 순서(최신순)대로 합치기
    const analyses: ReportAnalysis[] = items
      .map((it) => cached.get(it.id) ?? freshById.get(it.id))
      .filter(Boolean) as ReportAnalysis[];

    const aggregated = aggregateAnalyses(analyses);
    const usedLLM = freshAnalyses.some((a) => a.model !== "dummy");

    return NextResponse.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      total: items.length,
      analyzedNow: newItems.length,
      fromCache: cached.size,
      usedLLM,
      aggregated, // [{signal, score, absStrength}] — 포트폴리오 엔진이 쓸 신호
      analyses, // [{id, summary, signals[]}]
    });
  } catch (e: any) {
    console.error("[/api/research/ingest]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "ingest 실패" },
      { status: 200 },
    );
  }
}
