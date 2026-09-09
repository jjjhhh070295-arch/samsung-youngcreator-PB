import { NextResponse } from "next/server";
import type { MarketResearchItem } from "@/lib/portfolioResearch";
import { analyzeReport, aggregateAnalyses, type ReportAnalysis } from "@/lib/researchAnalysis";
import { getCachedAnalyses, putCachedAnalysis } from "@/lib/researchSignalsStore";
import { fetchReportContent } from "@/lib/reportContent";
import { supabase } from "@/lib/supabase";
import { ingestCanonicalResearch } from "@/lib/topPicks/researchStore";
import { extractResearchBatch, type ResearchDocumentInput, type ResearchDocumentType } from "@/lib/topPicks/researchPipeline";
import { filterPendingCanonicalItems, selectCanonicalIngestBatch, type StoredCanonicalDocument } from "@/lib/topPicks/canonicalIngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    // 첫 실행에서도 Top Pick 10종목을 만들 수 있도록 종목 슬롯을 15개 확보한다.
    // 실패·중립 의견·동일 종목 중복이 있어도 충분한 후보 풀이 남도록 총 20건을 처리한다.
    const canonicalBatch = selectCanonicalIngestBatch(pendingCanonical, 20);
    const canonicalResults: Array<{ status: string; reportId: string; title: string; error?: string }> = [];
    if (canCanonicalIngest) {
      const prepared = await mapWithConcurrency(canonicalBatch, 4, async (item) => {
        const rawText = await contentFor(item.url);
        const minimumLength = item.documentType === "STOCK" ? 60 : 100;
        if (rawText.trim().length < minimumLength) {
          canonicalResults.push({ status: "skipped-empty", reportId: item.id, title: item.title });
          return null;
        }
        return { item, input: { reportId: item.id, source: item.source,
          broker: item.broker ?? item.source.split(" · ").at(-1) ?? null, analyst: item.analyst ?? null,
          publishedAt: item.date!, title: item.title, documentType: item.documentType as ResearchDocumentType,
          rawText, sourceUrl: item.url } satisfies ResearchDocumentInput };
      });
      const valid = prepared.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const groups = [
        valid.filter(({ input }) => input.documentType === "STOCK"),
        valid.filter(({ input }) => input.documentType !== "STOCK"),
      ];
      // Gemini 호출량을 줄이기 위해 같은 스키마의 보고서를 5개씩 한 번에 구조화한다.
      for (const group of groups) for (let start = 0; start < group.length; start += 5) {
        const batch = group.slice(start, start + 5);
        const extractions = await extractResearchBatch(batch.map(({ input }) => input));
        for (const extraction of extractions) {
          const matched = batch.find(({ input }) => input === extraction.input)!;
          if (!extraction.result) {
            canonicalResults.push({ status: "failed", reportId: matched.item.id, title: matched.item.title,
              error: extraction.error ?? "구조화 결과 없음" });
            continue;
          }
          try {
            const result = await ingestCanonicalResearch(matched.input, supabase!, extraction.result);
            canonicalResults.push({ status: result.duplicate ? "cached" : result.repaired ? "repaired" : "ingested",
              reportId: matched.item.id, title: matched.item.title });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn("[research canonical]", { report_id: matched.item.id, broker: matched.item.broker ?? matched.item.source,
              error: message, attempt: 2, timestamp: new Date().toISOString() });
            canonicalResults.push({ status: "failed", reportId: matched.item.id, title: matched.item.title, error: message });
          }
        }
      }
    }

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
