import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMarketIntelligencePrompt, mergeResearchInputs, selectResearchInputs, usableSavedResearch,
  RESEARCH_INTELLIGENCE_VERSION, type SavedResearchAnalysis } from "./researchInputs";
import { buildMarketBrief, prepareResearchInputs, explainResearchPicks } from "./marketIntelligence";
import type { MarketResearchItem } from "../portfolioResearch";
import type { MarketBriefContext } from "./researchAggregation";
import type { SelectedTopPick } from "./types";

const now = new Date("2026-09-10T03:00:00Z");
const report: SavedResearchAnalysis = {
  report_id: "saved-report", title: "반도체 시장 점검", source: "네이버 금융 시황 리포트 · 신한투자증권",
  url: "https://example.com/report.pdf", date: "2026-09-09", summary: "금리와 반도체 이익 전망을 함께 점검한 분석",
  signals: [{ signal: "equity", direction: 1, strength: 3, evidence: "이익 전망 상향" }], model: "existing-model",
};
const crawled: MarketResearchItem = { id: "crawl-report", title: report.title, source: "신한투자증권 리서치", broker: "신한투자증권",
  url: "https://broker.example/report.pdf", date: report.date!, signals: ["equity"] };
const context: MarketBriefContext = {
  asOf: now.toISOString(),
  dataWindow: { asOf: "2026-09-10", start: "2026-09-09", end: "2026-09-10", businessDays: 2, fallbackStage: "PREVIOUS_BUSINESS_DAY" },
  clusters: [{ id: "semiconductor_earnings", label: "반도체 이익 모멘텀", uniqueBrokerCount: 1, positiveCount: 1,
    negativeCount: 0, mixedCount: 0, freshness: 0.7, supportingReportIds: ["saved-report"], supportingBrokers: ["신한투자증권"],
    drivers: ["이익 전망 상향"], risks: ["금리"] }],
  sectors: [{ rank: 1, theme: "SEMICONDUCTOR", themeCode: "SEMICONDUCTOR", themeKo: "반도체", canonicalSector: "SEMICONDUCTOR",
    direction: "BULLISH", score: 82.5, reason: "규칙 점수", catalysts: ["이익 전망 상향"], risks: ["금리"],
    supportingBrokers: ["신한투자증권"], supportingReportIds: ["saved-report"] }],
};
const output = () => ({ stance: "POSITIVE", headline: "리서치 기반 시장 판단", marketSummary: "반도체 이익 전망을 확인합니다.",
  timeline: { twoWeeks: "근거 부족", threeDays: "이익 전망 상향", today: "오늘 근거 부족" },
  keyIssues: [{ clusterId: "semiconductor_earnings", title: "반도체", summary: "이익 전망 검토", whatChanged: "이익 전망 변화",
    marketImpact: "선별 관점", watchPoint: "후속 리포트 확인" }],
  sectorNarratives: [{ sectorCode: "SEMICONDUCTOR", reason: "이익 전망 상향과 구체적 촉매가 확인됨" }],
  watchPoints: ["후속 리포트"], assetView: { equity: "선별", bond: "근거 부족", usd: "근거 부족", oil: "근거 부족" } });
function inputs() { return mergeResearchInputs({ crawled: [crawled], saved: [report], now }); }

