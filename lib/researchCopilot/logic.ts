/**
 * UI와 기존 테스트를 위한 얇은 공개 진입점입니다. 실제 책임은 원본 보존,
 * 주장 추출, View 비교, PB 승인, 출력 기록 모듈로 분리되어 있습니다.
 */
export {
  claimIdsForSnapshot,
  findClaim,
  findSnapshot,
  validateClaimEvidence,
  validateSnapshots,
} from "./viewSnapshots";
export { compareViewSnapshots } from "./versionComparison";
export {
  approveResearchDraft,
  buildResearchDraft,
  canConsumeResearchDraft,
  evidenceManifestId,
  researchEvidenceManifestId,
} from "./pbApproval";
export { appendOutputRecord, createOutputRecord } from "./outputLog";
export { preserveResearchSource, preserveResearchSources } from "./sourcePreservation";
export { extractExplicitClaims } from "./claimExtraction";
