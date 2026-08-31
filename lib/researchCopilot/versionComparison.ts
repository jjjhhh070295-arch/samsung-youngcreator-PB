import type { EvidenceIssue, ResearchClaim, ResearchDataset, ResearchViewSnapshot, ViewChange } from "./types";
import { findClaim, uniqueResearchIds, validateSnapshots } from "./viewSnapshots";

function claims(dataset: ResearchDataset, ids: string[]): ResearchClaim[] {
  return ids.map((id) => findClaim(dataset, id)).filter((claim): claim is ResearchClaim => Boolean(claim));
}

function change(field: ViewChange["field"], label: string, before: string | null, after: string | null, evidenceClaimIds: string[]): ViewChange {
  return { changeId: `${field}:${evidenceClaimIds.join(":")}`, field, label, before, after, evidenceClaimIds: uniqueResearchIds(evidenceClaimIds) };
}

/** 같은 기관·자산군·전망기간의 명시적 문장 집합만 비교한다. */
export function compareViewSnapshots(
  dataset: ResearchDataset,
  previous: ResearchViewSnapshot,
  current: ResearchViewSnapshot,
  nowIso: string,
): { changes: ViewChange[]; issues: EvidenceIssue[] } {
  if (previous.institution !== current.institution || previous.assetClass !== current.assetClass || previous.horizon !== current.horizon) {
    return { changes: [], issues: [{ code: "SNAPSHOT_MISMATCH", message: "동일 기관·자산군·전망기간의 View만 비교할 수 있습니다." }] };
  }
  const evidenceIssues = validateSnapshots(dataset, [previous.snapshotId, current.snapshotId], nowIso);
  if (evidenceIssues.length > 0) return { changes: [], issues: evidenceIssues };
  const previousStance = findClaim(dataset, previous.stanceClaimId);
  const currentStance = findClaim(dataset, current.stanceClaimId);
  if (!previousStance || !currentStance) {
    return { changes: [], issues: [{ code: "CLAIM_MISSING", message: "비교할 핵심 View 문장이 없습니다." }] };
  }

  const changes: ViewChange[] = [];
  if (previousStance.statement !== currentStance.statement) {
    changes.push(change("stance", "핵심 View 변경", previousStance.statement, currentStance.statement, [previousStance.claimId, currentStance.claimId]));
  }
  const compareSets = (
    previousIds: string[],
    currentIds: string[],
    addedField: ViewChange["field"],
    removedField: ViewChange["field"],
    addedLabel: string,
    removedLabel: string,
  ) => {
    const previousClaims = claims(dataset, previousIds);
    const currentClaims = claims(dataset, currentIds);
    const previousText = new Set(previousClaims.map((claim) => claim.statement));
    const currentText = new Set(currentClaims.map((claim) => claim.statement));
    for (const claim of currentClaims) if (!previousText.has(claim.statement)) changes.push(change(addedField, addedLabel, null, claim.statement, [claim.claimId]));
    for (const claim of previousClaims) if (!currentText.has(claim.statement)) changes.push(change(removedField, removedLabel, claim.statement, null, [claim.claimId]));
  };
  compareSets(previous.driverClaimIds, current.driverClaimIds, "driver-added", "driver-removed", "새 투자전제", "이전 투자전제 종료");
  compareSets(previous.riskClaimIds, current.riskClaimIds, "risk-added", "risk-removed", "새 위험요인", "이전 위험요인 종료");
  return { changes, issues: [] };
}
