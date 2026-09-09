import assert from "node:assert/strict";
import { it } from "node:test";
import { runDailyTopPicks } from "./dailyJob";
import { prepareResearchInputs } from "./marketIntelligence";
import type { SavedResearchAnalysis } from "../researchSignalsStore";

const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const report: SavedResearchAnalysis = {
  report_id: "saved", title: "반도체 전망", source: "신한투자증권", url: "https://example.com/report.pdf",
  date, summary: "반도체 실적 전망과 위험 요인을 점검한 리서치", signals: [], model: "saved-model",
};
function database(saved: SavedResearchAnalysis[], failBrief = false) {
  const calls: { table: string; method: string; args: any[] }[] = [];
  const db = { from(table: string) {
    assert.notEqual(table, "daily_reports", "Morning briefing must never be read");
    let operation = "select";
    const query: any = { then(resolve: any, reject: any) {
      const error = failBrief && table === "daily_market_briefs" ? { message: "write failed" } : null;
      const data = operation !== "select" ? null : table === "research_signals" ? saved : table === "daily_top_picks" ? null : [];
      return Promise.resolve({ data, error }).then(resolve, reject);
    } };
    for (const method of ["select", "gte", "lte", "not", "order", "limit", "lt", "eq", "maybeSingle", "update", "upsert"]) {
      query[method] = (...args: any[]) => {
        calls.push({ table, method, args });
        if (["select", "update", "upsert"].includes(method)) operation = method;
        return query;
      };
    }
    return query;
  } } as NonNullable<Parameters<typeof runDailyTopPicks>[1]>["db"];
  return { db, calls };
}
const output = {
  headline: "리서치 통합 판단", marketSummary: "반도체 전망 점검",
  timeline: { twoWeeks: "기간 근거 부족", threeDays: "기간 근거 부족", today: "오늘 리서치 비교" },
  keyIssues: [{ reportId: "saved", title: "실적", summary: "실적 전망", whatChanged: "전망 점검", marketImpact: "선별 관점", watchPoint: "실적 확인" }],
  themes: [{ theme: "반도체", themeCode: "SEMICONDUCTOR", score: 0.2, reason: "실적 전망" }],
  watchPoints: ["실적"], assetView: { equity: "선별", bond: "근거 부족", usd: "근거 부족", oil: "근거 부족" },
};

it("daily job deduplicates both sources, generates research-only output, and persists the complete home brief", async () => {
  const { db, calls } = database([report]);
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, "https://app.example/api/market");
      return Response.json({ items: [] });
    };
    const result = await runDailyTopPicks("https://app.example", {
      db,
      collect: async () => [{ id: "crawled", title: report.title, source: report.source, url: report.url, date, signals: [] }],
      prepare: (input) => prepareResearchInputs(input, async () => "리서치 원문 ".repeat(30)),
      generate: async (prompt) => {
        modelCalls++;
        assert.match(prompt, /리서치 원문/);
        assert.match(prompt, /반도체 실적 전망과 위험 요인/);
        assert.doesNotMatch(prompt, /morningBrief|daily_reports/);
        return { model: "gemini-test", value: output };
      },
    });
    assert.equal(modelCalls, 1);
    assert.equal(result.researchCount, 1);
    assert.equal(result.topPickCount, 0);
    const reset = calls.find((c) => c.table === "daily_top_picks" && c.method === "update");
    assert.deepEqual(reset?.args[0], { is_dropped: true, rank: null });
    const write = calls.find((c) => c.table === "daily_market_briefs" && c.method === "upsert")!;
    assert.equal(write.args[0].model, "research-only-v1:gemini-test");
    assert.deepEqual(write.args[0].source_document_ids, ["saved", "crawled"]);
    assert.equal(write.args[0].key_issues[0].url, report.url);
    assert.equal(write.args[0].narrative_timeline.today, output.timeline.today);
  } finally { globalThis.fetch = originalFetch; }
});

it("daily job does not call a model or publish fabricated output when research is absent", async () => {
  const { db, calls } = database([]);
  await assert.rejects(runDailyTopPicks("https://app.example", {
    db, collect: async () => [],
    generate: async () => { throw new Error("Model should not run"); },
  }), /리서치가 없습니다/);
  assert.equal(calls.some((c) => c.method === "upsert" || c.method === "update"), false);
});

it("daily job surfaces a failed brief write instead of reporting success", async () => {
  const { db } = database([report], true);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ items: [] });
    await assert.rejects(runDailyTopPicks("https://app.example", {
      db, collect: async () => [], generate: async () => ({ model: "gemini-test", value: output }),
    }), (error: any) => error.message === "write failed");
  } finally { globalThis.fetch = originalFetch; }
});
