export type ResearchInstitutionKind = "samsung" | "domestic-peer" | "global";

export type EvidenceReviewStatus = "verified" | "missing" | "conflicted" | "stale";

export type ResearchClaimKind = "stance" | "driver" | "risk" | "forecast";

export interface ResearchSourceDocument {
  sourceId: string;
  institution: string;
  institutionKind: ResearchInstitutionKind;
  title: string;
  publishedAt: string;
  asOfDate: string;
  horizon: "weekly" | "monthly" | "quarterly";
  originalUrl: string;
  defaultLocator: string;
  contentHash: string;
  rightsStatus: "demo-only" | "internal-review-required" | "approved";
  isEducationalFixture: boolean;
}

export interface ResearchClaim {
  claimId: string;
  sourceId: string;
  kind: ResearchClaimKind;
  assetClass: string;
  statement: string;
  locator: string;
  reviewStatus: EvidenceReviewStatus;
  reviewedAt: string | null;
  staleAt: string;
  conflictGroupId?: string;
}

export interface ResearchViewSnapshot {
  snapshotId: string;
  institution: string;
  sourceId: string;
  assetClass: string;
  horizon: ResearchSourceDocument["horizon"];
  effectiveFrom: string;
  stanceClaimId: string;
  driverClaimIds: string[];
  riskClaimIds: string[];
}

export interface ResearchDataset {
  documents: ResearchSourceDocument[];
  claims: ResearchClaim[];
  snapshots: ResearchViewSnapshot[];
}

export interface EvidenceIssue {
  code:
    | "SOURCE_MISSING"
    | "SOURCE_METADATA_MISSING"
    | "SOURCE_HASH_CONFLICT"
    | "SOURCE_RIGHTS_BLOCKED"
    | "CLAIM_MISSING"
    | "LOCATOR_MISSING"
    | "EVIDENCE_UNVERIFIED"
    | "EVIDENCE_STALE"
    | "EVIDENCE_CONFLICT"
    | "SNAPSHOT_MISMATCH"
    | "IDENTITY_MISMATCH"
    | "MANIFEST_MISMATCH"
    | "AI_EXPLANATION_FAILED"
    | "PB_REVIEW_REQUIRED";
  message: string;
  sourceId?: string;
  claimId?: string;
}

export interface ViewChange {
  changeId: string;
  field: "stance" | "driver-added" | "driver-removed" | "risk-added" | "risk-removed";
  label: string;
  before: string | null;
  after: string | null;
  evidenceClaimIds: string[];
}

export interface ResearchDraft {
  draftId: string;
  version: 1;
  pbId: string;
  clientId: string;
  snapshotIds: string[];
  evidenceClaimIds: string[];
  evidenceManifestId: string;
  approvalManifestId: string | null;
  aiStatus: "ready" | "failed";
  aiExplanation: string;
  aiEvidenceClaimIds: string[];
  pbMemo: string;
  status: "draft" | "approved" | "blocked";
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  blockers: EvidenceIssue[];
}

export interface PreservedResearchSource {
  archiveId: string;
  source: ResearchSourceDocument;
  preservedAt: string;
}

export interface ResearchOutputRecord {
  outputId: string;
  draftId: string;
  approvalManifestId: string;
  pbId: string;
  clientId: string;
  evidenceManifestId: string;
  generatedAt: string;
  scope: "pb-consultation-brief";
  fixtureOnly: true;
}

export interface ResearchWorkspaceState {
  version: 1;
  pbId: string;
  clientId: string;
  draft: ResearchDraft;
  outputs: ResearchOutputRecord[];
}
