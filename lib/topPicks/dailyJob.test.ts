import assert from "node:assert/strict";
import { it } from "node:test";
import { runDailyTopPicks } from "./dailyJob";

const date = "2026-09-10";
const document = (id: string, broker: string, title: string) => ({
  id: `doc-${id}`, source_report_id: id, title, source: "리서치", broker,
  published_at: `${date}T08:00:00+09:00`, source_url: `https://example.com/${id}`, cleaned_text: "리서치 본문 ".repeat(30),
});
const stockRow = {
  document_id: "doc-stock", report_id: "stock", ticker: "005930", company_name: "삼성전자", market: "KR",
  sector: "SEMICONDUCTOR", rating: "BUY", previous_rating: "HOLD", rating_change: "UPGRADE",
  target_price: 110000, previous_target_price: 90000, target_price_change_pct: 22.2,
  earnings_revision_direction: "UP", earnings_revision_details: "이익 전망 상향", investment_thesis: "HBM 매출 확대",
  investment_points: ["HBM 매출 확대"], catalysts: ["3분기 공급 확대"], risk_factors: ["가격 하락"], themes: ["SEMICONDUCTOR"],
  analyst_stance: "POSITIVE", catalyst_specificity: "HIGH", risk_level: "LOW", extraction_confidence: 0.9,
  published_at: `${date}T08:00:00+09:00`, extraction_model: "gemini-test",
  research_documents: document("stock", "증권사A", "삼성전자 분석"),
};
const marketRow = {
  document_id: "doc-market", report_id: "market", report_type: "market", market: "KR", topic: "반도체 이익 전망",
  summary: "반도체 이익 전망이 개선됐다.", market_stance: "BULLISH", market_drivers: ["이익 전망 상향"],
  positive_factors: ["수요 증가"], negative_factors: ["환율"], preferred_sectors: ["SEMICONDUCTOR"], avoided_sectors: [],
  key_catalysts: ["실적 발표"], key_risks: ["환율"], key_points: ["이익 증가"], affected_sectors: ["SEMICONDUCTOR"],
  themes: ["SEMICONDUCTOR"], confidence: 0.8, published_at: `${date}T08:00:00+09:00`, extraction_model: "gemini-test",
  research_documents: document("market", "증권사B", "시장 전망"),
};

function database(options: { stock?: any[]; market?: any[]; failBrief?: boolean } = {}) {
  const calls: { table: string; method: string; args: any[] }[] = [];
  const db = { from(table: string) {
    assert.notEqual(table, "daily_reports", "Morning briefing must never be read");
    let operation = "select";
    let single = false;
    const query: any = { then(resolve: any, reject: any) {
      const error = options.failBrief && operation === "upsert" && table === "daily_market_briefs" ? { message: "write failed" } : null;
      let data: any = [];
      if (operation === "select") {
        if (table === "stock_research") data = options.stock ?? [];
        else if (table === "market_research") data = options.market ?? [];
        else if (table === "research_signals") data = [];
        else if (table === "daily_top_picks") data = single ? null : [];
      } else data = null;
      return Promise.resolve({ data, error }).then(resolve, reject);
    } };
    for (const method of ["select", "gte", "lte", "not", "order", "limit", "lt", "eq", "maybeSingle", "update", "upsert"]) {
      query[method] = (...args: any[]) => {
        calls.push({ table, method, args });
        if (["select", "update", "upsert"].includes(method)) operation = method;
        if (method === "maybeSingle") single = true;
        return query;
      };
    }
    return query;
  } } as NonNullable<Parameters<typeof runDailyTopPicks>[1]>["db"];
  return { db, calls };
}

