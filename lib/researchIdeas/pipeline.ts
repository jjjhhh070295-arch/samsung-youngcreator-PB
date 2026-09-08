import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { collectDocument, type CollectionGrant } from "./collector";
import { extractIdeas, type EntityKind, type ExtractResult } from "./extract";
import { extractMiraeTopPicks, MIRAE_TOP_PICKS_FORMAT, type MiraeExtraction, type MiraeLayout } from "./providers/miraeTopPicks";
export type DocumentPage = { page: number; text: string };
export type CollectedBody = { contentType: "pdf" | "html"; bytes: Uint8Array };
export type DocumentDecoder = (body: CollectedBody) => Promise<DocumentPage[]>;

function htmlText(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\s*(?:br\b[^>]*|\/(?:p|div|h[1-6]|li|tr|table))\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&([a-z]+|#\d+|#x[0-9a-f]+);/gi, (all, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? all;
      const value = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : " ";
    }).replace(/[ \t]+/g, " ");
}
/** Text only; no HTML execution/rendering, images, OCR, URL expansion or document actions. */
export const decodeDocument: DocumentDecoder = async ({ contentType, bytes }) => {
  if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) throw new Error("document_size");
  if (contentType === "html") {
    const text = htmlText(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (text.length > 200000) throw new Error("text_size");
    return [{ page: 1, text }]; // HTML page=1 is a logical document, not a PDF page citation.
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("pdf_signature");
  const document = await getDocumentProxy(bytes.slice(), {
    isEvalSupported: false, useSystemFonts: false, disableFontFace: true,
    useWorkerFetch: false, disableAutoFetch: true, verbosity: 0,
  });
  try {
    if (document.numPages > 100) throw new Error("page_limit");
    const pages: DocumentPage[] = [];
    let count = 0;
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      let text = "";
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        if (text.length + count > 200000) throw new Error("text_limit");
      }
      count += text.length;
      pages.push({ page, text });
    }
    return pages;
  } finally { await document.destroy(); }
};

export type IngestionResult =
  | { status: "withheld" | "failed"; reason: string }
  | { status: "review_required"; sourceUrl: string; sourceHash: string; fetchedAt: string; format: "pdf" | "html"; extraction: ExtractResult };

/**
 * Server-only collection -> original-byte hash -> page-aware decode -> candidate extraction.
 * There is intentionally no public API/cron/AI call, approval mutation, or customer output.
 * Untrusted documents still require an isolated parser/scanner before any production exposure.
 */
export async function collectIdeas(
  input: { url: string; grant: CollectionGrant; now: string; kind: EntityKind },
  transport: typeof fetch,
  decoder: DocumentDecoder = decodeDocument,
): Promise<IngestionResult> {
  const collected = await collectDocument(input, transport);
  if (collected.status !== "collected") return collected;
  const sourceHash = createHash("sha256").update(collected.bytes).digest("hex");
  try {
    const pages = await decoder(collected);
    const extraction = extractIdeas(pages, input.kind);
    if (extraction.status === "invalid_input") return { status: "failed", reason: "invalid_extracted_document" };
    extraction.warnings.push(collected.contentType === "html"
      ? "HTML 기본 텍스트 추출입니다. 숨김 내용·화면 가시성·선정 범위를 검증하지 않았으며 page=1은 논리 문서 번호입니다."
      : "PDF 기본 텍스트 추출입니다. 표의 행·열·범례 및 파서 격리를 검증 완료한 결과가 아닙니다.");
    return { status: "review_required", sourceUrl: collected.sourceUrl, sourceHash, fetchedAt: collected.fetchedAt, format: collected.contentType, extraction };
  } catch { return { status: "failed", reason: "document_decode_failed" }; }
}

export type SyntheticMiraeInput = {
  mode: "synthetic";
  /** In-memory invented source only, not a fetched PDF or an uploaded document. */
  fixtureBytes: Uint8Array;
  /** Separately authored fixture expectations, not derived from layout.document. */
  expectedDocument: Omit<MiraeLayout["document"], "sourceHash" | "origin" | "sourceUrl">;
  layout: unknown;
};
export type SyntheticMiraeResult = { mode: "synthetic"; publishable: false } & (
  | { status: "withheld"; reasons: string[] }
  | { status: "review_required"; sourceHash: string; extraction: MiraeExtraction }
);
const syntheticRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const withholdSynthetic = (...reasons: string[]): SyntheticMiraeResult =>
  ({ mode: "synthetic", publishable: false, status: "withheld", reasons });

/** Copy bounded plain data without executing getters; validation and extraction
 * must observe the very same values, even when the caller supplies a live object. */
