import type { EvidenceIssue, ResearchDataset, ResearchDraft, ResearchViewSnapshot } from "./types";
import { claimIdsForSnapshot, findSnapshot, uniqueResearchIds, validateSnapshots } from "./viewSnapshots";

/** 비보안 식별자. 서버 서명이나 출력 허가 토큰으로 사용하지 않는다. */
export function evidenceManifestId(snapshotIds: string[], claimIds: string[]): string {
  const input = `${uniqueResearchIds(snapshotIds).sort().join("|")}::${uniqueResearchIds(claimIds).sort().join("|")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `manifest-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function researchEvidenceManifestId(input: {
  dataset: ResearchDataset;
  pbId: string;
  clientId: string;
  snapshotIds: string[];
  evidenceClaimIds: string[];
  aiStatus: ResearchDraft["aiStatus"];
  aiExplanation: string;
  aiEvidenceClaimIds: string[];
}) {
  const snapshotIds = uniqueResearchIds(input.snapshotIds).sort();
  const claimIds = uniqueResearchIds(input.evidenceClaimIds).sort();
  const snapshots = snapshotIds.map((id) => findSnapshot(input.dataset, id));
  const claims = claimIds.map((id) => input.dataset.claims.find((claim) => claim.claimId === id) ?? null);
  const sourceIds = uniqueResearchIds([
    ...snapshots.flatMap((snapshot) => snapshot ? [snapshot.sourceId] : []),
    ...claims.flatMap((claim) => claim ? [claim.sourceId] : []),
  ]).sort();
  const sources = sourceIds.map((id) => input.dataset.documents.find((document) => document.sourceId === id) ?? null);
  const canonical = JSON.stringify({
    pbId: input.pbId,
    clientId: input.clientId,
    snapshots,
    claims,
    sources,
    aiStatus: input.aiStatus,
    aiExplanation: input.aiExplanation,
    aiEvidenceClaimIds: uniqueResearchIds(input.aiEvidenceClaimIds).sort(),
  });
  return `evidence-${stableHash(canonical)}`;
}

function approvalManifestId(draft: ResearchDraft, pbMemo: string) {
  return `approval-${stableHash(JSON.stringify({
    draftId: draft.draftId,
    version: draft.version,
    pbId: draft.pbId,
    clientId: draft.clientId,
    evidenceManifestId: draft.evidenceManifestId,
    status: draft.status,
    approvedAt: draft.approvedAt,
    approvedBy: draft.approvedBy,
    createdAt: draft.createdAt,
    blockers: draft.blockers,
    pbMemo,
  }))}`;
}

function expectedEvidenceClaimIds(dataset: ResearchDataset, snapshotIds: string[]) {
  return uniqueResearchIds(
    snapshotIds.flatMap((snapshotId) => {
      const snapshot = findSnapshot(dataset, snapshotId);
      return snapshot ? claimIdsForSnapshot(snapshot) : [];
    }),
  ).sort();
}

function sameIds(left: string[], right: string[]) {
  const a = uniqueResearchIds(left).sort();
  const b = uniqueResearchIds(right).sort();
  return left.length === a.length && right.length === b.length && a.length === b.length && a.every((id, index) => id === b[index]);
}

function expectedDraftId(draft: Pick<ResearchDraft, "pbId" | "clientId" | "evidenceManifestId">) {
  return `research-draft:${draft.pbId}:${draft.clientId}:${draft.evidenceManifestId}`;
}

export function buildResearchDraft(input: {
  dataset: ResearchDataset;
  pbId: string;
  clientId: string;
  snapshotIds: string[];
  nowIso: string;
  aiExplanation: string;
  aiEvidenceClaimIds: string[];
  aiStatus?: ResearchDraft["aiStatus"];
}): ResearchDraft {
  const snapshots = input.snapshotIds
    .map((snapshotId) => findSnapshot(input.dataset, snapshotId))
    .filter((snapshot): snapshot is ResearchViewSnapshot => Boolean(snapshot));
  const evidenceClaimIds = uniqueResearchIds(snapshots.flatMap(claimIdsForSnapshot));
  const aiEvidenceClaimIds = uniqueResearchIds(input.aiEvidenceClaimIds);
  const blockers = validateSnapshots(input.dataset, input.snapshotIds, input.nowIso);
  const aiStatus = input.aiStatus ?? "ready";
  if (aiStatus === "failed" || !input.aiExplanation.trim() || aiEvidenceClaimIds.length === 0) {
    blockers.push({ code: "AI_EXPLANATION_FAILED", message: "AI 설명 생성·검증에 실패해 승인과 출력을 차단했습니다." });
  }
  if (aiEvidenceClaimIds.some((claimId) => !evidenceClaimIds.includes(claimId))) {
    blockers.push({ code: "MANIFEST_MISMATCH", message: "AI 설명 근거가 승인 대상 Evidence에 포함되지 않았습니다." });
  }
  const manifestId = researchEvidenceManifestId({
    dataset: input.dataset,
    pbId: input.pbId,
    clientId: input.clientId,
    snapshotIds: input.snapshotIds,
    evidenceClaimIds,
    aiStatus,
    aiExplanation: aiStatus === "ready" ? input.aiExplanation : "",
    aiEvidenceClaimIds,
  });
  return {
    draftId: `research-draft:${input.pbId}:${input.clientId}:${manifestId}`,
    version: 1,
    pbId: input.pbId,
    clientId: input.clientId,
    snapshotIds: uniqueResearchIds(input.snapshotIds),
    evidenceClaimIds,
    evidenceManifestId: manifestId,
    approvalManifestId: null,
    aiStatus,
    aiExplanation: aiStatus === "ready" ? input.aiExplanation : "",
    aiEvidenceClaimIds,
    pbMemo: "",
    status: blockers.length > 0 ? "blocked" : "draft",
    createdAt: input.nowIso,
    approvedAt: null,
    approvedBy: null,
    blockers,
  };
}

export function approveResearchDraft(
  draft: ResearchDraft,
  dataset: ResearchDataset,
  input: { pbId: string; clientId: string; pbMemo: string; evidenceChecked: boolean; nowIso: string; authorizedClientIds: string[] },
): { ok: true; draft: ResearchDraft } | { ok: false; draft: ResearchDraft; issues: EvidenceIssue[] } {
  const issues = validateSnapshots(dataset, draft.snapshotIds, input.nowIso);
  if (!Number.isFinite(Date.parse(draft.createdAt)) || Date.parse(draft.createdAt) > Date.parse(input.nowIso)) {
    issues.push({ code: "MANIFEST_MISMATCH", message: "검토본 생성시각이 올바르지 않습니다." });
  }
  if (draft.aiStatus !== "ready" || !draft.aiExplanation.trim() || draft.aiEvidenceClaimIds.length === 0) {
    issues.push({ code: "AI_EXPLANATION_FAILED", message: "AI 설명 생성·검증 실패 상태입니다." });
  }
  if (draft.pbId !== input.pbId || draft.clientId !== input.clientId) {
    issues.push({ code: "IDENTITY_MISMATCH", message: "현재 PB·고객과 검토본의 소유자가 일치하지 않습니다." });
  }
  if (!input.authorizedClientIds.includes(draft.clientId)) {
    issues.push({ code: "IDENTITY_MISMATCH", message: "현재 PB에게 배정된 고객이 아니므로 승인과 출력을 차단했습니다." });
  }
  if (draft.aiEvidenceClaimIds.some((claimId) => !draft.evidenceClaimIds.includes(claimId))) {
    issues.push({ code: "MANIFEST_MISMATCH", message: "AI 설명 근거가 승인 대상 Evidence에 포함되지 않았습니다." });
  }
  if (!sameIds(draft.evidenceClaimIds, expectedEvidenceClaimIds(dataset, draft.snapshotIds))) {
    issues.push({ code: "MANIFEST_MISMATCH", message: "View 스냅샷의 전체 Evidence 집합과 검토본 근거 목록이 일치하지 않습니다." });
  }
  const expectedManifest = researchEvidenceManifestId({
    dataset,
    pbId: draft.pbId,
    clientId: draft.clientId,
    snapshotIds: draft.snapshotIds,
    evidenceClaimIds: draft.evidenceClaimIds,
    aiStatus: draft.aiStatus,
    aiExplanation: draft.aiExplanation,
    aiEvidenceClaimIds: draft.aiEvidenceClaimIds,
  });
  if (expectedManifest !== draft.evidenceManifestId) {
    issues.push({ code: "MANIFEST_MISMATCH", message: "검토본의 Evidence manifest가 변경되었습니다." });
  }
  if (draft.draftId !== expectedDraftId(draft)) {
    issues.push({ code: "MANIFEST_MISMATCH", message: "검토본 ID가 현재 Evidence manifest와 일치하지 않습니다." });
  }
  if (!input.evidenceChecked) {
    issues.push({ code: "PB_REVIEW_REQUIRED", message: "PB가 근거 원문 확인을 완료해야 합니다." });
  }
  if (issues.length > 0) return { ok: false, draft, issues };
  const approvedDraft = { ...draft, pbMemo: input.pbMemo.trim(), status: "approved" as const, approvedAt: input.nowIso, approvedBy: input.pbId, blockers: [] };
  return { ok: true, draft: { ...approvedDraft, approvalManifestId: approvalManifestId(approvedDraft, approvedDraft.pbMemo) } };
}

export function canConsumeResearchDraft(
  draft: ResearchDraft,
  dataset: ResearchDataset,
  input: { pbId: string; clientId: string; nowIso: string; authorizedClientIds: string[] },
): boolean {
  if (draft.status !== "approved" || draft.aiStatus !== "ready" || !draft.approvedAt || draft.approvedBy !== input.pbId || !draft.approvalManifestId) return false;
  if (!Number.isFinite(Date.parse(draft.createdAt)) || Date.parse(draft.createdAt) > Date.parse(draft.approvedAt) || Date.parse(draft.approvedAt) > Date.parse(input.nowIso)) return false;
  if (draft.blockers.length > 0 || draft.draftId !== expectedDraftId(draft)) return false;
  if (draft.pbId !== input.pbId || draft.clientId !== input.clientId) return false;
  if (!input.authorizedClientIds.includes(draft.clientId)) return false;
  if (validateSnapshots(dataset, draft.snapshotIds, input.nowIso).length > 0) return false;
  if (draft.aiEvidenceClaimIds.length === 0 || draft.aiEvidenceClaimIds.some((claimId) => !draft.evidenceClaimIds.includes(claimId))) return false;
  if (!sameIds(draft.evidenceClaimIds, expectedEvidenceClaimIds(dataset, draft.snapshotIds))) return false;
  const evidenceManifest = researchEvidenceManifestId({
    dataset,
    pbId: draft.pbId,
    clientId: draft.clientId,
    snapshotIds: draft.snapshotIds,
    evidenceClaimIds: draft.evidenceClaimIds,
    aiStatus: draft.aiStatus,
    aiExplanation: draft.aiExplanation,
    aiEvidenceClaimIds: draft.aiEvidenceClaimIds,
  });
  return evidenceManifest === draft.evidenceManifestId && approvalManifestId(draft, draft.pbMemo) === draft.approvalManifestId;
}
