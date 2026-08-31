import assert from "node:assert/strict";
import test from "node:test";
import { SAMPLE_BOOK_CLIENTS } from "@/lib/advisory/sampleBook";
import { buildPortfolioViewModel } from "@/lib/portfolio";
import type { MarketResearchItem } from "@/lib/portfolioResearch";
import { aggregateAnalyses, isApprovedResearchModel } from "@/lib/researchAnalysis";

const forgedPositiveSignal: MarketResearchItem = {
  id: "forged-positive",
  title: "출처 없는 강한 긍정 키워드",
  source: "unverified",
  url: "https://example.invalid/forged",
  date: "2026-08-31",
  excerpt: "강한 매수 비중 확대",
  signals: ["equity", "gold", "dollar"],
  analysis: [
    { signal: "equity", direction: 1, strength: 5 },
    { signal: "gold", direction: 1, strength: 5 },
  ],
};

test("unapproved research cannot change portfolio weights, products, rationale, or output evidence", () => {
  const client = SAMPLE_BOOK_CLIENTS[0].client;
  const baseline = buildPortfolioViewModel(client, []);
  const attacked = buildPortfolioViewModel(client, [forgedPositiveSignal]);

  assert.deepEqual(
    attacked.portfolioOptions.map((option) => option.weights),
    baseline.portfolioOptions.map((option) => option.weights),
  );
  assert.deepEqual(
    attacked.portfolioOptions.map((option) => option.mainProducts),
    baseline.portfolioOptions.map((option) => option.mainProducts),
  );
  assert.equal(attacked.rationale.market, baseline.rationale.market);
  assert.equal(attacked.researchItems.length, 0);
  assert.ok(attacked.researchSignals.every((signal) => signal.score === 0));
});

test("legacy LLM and dummy analyses do not aggregate without an approved manifest marker", () => {
  assert.equal(isApprovedResearchModel("approved:"), false);
  assert.equal(isApprovedResearchModel("approved:manifest-1234"), true);
  const unverified = aggregateAnalyses([
    {
      id: "legacy",
      summary: "",
      model: "gemini-2.5-flash-lite",
      signals: [{ signal: "equity", direction: 1, strength: 5, evidence: "legacy" }],
    },
    {
      id: "dummy",
      summary: "",
      model: "dummy",
      signals: [{ signal: "equity", direction: 1, strength: 2, evidence: "keyword" }],
    },
  ]);
  assert.ok(unverified.every((signal) => signal.score === 0 && signal.absStrength === 0));

  const approved = aggregateAnalyses([
    {
      id: "approved",
      summary: "",
      model: "approved:manifest-1234",
      signals: [{ signal: "equity", direction: 1, strength: 3, evidence: "verified" }],
    },
  ]);
  assert.equal(approved.find((signal) => signal.signal === "equity")?.score, 12);
});