function snapshotSyntheticData(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  let nodes = 0, characters = 0;
  const copy = (item: unknown, depth: number): unknown => {
    if (++nodes > 50000 || depth > 12) throw new Error("fixture_shape_limit");
    if (typeof item === "string") {
      characters += item.length;
      if (item.length > 2000 || characters > 1024 * 1024) throw new Error("fixture_text_limit");
      return item;
    }
    if (item === null || item === undefined || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item !== "object" || ancestors.has(item)) throw new Error("fixture_not_plain_data");
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("fixture_not_plain_data");
    const keys = Reflect.ownKeys(item);
    if (keys.length > (array ? 501 : 64) || keys.some(key => typeof key !== "string")) throw new Error("fixture_shape_limit");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (keys.some(key => !("value" in descriptors[key as string]))) throw new Error("fixture_accessor_not_allowed");
    ancestors.add(item);
    let result: unknown;
    if (array) {
      if (item.length > 500) throw new Error("fixture_shape_limit");
      result = Array.from({ length: item.length }, (_, index) => copy(descriptors[String(index)]?.value, depth + 1));
    } else {
      const record: Record<string, unknown> = Object.create(null);
      for (const key of keys as string[]) record[key] = copy(descriptors[key].value, depth + 1);
      result = record;
    }
    ancestors.delete(item);
    return Object.freeze(result);
  };
  return copy(value, 0);
}

/**
 * Pure synthetic-layout connection. No transport, decoder, general-text fallback,
 * storage or approval port. Hash equality only checks fixture integrity: it does
 * NOT prove that cells came from a PDF or that the source/rights were verified.
 * Keep the full table evidence instead of coercing it into text-only ExtractResult.
 */
export function runSyntheticMiraeLayout(input: SyntheticMiraeInput): SyntheticMiraeResult {
  try {
    if (!syntheticRecord(input) || input.mode !== "synthetic") return withholdSynthetic("synthetic_mode_required");
    if (!(input.fixtureBytes instanceof Uint8Array) || input.fixtureBytes.byteLength === 0
      || input.fixtureBytes.byteLength > 2 * 1024 * 1024) return withholdSynthetic("invalid_fixture_bytes");
    const layout = snapshotSyntheticData(input.layout), expected = snapshotSyntheticData(input.expectedDocument);
    if (!syntheticRecord(layout) || !syntheticRecord(layout.document) || !syntheticRecord(expected)) {
      return withholdSynthetic("invalid_synthetic_document");
    }
    const document = layout.document;
    if (document.origin !== "synthetic" || document.sourceUrl !== null) return withholdSynthetic("synthetic_origin_required");
    if (layout.format !== MIRAE_TOP_PICKS_FORMAT) return withholdSynthetic("unsupported_format");
    if (typeof document.sourceHash !== "string" || !/^[a-f0-9]{64}$/i.test(document.sourceHash)) {
      return withholdSynthetic("invalid_source_hash");
    }
    const sourceHash = createHash("sha256").update(input.fixtureBytes).digest("hex");
    if (document.sourceHash.toLowerCase() !== sourceHash) return withholdSynthetic("source_hash_mismatch");
    const stringFields = ["providerId", "opinionProviderId", "opinionSubject", "desk", "author", "title", "publicationDate"] as const;
    if (stringFields.some(field => typeof expected[field] !== "string" || !expected[field].trim()
      || document[field] !== expected[field]) || !Number.isSafeInteger(expected.pageCount)
      || typeof expected.pageCount !== "number" || expected.pageCount < 1 || expected.pageCount > 100 || document.pageCount !== expected.pageCount
      || !(expected.scenario === null || (typeof expected.scenario === "string" && Boolean(expected.scenario.trim())))
      || document.scenario !== expected.scenario) return withholdSynthetic("document_metadata_mismatch");
    const actualPeriod = document.targetPeriod, expectedPeriod = expected.targetPeriod;
    if (!syntheticRecord(actualPeriod) || !syntheticRecord(expectedPeriod)) return withholdSynthetic("target_period_missing_or_invalid");
    if ((["label", "start", "end"] as const).some(field => typeof expectedPeriod[field] !== "string"
      || !expectedPeriod[field].trim() || actualPeriod[field] !== expectedPeriod[field])) return withholdSynthetic("target_period_mismatch");
    const extraction = extractMiraeTopPicks(layout);
    if (extraction.status === "withheld" || extraction.status === "invalid_input") return withholdSynthetic(...extraction.reasons);
    // no_explicit_selection remains explicit in extraction; it is not an approved
    // zero-pick recommendation, nor a reason to try the generic text extractor.
    return { mode: "synthetic", publishable: false, status: "review_required", sourceHash, extraction };
  } catch {
    return withholdSynthetic("invalid_synthetic_input");
  }
}