describe("리서치 전용 Market Intelligence 입력·생성", () => {
  it("정상 분석만 사용하고 dummy 요약은 제외한다", () => {
    assert.equal(usableSavedResearch([report, { ...report, model: "dummy" }]).length, 1);
    assert.deepEqual(mergeResearchInputs({ crawled: [], saved: [{ ...report, model: "dummy" }], now }), []);
  });

  it("크롤러와 리서치 탭의 동일 보고서를 합치고 모든 추적 ID를 보존한다", () => {
    const [merged] = inputs();
    assert.equal(inputs().length, 1);
    assert.equal(merged.summary, report.summary);
    assert.deepEqual(merged.origins, ["research-tab", "crawler"]);
    assert.deepEqual(merged.sourceDocumentIds, ["saved-report", "crawl-report"]);
  });

  it("URL 중복을 제거하고 날짜가 다른 새 보고서는 유지한다", () => {
    const rows = mergeResearchInputs({ saved: [report], crawled: [
      { ...crawled, title: "다른 제목", url: report.url },
      { ...crawled, id: "next-day", date: "2026-09-10", url: "https://broker.example/next.pdf" },
    ], now });
    assert.equal(rows.length, 2);
  });

  it("입력 상한 안에서 크롤러와 리서치 탭 자료가 모두 남는다", () => {
    const rows = mergeResearchInputs({ crawled: Array.from({ length: 40 }, (_, index) =>
      ({ ...crawled, id: `crawl-${index}`, title: `크롤링 ${index}`, url: `https://example.com/c/${index}` })),
      saved: [{ ...report, title: "별도의 탭 리서치" }], now });
    const selected = selectResearchInputs(rows);
    assert.equal(selected.length, 30);
    assert.ok(selected.some((row) => row.id === report.report_id));
  });

  it("중복 제거 뒤 본문은 한 번만 읽되 최종 프롬프트에는 집계 결과만 보낸다", async () => {
    let reads = 0;
    const prepared = await prepareResearchInputs({ crawled: [crawled, crawled], saved: [report], canonical: [], now },
      async () => { reads++; return "보고서 원문 발췌 ".repeat(30); });
    assert.equal(reads, 1);
    const prompt = buildMarketIntelligencePrompt({ tradeDate: "2026-09-10", aggregate: context });
    assert.match(prompt, /semiconductor_earnings/);
    assert.doesNotMatch(prompt, /보고서 원문 발췌|morningBrief|daily_reports/);
    assert.ok(prepared.reports[0].body.length > 100);
  });

  it("빈 리서치 입력에서는 모델을 호출하지 않는다", async () => {
    let called = false;
    await assert.rejects(buildMarketBrief([], "2026-09-10", async () => { called = true; return { value: {}, model: "test" }; }));
    assert.equal(called, false);
  });

  it("서버 집계의 출처·섹터 순위·점수는 Gemini 응답으로 바뀌지 않는다", async () => {
    const result = await buildMarketBrief(inputs(), "2026-09-10", async (prompt) => {
      assert.match(prompt, /집계 결과/);
      assert.doesNotMatch(prompt, /금리와 반도체 이익 전망을 함께 점검한 분석/);
      return { model: "test-model", value: output() };
    }, context);
    assert.equal(result.value.keyIssues[0].url, report.url);
    assert.deepEqual(result.value.keyIssues[0].supportingReportIds, ["saved-report"]);
    assert.equal(result.value.themes[0].themeKo, "반도체");
    assert.equal(result.value.themes[0].score, 82.5);
    assert.equal(result.model, RESEARCH_INTELLIGENCE_VERSION + ":test-model");
  });

  it("잘못된 구조 결과는 한 번 재시도한다", async () => {
    let calls = 0;
    const result = await buildMarketBrief(inputs(), "2026-09-10", async () => {
      calls++;
      return { model: "test", value: calls === 1 ? { ...output(), headline: "" } : output() };
    }, context);
    assert.equal(calls, 2);
    assert.equal(result.value.headline, output().headline);
  });

  it("집계에 없는 클러스터는 재시도 후에도 게시하지 않는다", async () => {
    let calls = 0;
    await assert.rejects(buildMarketBrief(inputs(), "2026-09-10", async () => {
      calls++;
      return { model: "test", value: { ...output(), keyIssues: [{ ...output().keyIssues[0], clusterId: "invented" }] } };
    }, context));
    assert.equal(calls, 2);
  });

  it("선정되지 않은 종목 설명을 모델이 추가하면 재시도 후 거부한다", async () => {
    const pick = { ticker: "005930", company: "삼성전자", rank: 1, totalScore: 80, confidenceScore: 70,
      breakdown: { research: {} } } as SelectedTopPick;
    let calls = 0;
    await assert.rejects(explainResearchPicks([pick], new Map(), async () => {
      calls++;
      return { model: "test", value: { explanations: [{ ticker: "000660", summary: "임의 종목", keyReasons: [], risks: [] }] } };
    }));
    assert.equal(calls, 2);
    assert.equal(pick.rank, 1);
    assert.equal(pick.totalScore, 80);
  });
});
