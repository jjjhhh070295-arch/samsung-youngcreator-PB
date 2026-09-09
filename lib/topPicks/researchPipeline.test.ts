import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkResearchText, cleanResearchText, researchContentHash } from "./researchPipeline";

describe("research ingestion utilities", () => {
  it("normalizes text and creates stable hashes", () => { const input = { source: "A", publishedAt: "2026-09-09", title: "T", documentType: "STOCK" as const, rawText: "a   b\r\n\r\n\r\nc" }; assert.equal(cleanResearchText(input.rawText), "a b\n\nc"); assert.equal(researchContentHash(input), researchContentHash({ ...input })); });
  it("chunks with overlap without losing the end", () => { const text = "x".repeat(5000); const chunks = chunkResearchText(text, 1000, 100); assert.ok(chunks.length > 5); assert.equal(chunks.at(-1)?.at(-1), "x"); });
});
