import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectTopPicks } from "./selection";
import type { ScoredStock } from "./types";

function stock(i: number, sector = `S${i}`, theme = `T${i}`, score = 90 - i): ScoredStock {
  return { ticker: String(i).padStart(6, "0"), company: `C${i}`, market: "KR", sector, themes: [theme], research: [], fundamental: { epsRevisionPct: null, earningsGrowthPct: null, revenueGrowthPct: null, roePct: null, relativeValuationPct: null }, price: { momentum20Pct: null, momentum60Pct: null, relativeStrengthPct: null, drawdownPct: null, volatilityPct: null, historyDays: 250 }, consensus: { buyRatioPct: null, targetUpsidePct: null, epsRevisionPct: null, targetDispersionPct: null }, regimeByTheme: {}, minimumLiquidityMet: true, researchScore: 80, fundamentalScore: 80, priceScore: 80, consensusScore: 80, regimeScore: 80, totalScore: score, confidenceScore: 90, pickType: "CORE", breakdown: { research: {}, fundamental: {}, price: {}, consensus: {}, regime: {}, coverage: {} } };
}

describe("diversified deterministic selection", () => {
  it("caps the same sector at three and the same theme at four", () => { const candidates = Array.from({ length: 16 }, (_, i) => stock(i, i < 8 ? "SEMI" : `S${i}`, i < 7 ? "AI" : `T${i}`)); const picks = selectTopPicks(candidates); assert.equal(picks.filter((p) => p.sector === "SEMI").length, 3); assert.ok(picks.filter((p) => p.themes.includes("AI")).length <= 4); });
  it("excludes low confidence and illiquid names", () => { const low = stock(1); low.confidenceScore = 59; const illiquid = stock(2); illiquid.minimumLiquidityMet = false; assert.deepEqual(selectTopPicks([low, illiquid]), []); });
  it("uses ticker as the stable final tie breaker and computes rank changes", () => { const a = stock(2, "A", "A", 80); const b = stock(1, "B", "B", 80); const picks = selectTopPicks([a, b], new Map([[b.ticker, 4]])); assert.equal(picks[0].ticker, b.ticker); assert.equal(picks[0].rankChange, 3); });
});
