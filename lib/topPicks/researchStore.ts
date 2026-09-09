import { supabase } from "@/lib/supabase";
import { chunkResearchText, cleanResearchText, embedResearchChunks, extractResearch, researchContentHash, type ResearchDocumentInput, type StockExtraction } from "./researchPipeline";

export async function ingestCanonicalResearch(input: ResearchDocumentInput) {
  if (!supabase) throw new Error("Supabase 미설정");
  const cleanedText = cleanResearchText(input.rawText);
  const contentHash = researchContentHash(input, cleanedText);
  const { data: duplicate } = await supabase.from("research_documents").select("id").eq("content_hash", contentHash).maybeSingle();
  if (duplicate) return { duplicate: true, documentId: duplicate.id, chunkCount: 0, embeddingStatus: "cached" };
  const { data: document, error } = await supabase.from("research_documents").insert({ source: input.source, broker: input.broker ?? null, analyst: input.analyst ?? null, published_at: input.publishedAt, title: input.title, document_type: input.documentType, raw_text: input.rawText, cleaned_text: cleanedText, source_url: input.sourceUrl ?? null, content_hash: contentHash }).select("id").single();
  if (error || !document) throw new Error(error?.message ?? "문서 저장 실패");
  const extraction = await extractResearch(input);
  const isStock = input.documentType === "STOCK";
  const stock = extraction.value as StockExtraction;
  const table = isStock ? "stock_research" : "market_research";
  const row = isStock
    ? { document_id: document.id, ticker: stock.ticker, company_name: stock.companyName, market: stock.market, sector: stock.sector, rating: stock.rating, previous_rating: stock.previousRating, target_price: stock.targetPrice, previous_target_price: stock.previousTargetPrice, eps_revision_pct: stock.epsRevisionPct, sentiment_score: stock.sentimentScore, investment_points: stock.investmentPoints, risk_factors: stock.riskFactors, themes: stock.themes, published_at: stock.publishedAt ?? input.publishedAt, extraction_model: extraction.model }
    : { document_id: document.id, ...(Object.fromEntries(Object.entries(extraction.value).map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]))), extraction_model: extraction.model };
  const { error: extractionError } = await supabase.from(table).insert(row as any);
  if (extractionError) throw extractionError;
  const chunks = chunkResearchText(cleanedText);
  let embeddingStatus = "skipped-no-key";
  if (process.env.GEMINI_API_KEY?.trim() && chunks.length) {
    const embeddings = await embedResearchChunks(chunks);
    const { error: chunkError } = await supabase.from("research_chunks").insert(chunks.map((content, chunkIndex) => ({ document_id: document.id, chunk_index: chunkIndex, content, embedding: embeddings[chunkIndex], ticker: isStock ? stock.ticker : null, published_at: input.publishedAt })));
    if (chunkError) throw chunkError;
    embeddingStatus = "embedded";
  } else if (chunks.length) {
    const { error: chunkError } = await supabase.from("research_chunks").insert(chunks.map((content, chunkIndex) => ({ document_id: document.id, chunk_index: chunkIndex, content, embedding: null, ticker: isStock ? stock.ticker : null, published_at: input.publishedAt })));
    if (chunkError) throw chunkError;
  }
  return { duplicate: false, documentId: document.id, extraction, chunkCount: chunks.length, embeddingStatus };
}
