import { NextResponse } from "next/server";
import {
  RESEARCH_SOURCES,
  WINDOW_DAYS,
} from "@/lib/portfolioResearch";
import { fetchSource, uniqueLatest, uniqueCanonical, documentTypeFor } from "@/lib/researchCrawler";
import { getCachedAnalyses } from "@/lib/researchSignalsStore";

export const dynamic = "force-dynamic";

// WINDOW_DAYS: portfolioResearch에서 import — 크롤·스냅샷·집계가 같은 값 참조

// 자동 분석 쿨다운 — 사이트 로드 때 새 리포트가 있으면 1회만 ingest, 잦은 재실행(토큰 낭비) 방지
const AUTO_INGEST_COOLDOWN_MS = 10 * 60 * 1000;
let lastAutoIngest = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const noauto = url.searchParams.get("noauto") === "1"; // ingest가 부를 때 자동 재트리거 방지

  const settled = await Promise.allSettled(RESEARCH_SOURCES.map((source) => fetchSource(source)));
  const fetched = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const canonicalItems = uniqueCanonical(fetched.map((item) => ({ ...item, documentType: item.documentType ?? documentTypeFor(RESEARCH_SOURCES.find((source) => item.source.startsWith(source.name)) ?? { name: item.source, url: item.url, category: "report" }, item.title) })));
  const marketFetched = canonicalItems.filter((item) => item.documentType !== "STOCK");
  const picked = uniqueLatest(marketFetched);

  // 캐시된 LLM 분석(방향·강도)을 주입 → 포트폴리오 엔진이 방향/강도까지 반영해 가중치 계산.
  // (분석 없는 항목은 그대로 키워드 신호로 동작)
  const cached = await getCachedAnalyses(picked.map((it) => it.id));
  const items = picked.map((it) => {
    const a = cached.get(it.id);
    if (!a || !a.signals?.length) return it;
    return {
      ...it,
      analysis: a.signals.map((s) => ({ signal: s.signal, direction: s.direction, strength: s.strength })),
    };
  });

  // 자동 분석: 분석 안 된(캐시 없는) 리포트가 있으면 ingest를 백그라운드로 1회 실행.
  // 쿨다운(10분)으로 페이지 이동마다 중복 실행 방지 → 토큰 낭비 차단. 새 리포트만 분석되므로 평소엔 비용 0.
  const hasUnanalyzed = picked.some((it) => !cached.has(it.id));
  if (!noauto && hasUnanalyzed && Date.now() - lastAutoIngest > AUTO_INGEST_COOLDOWN_MS) {
    lastAutoIngest = Date.now();
    void fetch(`${url.origin}/api/research/ingest`, { cache: "no-store" }).catch(() => {});
  }

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    sourceCount: RESEARCH_SOURCES.length,
    fetchedCount: fetched.length,
    pickedCount: picked.length, // 윈도우 통과 후 실제 사용 건수
    fallbackUsed: false,
    sources: RESEARCH_SOURCES,
    items,
    canonicalItems,
  });
}
