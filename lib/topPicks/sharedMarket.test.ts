import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sharedMarketBrief, type SavedResearchAnalysis } from "./sharedMarket";
import { getDashboardHome } from "./repository";

const report: SavedResearchAnalysis = {
  report_id: "naver-shinhan-report", title: "시장 점검", source: "네이버 금융 시황 리포트 · 신한투자증권",
  url: "https://stock.pstatic.net/stock-research/market/1.pdf", date: "2026-09-09",
  summary: "원문에 근거한 저장된 요약", signals: [], model: "cached-model",
};
const morning = { report_date: "2026-09-08", headline: "저장된 모닝 브리핑", text_body: "브리핑 본문", model: "briefing-model", status: "draft" };

function database(results: Record<string, { data: unknown; error: unknown }>) {
  return { from(table: string) {
    const result = results[table] ?? { data: null, error: { code: "42P01" } };
    const query: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ["select", "eq", "neq", "gte", "order", "limit", "maybeSingle"]) query[method] = () => query;
    return query;
  } } as NonNullable<Parameters<typeof getDashboardHome>[0]>;
}

describe("기존 모닝 브리핑과 리서치 분석 재사용", () => {
  it("실제 저장된 요약과 출처를 유지하고 dummy 분석을 표시하지 않는다", () => {
    const brief = sharedMarketBrief(null, [report, { ...report, model: "dummy" }]);
    assert.equal(brief?.summary, report.summary);
    assert.equal(brief?.issues.length, 1);
    assert.equal(brief?.issues[0].url, report.url);
    assert.equal(sharedMarketBrief(null, [{ ...report, model: "dummy" }]), null);
  });

  it("브리핑 날짜·초안을 구분하면서 최신 리서치를 함께 표시한다", () => {
    const brief = sharedMarketBrief(morning, [report]);
    assert.equal(brief?.headline, morning.headline);
    assert.equal(brief?.summary, morning.text_body);
    assert.equal(brief?.date, report.date);
    assert.match(brief!.sourceLabel, /2026-09-08 · 초안/);
  });

  it("Top Picks 테이블이 없어도 기존 모닝 브리핑·리서치를 표시한다", async () => {
    const result = await getDashboardHome(database({
      daily_reports: { data: morning, error: null },
      research_signals: { data: [report], error: null },
    }));
    assert.equal(result.ready, true);
    assert.equal(result.marketBrief?.headline, morning.headline);
    assert.deepEqual(result.topPicks, []);
  });

  it("DB 조회 오류를 분석 대기 상태로 숨기지 않는다", async () => {
    await assert.rejects(getDashboardHome(database({
      daily_reports: { data: null, error: { code: "08006", message: "connection failed" } },
    })), (error: any) => error.code === "08006");
  });

  it("DB 미설정 시 실데이터 대신 예시 분석을 표시하지 않는다", async () => {
    const result = await getDashboardHome(null);
    assert.equal(result.ready, false);
    assert.equal(result.marketBrief, null);
  });
});
