import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { lookupTicker } from "@/lib/pricing/ticker-map";

export type ResearchDocumentType = "STOCK" | "MARKET" | "INDUSTRY" | "MACRO";

export interface ResearchDocumentInput {
  source: string;
  broker?: string | null;
  analyst?: string | null;
  publishedAt: string;
  title: string;
  documentType: ResearchDocumentType;
  rawText: string;
  sourceUrl?: string | null;
}

export interface StockExtraction {
  ticker: string | null; companyName: string | null; market: string | null; sector: string | null;
  rating: string | null; previousRating: string | null; targetPrice: number | null;
  previousTargetPrice: number | null; epsRevisionPct: number | null; sentimentScore: number | null;
  investmentPoints: string[]; riskFactors: string[]; themes: string[]; publishedAt: string | null;
}

export interface MarketExtraction {
  market: string | null; topic: string | null; sentimentScore: number | null; summary: string | null;
  keyPoints: string[]; affectedSectors: string[]; themes: string[];
}

export function cleanResearchText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function researchContentHash(input: ResearchDocumentInput, cleanedText = cleanResearchText(input.rawText)): string {
  return createHash("sha256").update([input.source, input.title, input.publishedAt, cleanedText].join("\n"), "utf8").digest("hex");
}

export function chunkResearchText(text: string, maxChars = 1800, overlapChars = 200): string[] {
  if (maxChars < 200 || overlapChars < 0 || overlapChars >= maxChars) throw new Error("invalid chunk settings");
  const clean = cleanResearchText(text);
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + maxChars);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf("\n", end), clean.lastIndexOf(". ", end));
      if (boundary > start + Math.floor(maxChars * 0.6)) end = boundary + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlapChars);
  }
  return chunks.filter(Boolean);
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const stringArray = { type: "array", items: { type: "string" } };

const STOCK_SCHEMA = {
  type: "object",
  properties: {
    ticker: nullableString, companyName: nullableString, market: nullableString, sector: nullableString,
    rating: nullableString, previousRating: nullableString, targetPrice: nullableNumber,
    previousTargetPrice: nullableNumber, epsRevisionPct: nullableNumber, sentimentScore: nullableNumber,
    investmentPoints: stringArray, riskFactors: stringArray, themes: stringArray, publishedAt: nullableString,
  },
  required: ["ticker","companyName","market","sector","rating","previousRating","targetPrice","previousTargetPrice","epsRevisionPct","sentimentScore","investmentPoints","riskFactors","themes","publishedAt"],
};

const MARKET_SCHEMA = {
  type: "object",
  properties: { market: nullableString, topic: nullableString, sentimentScore: nullableNumber, summary: nullableString, keyPoints: stringArray, affectedSectors: stringArray, themes: stringArray },
  required: ["market","topic","sentimentScore","summary","keyPoints","affectedSectors","themes"],
};

function promptFor(input: ResearchDocumentInput): string {
  return `증권 리서치를 구조화하라. 원문에 없는 값은 추측하지 말고 null로 둔다. 배열도 원문 근거만 담는다. sentimentScore는 -1~1이다.\n제목: ${input.title}\n발행일: ${input.publishedAt}\n출처: ${input.source}\n원문:\n${cleanResearchText(input.rawText).slice(0, 60_000)}`;
}

async function geminiStructured(prompt: string, schema: object): Promise<{ value: unknown; model: string }> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  if (!response.ok) throw new Error(`Gemini extraction failed (${response.status})`);
  const text = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("Gemini structured output missing");
  return { value: JSON.parse(text), model };
}

async function claudeStructured(prompt: string, schema: object): Promise<{ value: unknown; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const model = process.env.ANTHROPIC_EXTRACTION_MODEL?.trim() || "claude-sonnet-4-6";
  const message = await new Anthropic({ apiKey: key }).messages.create({
    model, max_tokens: 3000, temperature: 0, messages: [{ role: "user", content: prompt }],
    tools: [{ name: "save_extraction", description: "Save only facts supported by the research document.", input_schema: schema as any }],
    tool_choice: { type: "tool", name: "save_extraction" },
  });
  const block = message.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("Claude structured output missing");
  return { value: block.input, model };
}

export async function generateStructured(prompt: string, schema: object) {
  const preferred = process.env.TOP_PICKS_LLM_PROVIDER?.trim().toLowerCase();
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  // 기존 모닝 브리핑과 같은 Claude 키가 있으면 기본적으로 Claude의 tool schema를
  // 사용한다. Gemini를 명시하면 기존 무료 분석 경로를 우선하고 Claude가 폴백한다.
  if (preferred === "claude" || (!preferred && hasClaude)) {
    try { return await claudeStructured(prompt, schema); }
    catch (claudeError) {
      if (!process.env.GEMINI_API_KEY?.trim()) throw claudeError;
      return geminiStructured(prompt, schema);
    }
  }
  try { return await geminiStructured(prompt, schema); }
  catch (geminiError) {
    if (!hasClaude) throw geminiError;
    return claudeStructured(prompt, schema);
  }
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 500)) : [];
const textOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

export async function extractResearch(input: ResearchDocumentInput): Promise<{ value: StockExtraction | MarketExtraction; model: string }> {
  const stock = input.documentType === "STOCK";
  const result = await generateStructured(promptFor(input), stock ? STOCK_SCHEMA : MARKET_SCHEMA);
  const raw = (result.value ?? {}) as Record<string, unknown>;
  if (!stock) return { model: result.model, value: { market: textOrNull(raw.market), topic: textOrNull(raw.topic), sentimentScore: numberOrNull(raw.sentimentScore), summary: textOrNull(raw.summary), keyPoints: strings(raw.keyPoints), affectedSectors: strings(raw.affectedSectors), themes: strings(raw.themes) } };
  const companyName = textOrNull(raw.companyName);
  const mappedTicker = companyName ? lookupTicker(companyName) : null;
  const proposedTicker = textOrNull(raw.ticker);
  const ticker = mappedTicker ?? (proposedTicker && (/^\d{6}$/.test(proposedTicker) || /^[A-Z][A-Z0-9.-]{0,9}$/.test(proposedTicker)) ? proposedTicker : null);
  return { model: result.model, value: { ticker, companyName, market: textOrNull(raw.market), sector: textOrNull(raw.sector), rating: textOrNull(raw.rating), previousRating: textOrNull(raw.previousRating), targetPrice: numberOrNull(raw.targetPrice), previousTargetPrice: numberOrNull(raw.previousTargetPrice), epsRevisionPct: numberOrNull(raw.epsRevisionPct), sentimentScore: numberOrNull(raw.sentimentScore), investmentPoints: strings(raw.investmentPoints), riskFactors: strings(raw.riskFactors), themes: strings(raw.themes), publishedAt: textOrNull(raw.publishedAt) } };
}

export async function embedResearchChunks(chunks: string[]): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is required for embeddings");
  const model = process.env.GEMINI_EMBEDDING_MODEL?.trim() || "text-embedding-004";
  return Promise.all(chunks.map(async (content) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: content }] }, outputDimensionality: 768 }) });
    if (!response.ok) throw new Error(`Embedding failed (${response.status})`);
    const values = (await response.json())?.embedding?.values;
    if (!Array.isArray(values) || values.length !== 768) throw new Error("Invalid embedding dimension");
    return values.map(Number);
  }));
}
