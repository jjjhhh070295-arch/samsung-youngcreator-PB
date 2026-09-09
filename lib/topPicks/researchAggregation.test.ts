import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupStockResearch, scoreResearchCandidate, selectMarketResearchWindow, selectResearchTopPicks, selectStockResearchWindow,
  type ResearchDataWindow, type ResearchRankedPick, type StockResearchFact } from "./researchAggregation";

const asOf = "2026-09-10";
const window: ResearchDataWindow = { asOf, start: asOf, end: asOf, businessDays: 1, fallbackStage: "TODAY" };

function fact(overrides: Partial<StockResearchFact> = {}): StockResearchFact {
  return {
    document_id: overrides.report_id ?? "doc-1", report_id: "report-1", ticker: "005930", company_name: "삼성전자",
    market: "KR", sector: "SEMICONDUCTOR", rating: "BUY", previous_rating: "HOLD", rating_change: "UPGRADE",
    target_price: 110000, previous_target_price: 90000, target_price_change_pct: 22.2,
    earnings_revision_direction: "UP", earnings_revision_details: "이익 전망 상향", investment_thesis: "HBM 매출 확대",
    catalysts: ["3분기 HBM 공급 확대"], risk_factors: ["메모리 가격 하락"], themes: ["SEMICONDUCTOR"],
    analyst_stance: "POSITIVE", catalyst_specificity: "HIGH", risk_level: "LOW", extraction_confidence: 0.9,
    published_at: `${asOf}T08:00:00+09:00`,
    research_documents: { id: overrides.document_id ?? "doc-1", source_report_id: overrides.report_id ?? "report-1",
      source: "리서치", broker: "증권사A", title: "기업 분석", published_at: `${asOf}T08:00:00+09:00` },
    ...overrides,
  };
}

function scored(row: StockResearchFact, currentPrice = 80000) {
  const group = groupStockResearch([row])[0];
  return scoreResearchCandidate(group, { dataWindow: window, bullishSectorCodes: ["SEMICONDUCTOR"], currentPrice });
}

