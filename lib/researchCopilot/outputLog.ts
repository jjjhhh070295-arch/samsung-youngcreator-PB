import type { ResearchDataset, ResearchDraft, ResearchOutputRecord } from "./types";
import { canConsumeResearchDraft } from "./pbApproval";

export function createOutputRecord(
  draft: ResearchDraft,
  dataset: ResearchDataset,
  input: { pbId: string; clientId: string; nowIso: string; authorizedClientIds: string[] },
): ResearchOutputRecord | null {
  if (!canConsumeResearchDraft(draft, dataset, input)) return null;
  const approvalManifestId = draft.approvalManifestId;
  if (!approvalManifestId) return null;
  return {
    outputId: `research-output:${draft.draftId}:${approvalManifestId}`,
    draftId: draft.draftId,
    approvalManifestId,
    pbId: input.pbId,
    clientId: input.clientId,
    evidenceManifestId: draft.evidenceManifestId,
    generatedAt: input.nowIso,
    scope: "pb-consultation-brief",
    fixtureOnly: true,
  };
}

/** 같은 승인본을 반복 실행해도 출력 이력을 중복 추가하지 않는다. */
export function appendOutputRecord(
  records: ResearchOutputRecord[],
  record: ResearchOutputRecord,
): ResearchOutputRecord[] {
  return records.some((item) => item.outputId === record.outputId) ? records : [...records, record];
}
