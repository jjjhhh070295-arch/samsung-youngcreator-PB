import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMarketIntelligencePrompt, usableSavedResearch, type SavedResearchAnalysis } from "./sharedMarket";
import { getDashboardHome } from "./repository";

const report: SavedResearchAnalysis = {
  report_id: "naver-shinhan-report",
  title: "시장 점검",
  source: "네이버 금융 시황 리포트 · 신한투자증권",
  url: "https://stock.pstatic.net/stock-research/market/1.pdf",
  date: "2026-09-09",
  summary: "금리와 반도체 이익 전망을 함께 점검한 분석",
  signals: [{ signal: "equity", direction: 1, strength: 3, evidence: "이익 전망 상향" }],
  model: "claude-sonnet-4-6",
};

function database(results: Record<string, { data: any; error: any }>) {
  return { from(table: string) {
    const result = results[table] ?? { data: null, error: { code: "42P01" } };
    const query: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "order", "limit", "maybeSingle"]) query[method] = () => query;
    return query;
  } } as NonNullable<Parameters<typeof getDashboardHome>[0]>;
}

describe("Daily AI Market Intelligence 입력과 조회", () => {
  it("리서치 탭의 실제 LLM 분석만 입력으로 사용한다", () => {
    const usable = usableSavedResearch([report, { ...report, report_id: "dummy", model: "dummy" }]);
    assert.deepEqual(usable.map((row) => row.report_id), [report.report_id]);
  });

  it("모닝 브리핑과 크롤링 리서치를 홈 전용 재구성 프롬프트에 함께 넣는다", () => {
    const prompt = buildMarketIntelligencePrompt({
      indicators: [{ label: "KOSPI", value: "2800" }],
      morningBrief: { report_date: "2026-09-09", headline: "모닝 브리핑", text_body: "아침 시장 본문", model: "claude-sonnet-5" },
      researchAnalyses: [report, { ...report, report_id: "dummy", model: "dummy", summary: "표시 금지" }],
      canonicalResearch: [],
    });
    assert.match(prompt, /그대로 복사하거나 단순 요약하지 말고/);
    assert.match(prompt, /아침 시장 본문/);
    assert.match(prompt, /금리와 반도체 이익 전망/);
    assert.doesNotMatch(prompt, /표시 금지/);
  });

  it("LLM이 저장한 구조화 브리프를 상세 홈 구성으로 반환한다", async () => {
    const result = await getDashboardHome(database({
      daily_top_picks: { data: null, error: null },
      daily_market_briefs: { data: {
        trade_date: "2026-09-09",
        headline: "홈 전용 시장 판단",
        market_summary: "교차 분석 결과",
        narrative_timeline: { twoWeeks: "2주", threeDays: "3일", today: "오늘" },
        key_issues: [{ title: "금리", whatChanged: "변화", marketImpact: "영향", watchPoint: "확인" }],
        themes: [{ themeCode: "SEMICONDUCTOR", themeKo: "반도체", score: 0.8 }],
        watch_points: ["미국 10년물"],
        asset_view: { equity: "선별" },
        indicators: [{ label: "KOSPI", value: "2800" }],
        model: "claude-sonnet-4-6",
      }, error: null },
    }));
    assert.equal(result.ready, true);
    assert.equal(result.marketBrief?.headline, "홈 전용 시장 판단");
    assert.equal(result.marketBrief?.timeline?.twoWeeks, "2주");
    assert.equal(result.marketBrief?.themes[0].themeKo, "반도체");
    assert.match(result.marketBrief!.sourceLabel, /LLM 통합 분석/);
  });

  it("DB 조회 오류를 분석 대기 상태로 숨기지 않는다", async () => {
    await assert.rejects(getDashboardHome(database({
      daily_top_picks: { data: null, error: null },
      daily_market_briefs: { data: null, error: { code: "08006", message: "connection failed" } },
    })), (error: any) => error.code === "08006");
  });

  it("DB 미설정 시 실데이터 대신 예시 분석을 표시하지 않는다", async () => {
    const result = await getDashboardHome(null);
    assert.equal(result.ready, false);
    assert.equal(result.marketBrief, null);
  });
});
