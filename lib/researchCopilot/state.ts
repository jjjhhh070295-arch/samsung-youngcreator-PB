import type { ResearchWorkspaceState } from "./types";

const PREFIX = "pb-research-copilot:v1";

export function normalizeWorkspaceClientId(clientId?: string | null) {
  const value = clientId?.trim();
  return value ? value : "book";
}

export function researchWorkspaceStorageKey(pbId: string, clientId?: string | null) {
  return `${PREFIX}:${encodeURIComponent(pbId)}:${encodeURIComponent(normalizeWorkspaceClientId(clientId))}`;
}

export function parseResearchWorkspaceState(
  raw: string | null,
  expected: { pbId: string; clientId: string },
): ResearchWorkspaceState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ResearchWorkspaceState;
    if (!parsed || parsed.version !== 1) return null;
    if (parsed.pbId !== expected.pbId || parsed.clientId !== expected.clientId) return null;
    if (parsed.draft?.pbId !== expected.pbId || parsed.draft?.clientId !== expected.clientId) return null;
    const draft = parsed.draft;
    if (!draft || typeof draft.draftId !== "string" || draft.version !== 1) return null;
    if (draft.aiStatus !== "ready" && draft.aiStatus !== "failed") return null;
    if (!Array.isArray(draft.snapshotIds) || !draft.snapshotIds.every((id) => typeof id === "string")) return null;
    if (!Array.isArray(draft.evidenceClaimIds) || !draft.evidenceClaimIds.every((id) => typeof id === "string")) return null;
    if (!Array.isArray(draft.aiEvidenceClaimIds) || !draft.aiEvidenceClaimIds.every((id) => typeof id === "string")) return null;
    if (!Array.isArray(draft.blockers) || typeof draft.aiExplanation !== "string" || typeof draft.pbMemo !== "string") return null;
    if (typeof draft.evidenceManifestId !== "string" || (draft.approvalManifestId !== null && typeof draft.approvalManifestId !== "string")) return null;
    if (!(["draft", "approved", "blocked"] as const).includes(draft.status)) return null;
    if (draft.status === "approved" && (typeof draft.approvalManifestId !== "string" || typeof draft.approvedAt !== "string" || typeof draft.approvedBy !== "string")) return null;
    if (!Array.isArray(parsed.outputs)) return null;
    if (parsed.outputs.some((output) =>
      !output || output.pbId !== expected.pbId || output.clientId !== expected.clientId ||
      typeof output.outputId !== "string" || typeof output.draftId !== "string" ||
      typeof output.approvalManifestId !== "string" ||
      output.outputId !== `research-output:${output.draftId}:${output.approvalManifestId}` ||
      typeof output.evidenceManifestId !== "string" || typeof output.generatedAt !== "string" || !Number.isFinite(Date.parse(output.generatedAt)) ||
      output.scope !== "pb-consultation-brief" || output.fixtureOnly !== true
    )) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function isCurrentWorkspaceGeneration(
  expectedGeneration: number,
  actualGeneration: number,
  expectedIdentity: string,
  actualIdentity: string,
) {
  return expectedGeneration === actualGeneration && expectedIdentity === actualIdentity;
}
