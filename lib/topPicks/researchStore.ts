import { supabase } from "@/lib/supabase";
import { chunkResearchText, cleanResearchText, embedResearchChunks, extractResearch, researchContentHash, type ResearchDocumentInput, type StockExtraction } from "./researchPipeline";

export async function ingestCanonicalResearch(input: ResearchDocumentInput, db = supabase) {
  if (!db) throw new Error("Supabase 미설정");
  const cleanedText = cleanResearchText(input.rawText);
  const contentHash = researchContentHash(input, cleanedText);
  const isStock = input.documentType === "STOCK";
  const table = isStock ? "stock_research" : "market_research";
  const { data: duplicate, error: duplicateError } = await db.from("research_documents").select("id").eq("content_hash", contentHash).maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) {
    const { data: existingExtraction, error: extractionLookupError } = await db.from(table).select("id").eq("document_id", duplicate.id).maybeSingle();
    if (extractionLookupError) throw extractionLookupError;
    if (existingExtraction) return { duplicate: true, repaired: false, documentId: duplicate.id, chunkCount: 0, embeddingStatus: "cached" };
  }
  let document = duplicate;
  if (!document) {
    const inserted = await db.from("research_documents").insert({ source_report_id: input.reportId ?? null,
      source: input.source, broker: input.broker ?? null, analyst: input.analyst ?? null, published_at: input.publishedAt,
      title: input.title, document_type: input.documentType, raw_text: input.rawText, cleaned_text: cleanedText,
      source_url: input.sourceUrl ?? null, content_hash: contentHash }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "문서 저장 실패");
    document = inserted.data;
  }
  const extraction = await extractResearch({ ...input, reportId: input.reportId ?? contentHash });
  const stock = extraction.value as StockExtraction;
  const row = isStock
    ? { document_id: document.id, report_id: stock.reportId, ticker: stock.ticker, company_name: stock.companyName,
      market: stock.market, sector: stock.sector, rating: stock.rating, previous_rating: stock.previousRating,
      rating_change: stock.ratingChange, target_price: stock.targetPrice, previous_target_price: stock.previousTargetPrice,
      target_price_change_pct: stock.targetPriceChangePct, eps_revision_pct: stock.epsRevisionPct,
      earnings_revision_direction: stock.earningsRevisionDirection, earnings_revision_details: stock.earningsRevisionDetails,
      sentiment_score: stock.sentimentScore, investment_thesis: stock.investmentThesis,
      investment_points: stock.investmentPoints, catalysts: stock.catalysts, risk_factors: stock.riskFactors,
      themes: stock.themes, analyst_stance: stock.analystStance, catalyst_specificity: stock.catalystSpecificity,
      risk_level: stock.riskLevel, extraction_confidence: stock.confidence, published_at: stock.publishedAt,
      extraction_model: extraction.model }
    : { document_id: document.id, ...(Object.fromEntries(Object.entries(extraction.value).map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]))), extraction_model: extraction.model };
  const { error: extractionError } = await db.from(table).upsert(row as any, { onConflict: "document_id" });
  if (extractionError) throw extractionError;
  const chunks = chunkResearchText(cleanedText);
  let embeddingStatus = "skipped-no-key";
  if (process.env.GEMINI_API_KEY?.trim() && chunks.length) {
    const embeddings = await embedResearchChunks(chunks);
    const { error: chunkError } = await db.from("research_chunks").upsert(chunks.map((content, chunkIndex) => ({ document_id: document.id, chunk_index: chunkIndex, content, embedding: embeddings[chunkIndex], ticker: isStock ? stock.ticker : null, published_at: input.publishedAt })), { onConflict: "document_id,chunk_index" });
    if (chunkError) throw chunkError;
    embeddingStatus = "embedded";
  } else if (chunks.length) {
    const { error: chunkError } = await db.from("research_chunks").upsert(chunks.map((content, chunkIndex) => ({ document_id: document.id, chunk_index: chunkIndex, content, embedding: null, ticker: isStock ? stock.ticker : null, published_at: input.publishedAt })), { onConflict: "document_id,chunk_index" });
    if (chunkError) throw chunkError;
  }
  return { duplicate: false, repaired: Boolean(duplicate), documentId: document.id, extraction, chunkCount: chunks.length, embeddingStatus };
}
