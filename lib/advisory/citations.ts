import { CITATION_REQUIRED_FIELDS } from "./constants";
import type { CitationRef, CitationVerdict } from "./types";

export function isCompleteCitation(c: CitationRef | null | undefined): boolean {
  if (!c) return false;
  return CITATION_REQUIRED_FIELDS.every((field) => {
    const v = c[field];
    return typeof v === "string" && v.trim().length > 0;
  });
}

export function judgeCitations(citations: CitationRef[]): CitationVerdict {
  const incomplete = citations.filter((c) => !isCompleteCitation(c));
  const passed = citations.length > 0 && incomplete.length === 0;
  return {
    passed,
    count: citations.length,
    incompleteIds: incomplete.map((c) => c.sourceId || c.chunkId || "(empty)"),
    message: passed
      ? `인용 ${citations.length}건 메타데이터 통과 (sourceId/title/as-of/chunkId)`
      : citations.length === 0
        ? "출처 메타데이터 없음 — citation failed, locked 불가"
        : `인용 ${incomplete.length}건에 sourceId/title/as-of/chunkId가 없음 — citation failed`,
  };
}
