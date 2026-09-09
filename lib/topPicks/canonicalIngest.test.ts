import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterPendingCanonicalItems, selectCanonicalIngestBatch } from "./canonicalIngest";
import type { MarketResearchItem } from "../portfolioResearch";

const item = (id: string, documentType: MarketResearchItem["documentType"], source: string): MarketResearchItem =>
  ({ id, title: id, url: `https://example.com/${id}`, date: "2026-09-10", source, signals: [], documentType });

describe("canonical research ingest scheduling", () => {
  it("reserves stock capacity and rotates sources", () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => item(`a-${i}`, "STOCK", "증권사A · 기업")),
      ...Array.from({ length: 3 }, (_, i) => item(`b-${i}`, "STOCK", "증권사B · 기업")),
      ...Array.from({ length: 5 }, (_, i) => item(`m-${i}`, "MARKET", "증권사C · 시장")),
    ];
    const selected = selectCanonicalIngestBatch(rows, 8);
    assert.equal(selected.length, 8);
    assert.equal(selected.filter((row) => row.documentType === "STOCK").length, 6);
    assert.ok(selected.slice(0, 2).some((row) => row.source.startsWith("증권사B")));
  });

  it("문서는 있으나 추출 행이 없으면 재처리하고 완성된 문서는 제외한다", () => {
    const rows = [item("stock", "STOCK", "A"), item("market", "MARKET", "B")];
    const documents = [
      { id: "stock-doc", source_url: rows[0].url, document_type: "STOCK" as const },
      { id: "market-doc", source_url: rows[1].url, document_type: "MARKET" as const },
    ];
    const pending = filterPendingCanonicalItems(rows, documents, [], ["market-doc"]);
    assert.deepEqual(pending.map((row) => row.id), ["stock"]);
  });
});
