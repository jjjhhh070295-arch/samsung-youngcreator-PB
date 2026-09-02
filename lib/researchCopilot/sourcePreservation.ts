import type {
  EvidenceIssue,
  PreservedResearchSource,
  ResearchSourceDocument,
} from "./types";

function exactCopy(source: ResearchSourceDocument): ResearchSourceDocument {
  return { ...source };
}

/**
 * 같은 sourceId의 원본을 덮어쓰지 않는다. 동일 해시는 멱등 처리하고,
 * 다른 해시는 새 sourceId로 등록될 때까지 fail-closed 한다.
 */
export function preserveResearchSource(
  archive: PreservedResearchSource[],
  source: ResearchSourceDocument,
  preservedAt: string,
):
  | { ok: true; archive: PreservedResearchSource[]; entry: PreservedResearchSource; created: boolean }
  | { ok: false; archive: PreservedResearchSource[]; issues: EvidenceIssue[] } {
  const existing = archive.find((entry) => entry.source.sourceId === source.sourceId);
  if (existing) {
    if (existing.source.contentHash === source.contentHash && JSON.stringify(existing.source) === JSON.stringify(source)) {
      return { ok: true, archive, entry: existing, created: false };
    }
    return {
      ok: false,
      archive,
      issues: [{
        code: "SOURCE_HASH_CONFLICT",
        sourceId: source.sourceId,
        message: `${source.sourceId}의 보존 원본과 새 입력의 해시 또는 메타데이터가 다릅니다. 기존 원본은 변경하지 않았습니다.`,
      }],
    };
  }

  const entry: PreservedResearchSource = {
    archiveId: `source-archive:${source.sourceId}:${source.contentHash}`,
    source: exactCopy(source),
    preservedAt,
  };
  return { ok: true, archive: [...archive, entry], entry, created: true };
}

export function preserveResearchSources(
  sources: ResearchSourceDocument[],
  preservedAt: string,
): { archive: PreservedResearchSource[]; issues: EvidenceIssue[] } {
  let archive: PreservedResearchSource[] = [];
  const issues: EvidenceIssue[] = [];
  for (const source of sources) {
    const result = preserveResearchSource(archive, source, preservedAt);
    if (!result.ok) {
      issues.push(...result.issues);
      continue;
    }
    archive = result.archive;
  }
  return { archive, issues };
}
