import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkResearchText, cleanResearchText, extractResearch, researchContentHash } from "./researchPipeline";

describe("research ingestion utilities", () => {
  it("normalizes text and creates stable hashes", () => { const input = { source: "A", publishedAt: "2026-09-09", title: "T", documentType: "STOCK" as const, rawText: "a   b\r\n\r\n\r\nc" }; assert.equal(cleanResearchText(input.rawText), "a b\n\nc"); assert.equal(researchContentHash(input), researchContentHash({ ...input })); });
  it("chunks with overlap without losing the end", () => { const text = "x".repeat(5000); const chunks = chunkResearchText(text, 1000, 100); assert.ok(chunks.length > 5); assert.equal(chunks.at(-1)?.at(-1), "x"); });
  it("retries one malformed structured extraction and preserves server-owned metadata", async () => {
    let attempts = 0;
    const result = await extractResearch({ reportId: "report-7", source: "증권사A", broker: "증권사A", publishedAt: "2026-09-10",
      title: "시장 전망", documentType: "MARKET", rawText: "반도체 이익 증가와 환율 위험을 분석한다." }, async () => {
      attempts++;
      if (attempts === 1) return { model: "test", value: {} };
      return { model: "test", value: { reportId: "invented", broker: "invented", publishedAt: "2030-01-01", reportType: "market",
        market: "KR", topic: "반도체", sentimentScore: 0.4, summary: "이익 증가", marketStance: "BULLISH",
        marketDrivers: ["이익 증가"], positiveFactors: ["이익 증가"], negativeFactors: ["환율"], ratesView: null,
        fxView: "환율 위험", foreignFlowView: null, earningsView: "상향", preferredSectors: ["SEMICONDUCTOR"],
        avoidedSectors: [], keyCatalysts: ["실적 발표"], keyRisks: ["환율"], investmentHorizon: "3개월", confidence: 0.8,
        keyPoints: ["이익 증가"], affectedSectors: ["SEMICONDUCTOR"], themes: ["SEMICONDUCTOR"] } };
    });
    assert.equal(attempts, 2);
    assert.equal(result.value.reportId, "report-7");
    assert.equal(result.value.broker, "증권사A");
    assert.equal(result.value.publishedAt, "2026-09-10");
  });
  it("does not accept a stock code or company identity absent from the report", async () => {
    const result = await extractResearch({ reportId: "stock-1", source: "증권사A", publishedAt: "2026-09-10",
      title: "기업 전망", documentType: "STOCK", rawText: "매출과 영업이익 전망을 검토한다." }, async () => ({ model: "test", value: {
      reportId: "stock-1", broker: "증권사A", publishedAt: "2026-09-10", ticker: "005930", companyName: "삼성전자",
      market: "KR", sector: "SEMICONDUCTOR", rating: "BUY", previousRating: null, targetPrice: null,
      previousTargetPrice: null, epsRevisionPct: null, sentimentScore: 0.5, ratingChange: "MAINTAIN",
      targetPriceChangePct: null, earningsRevisionDirection: "UNKNOWN", earningsRevisionDetails: null,
      investmentThesis: "실적 개선", catalysts: [], riskFactors: [], themes: ["SEMICONDUCTOR"],
      analystStance: "POSITIVE", catalystSpecificity: "NONE", riskLevel: "UNKNOWN", confidence: 0.5, investmentPoints: [],
    } }));
    assert.equal("ticker" in result.value ? result.value.ticker : undefined, null);
  });
});
