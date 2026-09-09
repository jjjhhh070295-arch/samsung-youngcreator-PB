import { NextResponse } from "next/server";
import type { MarketResearchItem } from "@/lib/portfolioResearch";
import { analyzeReport, aggregateAnalyses, type ReportAnalysis } from "@/lib/researchAnalysis";
import { getCachedAnalyses, putCachedAnalysis } from "@/lib/researchSignalsStore";
import { fetchReportContent } from "@/lib/reportContent";
import { supabase } from "@/lib/supabase";
import { ingestCanonicalResearch } from "@/lib/topPicks/researchStore";
import type { ResearchDocumentType } from "@/lib/topPicks/researchPipeline";
import { filterPendingCanonicalItems, selectCanonicalIngestBatch, type StoredCanonicalDocument } from "@/lib/topPicks/canonicalIngest";

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

    // 1) 최신 리포트 목록 (기존 크롤러 재사용). noauto=1 로 research의 자동 재트리거 방지(루프 차단).
    const res = await fetch(`${origin}/api/research?noauto=1`, { cache: "no-store" });
    if (!res.ok) throw new Error(`/api/research ${res.status}`);
    const data = await res.json();
    const items: MarketResearchItem[] = Array.isArray(data.items) ? data.items : [];
    const canonicalItems: MarketResearchItem[] = Array.isArray(data.canonicalItems) ? data.canonicalItems : [];
    if (items.length === 0) {
      return NextResponse.json({ ok: false, error: "분석할 리포트가 없습니다." }, { status: 200 });
    }

    const params = new URL(req.url).searchParams;
    const force = params.get("force") === "1"; // 전체 재분석
    const retryFailed = params.get("retryFailed") === "1"; // 실패(더미)만 재분석

    // 2) 캐시 조회
    //    - force: 캐시 전부 무시(전체 재분석)
    //    - retryFailed: 더미(분석 실패)는 캐시에서 빼서 다시 분석 / 성공분은 유지
    //    - 기본: 캐시에 없는 새 것만
    const allCached = force
      ? new Map<string, ReportAnalysis>()
      : await getCachedAnalyses(items.map((it) => it.id));
    const cached = new Map(allCached);
    if (retryFailed) {
      allCached.forEach((a, id) => {
        if (a.model === "dummy") cached.delete(id); // 더미는 다시 분석 대상으로
      });
    }
    const newItems = items.filter((it) => !cached.has(it.id));

    // 무료 티어 RPM 한도가 낮아 동시 호출을 1로 제한(429 폭주 방지). 느려도 백그라운드 잡이라 OK.
    const contentCache = new Map<string, Promise<string>>();
    const contentFor = (url: string) => {
      const cachedContent = contentCache.get(url);
      if (cachedContent) return cachedContent;
      const pending = fetchReportContent(url);
      contentCache.set(url, pending);
      return pending;
    };
    const freshAnalyses = await mapWithConcurrency(newItems, 1, async (it) => {
      const content = await contentFor(it.url); // 본문(PDF/HTML) 추출
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

    // 기존 리서치 탭 분석과 별도로 canonical research_documents 파이프라인을 채운다.
    // 완료된 문서를 제외한 뒤 종목 리포트 75% 슬롯을 보장하고 증권사별로 순환한다.
    const canCanonicalIngest = Boolean(supabase && process.env.GEMINI_API_KEY?.trim());
    let pendingCanonical = canonicalItems.filter((item) => item.date && item.documentType);
    if (canCanonicalIngest && pendingCanonical.length) {
      const urls = Array.from(new Set(pendingCanonical.map((item) => item.url).filter(Boolean)));
      const documentsResult = await supabase!.from("research_documents").select("id,source_url,document_type").in("source_url", urls);
      if (documentsResult.error) throw documentsResult.error;
      const documents = (documentsResult.data ?? []) as StoredCanonicalDocument[];
      const stockIds = documents.filter((row) => row.document_type === "STOCK").map((row) => row.id);
      const marketIds = documents.filter((row) => row.document_type !== "STOCK").map((row) => row.id);
      const [stockExtractions, marketExtractions] = await Promise.all([
        stockIds.length ? supabase!.from("stock_research").select("document_id").in("document_id", stockIds) : Promise.resolve({ data: [], error: null }),
        marketIds.length ? supabase!.from("market_research").select("document_id").in("document_id", marketIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (stockExtractions.error) throw stockExtractions.error;
      if (marketExtractions.error) throw marketExtractions.error;
      pendingCanonical = filterPendingCanonicalItems(pendingCanonical, documents,
        (stockExtractions.data ?? []).map((row: any) => row.document_id),
        (marketExtractions.data ?? []).map((row: any) => row.document_id));
    }
    const canonicalBatch = selectCanonicalIngestBatch(pendingCanonical, 8);
    const canonicalResults = canCanonicalIngest
      ? await mapWithConcurrency(
          canonicalBatch,
          1,
          async (item) => {
            const rawText = await contentFor(item.url);
            const minimumLength = item.documentType === "STOCK" ? 60 : 100;
            if (rawText.trim().length < minimumLength) return { status: "skipped-empty", reportId: item.id, title: item.title };
            try {
              const result = await ingestCanonicalResearch({ reportId: item.id, source: item.source,
                broker: item.broker ?? item.source.split(" · ").at(-1) ?? null, analyst: item.analyst ?? null,
                publishedAt: item.date!, title: item.title, documentType: item.documentType as ResearchDocumentType,
                rawText, sourceUrl: item.url });
              return { status: result.duplicate ? "cached" : result.repaired ? "repaired" : "ingested", reportId: item.id, title: item.title };
            } catch (error) {
              console.warn("[research canonical]", { report_id: item.id, broker: item.broker ?? item.source,
                error: (error as Error).message, attempt: 2, timestamp: new Date().toISOString() });
              return { status: "failed", reportId: item.id, title: item.title };
            }
          },
        )
      : [];

    return NextResponse.json({
      ok: true,
      updatedAt: new Date().toISOString(),
      total: items.length,
      analyzedNow: newItems.length,
      fromCache: cached.size,
      usedLLM,
      aggregated, // [{signal, score, absStrength}] — 포트폴리오 엔진이 쓸 신호
      analyses, // [{id, summary, signals[]}]
      canonical: {
        available: canonicalItems.length,
        pending: pendingCanonical.length,
        selected: canonicalBatch.length,
        ingested: canonicalResults.filter((result) => ["ingested", "repaired"].includes(result.status)).length,
        repaired: canonicalResults.filter((result) => result.status === "repaired").length,
        cached: canonicalResults.filter((result) => result.status === "cached").length,
        skippedOrFailed: canonicalResults.filter((result) => !["ingested", "repaired", "cached"].includes(result.status)).length,
        failures: canonicalResults.filter((result) => ["failed", "skipped-empty"].includes(result.status)),
      },
    });
  } catch (e: any) {
    console.error("[/api/research/ingest]", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "ingest 실패" },
      { status: 200 },
    );
  }
}