describe("리서치 기반 Top Pick 규칙", () => {
  it("한 종목·한 증권사도 충분한 최신 상향 근거가 있으면 후보가 된다", () => {
    const pick = scored(fact());
    assert.ok(pick);
    assert.equal(pick.brokerCount, 1);
    assert.equal(pick.supportingReportIds[0], "report-1");
  });

  it("여러 증권사의 같은 종목 의견은 합치고 같은 증권사는 최신 의견만 반영한다", () => {
    const rows = [
      fact({ report_id: "old-a", published_at: "2026-09-09T08:00:00+09:00" }),
      fact({ report_id: "new-a", target_price: 120000 }),
      fact({ report_id: "b", research_documents: { source_report_id: "b", broker: "증권사B", title: "분석", source: "리서치", published_at: `${asOf}T07:00:00+09:00` } }),
    ];
    const group = groupStockResearch(rows)[0];
    assert.equal(group.reports.length, 2);
    assert.deepEqual(new Set(group.supportingBrokers), new Set(["증권사A", "증권사B"]));
    assert.ok(group.supportingReportIds.includes("new-a"));
    assert.ok(!group.supportingReportIds.includes("old-a"));
  });

  it("동일 report_id 중복은 한 번만 집계한다", () => {
    const rows = [fact(), fact({ document_id: "copy", report_id: "report-1" })];
    assert.equal(groupStockResearch(rows)[0].reports.length, 1);
  });

  it("목표가 상향은 점수를 더하고 목표가 하향은 가점을 주지 않는다", () => {
    const up = scored(fact())!;
    const down = scored(fact({ target_price: 80000, previous_target_price: 100000, target_price_change_pct: -20 }))!;
    assert.equal(up.breakdown.research.targetPriceRevision, 15);
    assert.equal(down.breakdown.research.targetPriceRevision, 0);
    assert.ok(up.totalScore > down.totalScore);
  });

  it("실적 전망 상향은 15점을 반영한다", () => {
    assert.equal(scored(fact())!.breakdown.research.earningsRevision, 15);
  });

  it("SELL 또는 긍정 근거가 없는 HOLD는 제외한다", () => {
    assert.equal(scored(fact({ rating: "SELL", analyst_stance: "NEGATIVE" })), null);
    assert.equal(scored(fact({ rating: "HOLD", analyst_stance: "NEUTRAL" })), null);
  });

  it("등급이 없어도 구체적 촉매와 긍정 논리가 있으면 후보가 될 수 있다", () => {
    const pick = scored(fact({ rating: null, previous_rating: null, rating_change: "UNKNOWN" }));
    assert.ok(pick);
  });

  it("오늘 후보가 부족하면 전 영업일, 그래도 부족하면 최근 3영업일까지 넓힌다", () => {
    const today = fact({ ticker: "005930", report_id: "today" });
    const prior = fact({ ticker: "000660", company_name: "SK하이닉스", report_id: "prior",
      published_at: "2026-09-09T08:00:00+09:00", research_documents: { source_report_id: "prior", broker: "증권사B",
        title: "분석", source: "리서치", published_at: "2026-09-09T08:00:00+09:00" } });
    const twoDays = fact({ ticker: "035420", company_name: "NAVER", report_id: "two-days",
      published_at: "2026-09-08T08:00:00+09:00", research_documents: { source_report_id: "two-days", broker: "증권사C",
        title: "분석", source: "리서치", published_at: "2026-09-08T08:00:00+09:00" } });
    assert.equal(selectStockResearchWindow([today, prior], asOf, 2).dataWindow.fallbackStage, "PREVIOUS_BUSINESS_DAY");
    assert.equal(selectStockResearchWindow([today, prior, twoDays], asOf, 3).dataWindow.fallbackStage, "LAST_3_BUSINESS_DAYS");
  });

  it("최근 3영업일에도 10개가 없으면 실제 최근 리서치까지 확장한다", () => {
    const recent = Array.from({ length: 10 }, (_, index) => {
      const date = index < 3 ? ["2026-09-10", "2026-09-09", "2026-09-08"][index]
        : ["2026-09-07", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01", "2026-08-31", "2026-08-28"][index - 3];
      return fact({ ticker: String(100000 + index), company_name: `종목${index}`, report_id: `recent-${index}`,
        published_at: `${date}T08:00:00+09:00`, research_documents: { source_report_id: `recent-${index}`,
          broker: `증권사${index}`, source: "리서치", published_at: `${date}T08:00:00+09:00` } });
    });
    const selected = selectStockResearchWindow(recent, asOf, 10);
    assert.equal(selected.dataWindow.fallbackStage, "RECENT_RESEARCH");
    assert.equal(groupStockResearch(selected.rows).length, 10);
  });

  it("확장 기간에서는 오래된 긍정 리서치도 10개 후보 풀에 남길 수 있다", () => {
    const oldWindow: ResearchDataWindow = { asOf, start: "2026-08-28", end: asOf,
      businessDays: 10, fallbackStage: "RECENT_RESEARCH" };
    const row = fact({ published_at: "2026-08-28T08:00:00+09:00", target_price: null,
      previous_target_price: null, target_price_change_pct: null, earnings_revision_direction: "UNKNOWN",
      earnings_revision_details: null, sector: null });
    const group = groupStockResearch([row])[0];
    assert.equal(scoreResearchCandidate(group, { dataWindow: oldWindow, currentPrice: null }), null);
    assert.ok(scoreResearchCandidate(group, { dataWindow: oldWindow, currentPrice: null, minimumScore: 0 }));
  });

  it("시장 자료도 종목 자료와 독립적으로 전 영업일까지 폴백한다", () => {
    const selected = selectMarketResearchWindow([{ report_id: "market-1", published_at: "2026-09-09T08:00:00+09:00",
      topic: "반도체 전망", research_documents: { source_report_id: "market-1", broker: "증권사A" } }], asOf);
    assert.equal(selected.dataWindow.fallbackStage, "PREVIOUS_BUSINESS_DAY");
    assert.equal(selected.rows.length, 1);
  });

  it("10개를 넘지 않고 섹터당 3개를 우선 적용하며 후보가 부족하면 제한을 완화한다", () => {
    const candidates = Array.from({ length: 12 }, (_, index) => {
      const sector = index < 8 ? "SEMICONDUCTOR" : "FINANCIALS";
      const pick = scored(fact({ ticker: String(100000 + index), company_name: `종목${index}`, report_id: `r-${index}`,
        sector, target_price_change_pct: 25 - index, research_documents: { source_report_id: `r-${index}`, broker: `증권사${index}`,
          title: "분석", source: "리서치", published_at: `${asOf}T08:00:00+09:00` } }))!;
      return { ...pick, totalScore: 100 - index } as ResearchRankedPick;
    });
    const selected = selectResearchTopPicks(candidates);
    assert.equal(selected.length, 10);
    assert.equal(selected.filter((pick) => pick.sector === "SEMICONDUCTOR").length, 7);
    assert.deepEqual(selected.map((pick) => pick.rank), [1,2,3,4,5,6,7,8,9,10]);
  });

  it("유효 후보가 10개 미만이면 허위 종목을 채우지 않는다", () => {
    const picks = selectResearchTopPicks([scored(fact())!]);
    assert.equal(picks.length, 1);
  });
});