const briefOutput = {
  stance: "POSITIVE", headline: "리서치 통합 판단", marketSummary: "반도체 전망 점검",
  timeline: { twoWeeks: "근거 부족", threeDays: "전망 상향", today: "오늘 리서치 비교" },
  keyIssues: [
    { clusterId: "earnings", title: "실적", summary: "실적 전망", whatChanged: "전망 점검", marketImpact: "선별 관점", watchPoint: "실적 확인" },
    { clusterId: "fx", title: "환율", summary: "환율 위험", whatChanged: "위험 점검", marketImpact: "변동성", watchPoint: "환율 확인" },
    { clusterId: "semiconductor_earnings", title: "반도체", summary: "HBM 전망", whatChanged: "수요 증가", marketImpact: "긍정", watchPoint: "수요 확인" },
  ],
  sectorNarratives: [{ sectorCode: "SEMICONDUCTOR", reason: "실적 전망과 Top Pick 근거가 일치" }],
  watchPoints: ["실적"], assetView: { equity: "선별", bond: "근거 부족", usd: "근거 부족", oil: "근거 부족" },
};

it("daily job scores research deterministically and persists Top Pick, sector theme, and market brief", async () => {
  const { db, calls } = database({ stock: [stockRow], market: [marketRow] });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://app.example/api/market");
      return Response.json({ items: [] });
    };
    const result = await runDailyTopPicks("https://app.example", {
      db, now: new Date("2026-09-10T03:00:00Z"),
      price: async () => ({ lastPrice: 80000, averageTurnover: 2_000_000_000, domestic: true }),
      generate: async (prompt) => prompt.includes("선정이 끝난 Top Pick")
        ? { model: "gemini-test", value: { explanations: [{ ticker: "005930", summary: "HBM 이익 개선",
          keyReasons: ["목표가와 실적 전망 상향"], risks: ["가격 하락"] }] } }
        : { model: "gemini-test", value: briefOutput },
    });
    assert.equal(result.topPickCount, 1);
    assert.equal(result.sectorCount, 1);
    assert.equal(result.marketViewStatus, "generated");
    const pickWrite = calls.find((call) => call.table === "daily_top_picks" && call.method === "upsert")!;
    assert.equal(pickWrite.args[0][0].ticker, "005930");
    assert.deepEqual(pickWrite.args[0][0].source_document_ids, ["stock"]);
    const briefWrite = calls.find((call) => call.table === "daily_market_briefs" && call.method === "upsert")!;
    assert.equal(briefWrite.args[0].model, "research-driven-v2:gemini-test");
    assert.equal(briefWrite.args[0].themes[0].themeCode, "SEMICONDUCTOR");
    assert.equal(briefWrite.args[0].themes[0].themeKo, "반도체");
  } finally { globalThis.fetch = originalFetch; }
});

it("daily job does not call a model or publish fabricated output when research is absent", async () => {
  const { db, calls } = database();
  await assert.rejects(runDailyTopPicks("https://app.example", {
    db, now: new Date("2026-09-10T03:00:00Z"),
    generate: async () => { throw new Error("Model should not run"); },
  }), /리서치가 없습니다/);
  assert.equal(calls.some((call) => call.method === "upsert" || call.method === "update"), false);
});

it("market brief write failure is reported separately after deterministic Top Pick persistence", async () => {
  const { db, calls } = database({ stock: [stockRow], market: [marketRow], failBrief: true });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ items: [] });
    const result = await runDailyTopPicks("https://app.example", {
      db, now: new Date("2026-09-10T03:00:00Z"),
      price: async () => ({ lastPrice: 80000, averageTurnover: 2_000_000_000, domestic: true }),
      generate: async (prompt) => prompt.includes("선정이 끝난 Top Pick")
        ? { model: "test", value: { explanations: [{ ticker: "005930", summary: "요약", keyReasons: [], risks: [] }] } }
        : { model: "test", value: briefOutput },
    });
    assert.equal(result.topPickCount, 1);
    assert.equal(result.marketViewStatus, "failed");
    assert.equal(result.briefError, "write failed");
    assert.ok(calls.some((call) => call.table === "daily_top_picks" && call.method === "upsert"));
  } finally { globalThis.fetch = originalFetch; }
});
