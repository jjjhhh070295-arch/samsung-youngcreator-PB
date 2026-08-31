import type {
  EvidenceIssue,
  ResearchClaim,
  ResearchDataset,
  ResearchViewSnapshot,
} from "./types";

export function uniqueResearchIds(values: string[]) {
  return Array.from(new Set(values));
}

export function claimIdsForSnapshot(snapshot: ResearchViewSnapshot): string[] {
  return uniqueResearchIds([
    snapshot.stanceClaimId,
    ...snapshot.driverClaimIds,
    ...snapshot.riskClaimIds,
  ]);
}

export function findClaim(dataset: ResearchDataset, claimId: string): ResearchClaim | null {
  return dataset.claims.find((claim) => claim.claimId === claimId) ?? null;
}

export function findSnapshot(dataset: ResearchDataset, snapshotId: string): ResearchViewSnapshot | null {
  return dataset.snapshots.find((snapshot) => snapshot.snapshotId === snapshotId) ?? null;
}

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const dateOnly = value.slice(0, 10);
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === dateOnly && Number.isFinite(Date.parse(value));
}

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateClaimEvidence(
  dataset: ResearchDataset,
  claimId: string,
  nowIso: string,
): EvidenceIssue[] {
  const claim = findClaim(dataset, claimId);
  if (!claim) return [{ code: "CLAIM_MISSING", claimId, message: `주장 ${claimId}을 찾을 수 없습니다.` }];
  const source = dataset.documents.find((document) => document.sourceId === claim.sourceId);
  if (!source) return [{ code: "SOURCE_MISSING", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}의 원문을 찾을 수 없습니다.` }];

  const issues: EvidenceIssue[] = [];
  if (
    !source.title.trim() || !source.institution.trim() || !validHttpUrl(source.originalUrl) ||
    !source.defaultLocator.trim() || !source.contentHash.trim() ||
    !validDate(source.publishedAt) || !validDate(source.asOfDate)
  ) {
    issues.push({ code: "SOURCE_METADATA_MISSING", sourceId: source.sourceId, claimId, message: `${source.sourceId}의 필수 원문 메타데이터 또는 날짜 형식이 올바르지 않습니다.` });
  } else if (Date.parse(source.publishedAt) > Date.parse(nowIso) || Date.parse(source.asOfDate) > Date.parse(nowIso) || Date.parse(source.asOfDate) > Date.parse(source.publishedAt)) {
    issues.push({ code: "SOURCE_METADATA_MISSING", sourceId: source.sourceId, claimId, message: `${source.sourceId}의 발행일·기준일이 검증시각과 시간적으로 일치하지 않습니다.` });
  }
  if (!source.isEducationalFixture && source.rightsStatus !== "approved") {
    issues.push({ code: "SOURCE_RIGHTS_BLOCKED", sourceId: source.sourceId, claimId, message: `${source.sourceId}의 전문 처리 권리가 승인되지 않았습니다.` });
  }
  if (!claim.statement.trim() || !claim.locator.trim()) {
    issues.push({ code: "LOCATOR_MISSING", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}의 문장 또는 페이지·섹션이 없습니다.` });
  }
  if (claim.reviewStatus === "missing" || !validDate(claim.reviewedAt)) {
    issues.push({ code: "EVIDENCE_UNVERIFIED", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}은 검토되지 않았거나 검토일 형식이 올바르지 않습니다.` });
  }
  if (validDate(claim.reviewedAt) && (Date.parse(claim.reviewedAt as string) > Date.parse(nowIso) || Date.parse(claim.reviewedAt as string) > Date.parse(claim.staleAt))) {
    issues.push({ code: "EVIDENCE_UNVERIFIED", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}의 검토일이 검증시각 또는 만료일보다 늦습니다.` });
  }
  if (claim.reviewStatus === "conflicted") {
    issues.push({ code: "EVIDENCE_CONFLICT", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}은 출처 충돌이 해결되지 않았습니다.` });
  }
  if (claim.reviewStatus === "stale" || !validDate(claim.staleAt) || Date.parse(claim.staleAt) <= Date.parse(nowIso)) {
    issues.push({ code: "EVIDENCE_STALE", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}의 검토 유효기간이 지났거나 날짜 형식이 올바르지 않습니다.` });
  }
  return issues;
}

export function validateSnapshots(
  dataset: ResearchDataset,
  snapshotIds: string[],
  nowIso: string,
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  if (!validDate(nowIso)) {
    return [{ code: "SOURCE_METADATA_MISSING", message: "검증 기준시각 형식이 올바르지 않아 결과를 차단했습니다." }];
  }
  const sourceById = new Map(dataset.documents.map((document) => [document.sourceId, document]));

  for (const snapshotId of uniqueResearchIds(snapshotIds)) {
    const snapshot = findSnapshot(dataset, snapshotId);
    if (!snapshot) {
      issues.push({ code: "CLAIM_MISSING", message: `View 스냅샷 ${snapshotId}을 찾을 수 없습니다.` });
      continue;
    }
    const source = sourceById.get(snapshot.sourceId);
    if (!source) {
      issues.push({ code: "SOURCE_MISSING", sourceId: snapshot.sourceId, message: `${snapshot.institution} 원문을 찾을 수 없습니다.` });
      continue;
    }
    if (
      !snapshot.institution.trim() || !snapshot.assetClass.trim() || !validDate(snapshot.effectiveFrom) ||
      snapshot.institution !== source.institution || snapshot.horizon !== source.horizon ||
      Date.parse(snapshot.effectiveFrom) > Date.parse(nowIso) ||
      Date.parse(snapshot.effectiveFrom) < Date.parse(source.asOfDate)
    ) {
      issues.push({ code: "SOURCE_METADATA_MISSING", sourceId: snapshot.sourceId, message: `${snapshot.snapshotId}의 기관·자산군·유효일·전망기간이 원문 메타데이터와 일치하지 않습니다.` });
    }
    for (const claimId of claimIdsForSnapshot(snapshot)) {
      const claim = findClaim(dataset, claimId);
      if (!claim) {
        issues.push({ code: "CLAIM_MISSING", claimId, message: `주장 ${claimId}을 찾을 수 없습니다.` });
        continue;
      }
      if (claim.sourceId !== snapshot.sourceId) {
        issues.push({ code: "SOURCE_MISSING", sourceId: claim.sourceId, claimId, message: `주장 ${claimId}의 원문과 View 스냅샷 원문이 일치하지 않습니다.` });
      }
      issues.push(...validateClaimEvidence(dataset, claimId, nowIso));
    }
  }
  return issues;
}
