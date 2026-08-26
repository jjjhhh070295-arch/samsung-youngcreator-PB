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
      ? `출처 ${citations.length}건 정보 확인 완료`
      : citations.length === 0
        ? "출처 정보가 없어 확정할 수 없습니다."
        : `출처 ${incomplete.length}건에 필요한 식별 정보가 없습니다.`,
  };
}
