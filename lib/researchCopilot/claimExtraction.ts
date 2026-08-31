import type { EvidenceIssue, ResearchClaim, ResearchSourceDocument } from "./types";

export interface ExplicitClaimInput {
  claimId: string;
  sourceId: string;
  kind: ResearchClaim["kind"];
  assetClass: string;
  statement: string;
  locator: string;
  reviewStatus: ResearchClaim["reviewStatus"];
  reviewedAt: string | null;
  staleAt: string;
  conflictGroupId?: string;
}

/**
 * MVP에서는 LLM 추출을 흉내 내지 않는다. 사람이 작성한 fixture 필드를
 * 한 글자도 보강하지 않고 검증 후 구조화한다.
 */
export function extractExplicitClaims(
  inputs: ExplicitClaimInput[],
  documents: ResearchSourceDocument[],
): { claims: ResearchClaim[]; issues: EvidenceIssue[] } {
  const sourceIds = new Set(documents.map((document) => document.sourceId));
  const claimIds = new Set<string>();
  const claims: ResearchClaim[] = [];
  const issues: EvidenceIssue[] = [];

  for (const input of inputs) {
    if (claimIds.has(input.claimId)) {
      issues.push({ code: "CLAIM_MISSING", claimId: input.claimId, message: `중복 claimId ${input.claimId}을 차단했습니다.` });
      continue;
    }
    claimIds.add(input.claimId);
    if (!sourceIds.has(input.sourceId)) {
      issues.push({ code: "SOURCE_MISSING", sourceId: input.sourceId, claimId: input.claimId, message: `${input.claimId}의 원문이 없습니다.` });
      continue;
    }
    if (!input.statement.trim() || !input.locator.trim()) {
      issues.push({ code: "LOCATOR_MISSING", sourceId: input.sourceId, claimId: input.claimId, message: `${input.claimId}의 문장 또는 위치가 없습니다.` });
      continue;
    }
    claims.push({ ...input });
  }
  return { claims, issues };
}
