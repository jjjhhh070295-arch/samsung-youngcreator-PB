import type { ReportAnalysis } from "@/lib/researchAnalysis";

export type SavedMorningBrief = {
  report_date?: string;
  headline: string;
  text_body: string;
  sources?: unknown[];
  model: string;
  status?: string;
};

export type SavedResearchAnalysis = {
  report_id: string;
  title: string;
  source: string;
  url: string;
  date: string | null;
  summary: string;
  signals: ReportAnalysis["signals"];
  model: string;
};

export type CanonicalMarketResearch = {
  document_id?: string;
  market?: string | null;
  topic?: string | null;
  sentiment_score?: number | null;
  summary?: string | null;
  key_points?: string[];
  affected_sectors?: string[];
  themes?: string[];
  research_documents?: {
    title?: string;
    source?: string;
    broker?: string | null;
    published_at?: string | null;
    source_url?: string | null;
  } | null;
};

export function usableSavedResearch(rows: SavedResearchAnalysis[]) {
  return rows.filter((row) => row.model && row.model !== "dummy" && row.summary?.trim());
}

// 홈에 원문을 그대로 복사하지 않는다. 이미 생성된 모닝 브리핑과 리서치 탭의
// LLM 분석, canonical 리서치, 시장 지표를 홈 전용 구조로 다시 합성하는 입력이다.
export function buildMarketIntelligencePrompt(input: {
  indicators: unknown[];
  morningBrief: SavedMorningBrief | null;
  researchAnalyses: SavedResearchAnalysis[];
  canonicalResearch: CanonicalMarketResearch[];
}) {
  const research = usableSavedResearch(input.researchAnalyses).slice(0, 30);
  return `PB용 오늘의 Daily AI Market Intelligence를 한국어로 구체적으로 구조화하라.
규칙:
1. 모닝 브리핑을 그대로 복사하거나 단순 요약하지 말고, 모든 입력을 교차해 최근 2주→최근 3일→오늘의 변화로 재구성한다.
2. keyIssues는 최대 3개다. 각 이슈에 무엇이 바뀌었는지, 시장 영향, PB가 다음에 확인할 지표를 쓴다.
3. themes는 업종·투자 테마 단위로 3~6개를 만들고 theme은 영문 표준 코드, score는 -1~1, reason은 한국어로 쓴다.
4. 수치·출처 URL은 입력에 있는 값만 사용한다. 근거가 충돌하면 단정하지 말고 충돌을 명시한다.
5. 과장, 수익 보장, 매수 지시 표현을 금지한다.
6. source/url/date는 해당 keyIssue를 직접 뒷받침하는 리서치 입력에서만 복사하고, 없으면 null로 둔다.

시장 지표:
${JSON.stringify(input.indicators)}

Claude 모닝 브리핑:
${JSON.stringify(input.morningBrief ? {
    date: input.morningBrief.report_date ?? null,
    headline: input.morningBrief.headline,
    text: String(input.morningBrief.text_body ?? "").slice(0, 35_000),
    sources: input.morningBrief.sources ?? [],
    model: input.morningBrief.model,
  } : null)}

리서치 탭에서 크롤링 후 LLM이 분석한 결과:
${JSON.stringify(research)}

canonical 시장·산업·매크로 리서치:
${JSON.stringify(input.canonicalResearch.slice(0, 60))}`;
}
