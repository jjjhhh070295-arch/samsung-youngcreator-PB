import { NextResponse } from "next/server";
import type { MarketResearchItem } from "@/lib/portfolioResearch";
import { analyzeReport, aggregateAnalyses, type ReportAnalysis } from "@/lib/researchAnalysis";
import { getCachedAnalyses, putCachedAnalysis } from "@/lib/researchSignalsStore";
import { fetchReportContentDetailed, type ReportContentResult } from "@/lib/reportContent";
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
    // 본문과 함께 "왜 못 얻었는지"까지 캐시한다 — 아래 canonical 단계가 그 이유를
    // 응답에 싣는다. 같은 URL 을 신호 분석과 canonical 적재가 함께 쓰므로 캐시는 유지한다.
    const contentCache = new Map<string, Promise<ReportContentResult>>();
    const contentFor = (url: string) => {
      const cachedContent = contentCache.get(url);
      if (cachedContent) return cachedContent;
      const pending = fetchReportContentDetailed(url);
      contentCache.set(url, pending);
      return pending;
    };
    const freshAnalyses = await mapWithConcurrency(newItems, 1, async (it) => {
      const content = (await contentFor(it.url)).text; // 본문(PDF/HTML) 추출
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
        const fetched = await contentFor(item.url);
        const rawText = fetched.text;
        // 본문을 못 얻은 이유가 있으면 길이 판정 전에 그대로 드러낸다. 예전에는 전부
        // "skipped-empty" 한 덩어리로 뭉쳐져 텍스트 없는 PDF 인지 로그인 벽인지
        // 구분할 수 없었다.
        if (fetched.skipReason) {
          canonicalResults.push({ status: `skipped-${fetched.skipReason}`, reportId: item.id, title: item.title,
            error: fetched.pdfPages
              ? `PDF ${fetched.pdfPages}페이지에서 ${fetched.pdfChars ?? 0}자만 추출됨 (텍스트 레이어 없음)`
              : undefined });
          return null;
        }
        // 증권사 리포트라면 최소 수천 자다. 예전 문턱(STOCK 60 / MARKET 100)은 "빈 응답"만
        // 걸렀을 뿐 "본문인가"를 판정하지 못했다. 실측된 통과분이 전부 껍데기였다:
        //   84~90자   티저 한 줄 + 컴플라이언스 문구 (흥국증권 상세 페이지)
        //   117~154자 PDF 차트 축 눈금 (미래에셋 — 텍스트 레이어 없음)
        //   525~724자 페이지 네비게이션 + 메타데이터 (한양증권, 본문은 첨부 PDF)
        // 이런 문서가 research_documents 에 저장되고 뒤이은 LLM 추출은 전부 null 을 뱉어,
        // 결과적으로 Gemini 쿼터만 태우고 Top Pick 후보에서 걸러졌다.
        // 문턱을 실질값으로 올려 쓸모없는 입력에 돈을 쓰지 않는다.
        const minimumLength = item.documentType === "STOCK" ? 1500 : 2000;
        if (rawText.trim().length < minimumLength) {
          canonicalResults.push({ status: "skipped-too-short", reportId: item.id, title: item.title,
            error: `본문 ${rawText.trim().length}자 (최소 ${minimumLength}자)` });
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
        // 적재·복구·캐시가 아닌 건 전부 사유와 함께 싣는다. 예전 필터는 "failed"·"skipped-empty" 만 봐서
        // skipped-too-short·skipped-pdf-no-text-layer 는 개수(skippedOrFailed)에만 잡히고 이유가 사라졌다.
        failures: canonicalResults.filter((result) => !["ingested", "repaired", "cached"].includes(result.status)),
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
