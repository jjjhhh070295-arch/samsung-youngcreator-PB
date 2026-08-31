import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_COPILOT_AS_OF, RESEARCH_COPILOT_FIXTURE } from "./fixture";
import {
  approveResearchDraft,
  appendOutputRecord,
  buildResearchDraft,
  canConsumeResearchDraft,
  compareViewSnapshots,
  createOutputRecord,
  evidenceManifestId,
  extractExplicitClaims,
  findSnapshot,
  preserveResearchSource,
  researchEvidenceManifestId,
  validateSnapshots,
} from "./logic";

const SNAPSHOT_IDS = [
  "snapshot-samsung-2026-08",
  "snapshot-kb-2026-08",
  "snapshot-korea-2026-08",
  "snapshot-jpm-2026-08",
];
const AUTHORIZED_CLIENT_IDS = ["client-a"];

function draft() {
  return buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: "pb-a",
    clientId: "client-a",
    snapshotIds: SNAPSHOT_IDS,
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiExplanation: "검증된 문장을 쉬운 말로 연결한 교육용 설명입니다.",
    aiEvidenceClaimIds: ["samsung-2026-08-stance", "samsung-2026-08-risk"],
  });
}

test("verified fixture passes evidence validation", () => {
  assert.deepEqual(validateSnapshots(RESEARCH_COPILOT_FIXTURE, SNAPSHOT_IDS, RESEARCH_COPILOT_AS_OF), []);
});

test("source preservation is idempotent and never overwrites a conflicting original", () => {
  const source = RESEARCH_COPILOT_FIXTURE.documents[0];
  const first = preserveResearchSource([], source, RESEARCH_COPILOT_AS_OF);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const repeated = preserveResearchSource(first.archive, structuredClone(source), RESEARCH_COPILOT_AS_OF);
  assert.equal(repeated.ok, true);
  if (!repeated.ok) return;
  assert.equal(repeated.created, false);
  assert.equal(repeated.archive.length, 1);

  const conflict = preserveResearchSource(repeated.archive, { ...source, contentHash: "different-hash" }, RESEARCH_COPILOT_AS_OF);
  assert.equal(conflict.ok, false);
  assert.deepEqual(conflict.archive, repeated.archive);

  const metadataConflict = preserveResearchSource(repeated.archive, { ...source, publishedAt: "2026-07-04" }, RESEARCH_COPILOT_AS_OF);
  assert.equal(metadataConflict.ok, false);
  assert.deepEqual(metadataConflict.archive, repeated.archive);
});

test("explicit claim extraction does not invent text and blocks missing source references", () => {
  const input = {
    claimId: "explicit-1",
    sourceId: RESEARCH_COPILOT_FIXTURE.documents[0].sourceId,
    kind: "stance" as const,
    assetClass: "multi-asset",
    statement: "입력한 문장을 그대로 보존한다.",
    locator: "교육용 1쪽",
    reviewStatus: "verified" as const,
    reviewedAt: RESEARCH_COPILOT_AS_OF,
    staleAt: "2026-09-30T23:59:59+09:00",
  };
  const extracted = extractExplicitClaims([input], RESEARCH_COPILOT_FIXTURE.documents);
  assert.deepEqual(extracted.issues, []);
  assert.equal(extracted.claims[0]?.statement, input.statement);
  const missing = extractExplicitClaims([{ ...input, claimId: "explicit-2", sourceId: "missing-source" }], RESEARCH_COPILOT_FIXTURE.documents);
  assert.equal(missing.claims.length, 0);
  assert.equal(missing.issues[0]?.code, "SOURCE_MISSING");
});

test("missing, stale and conflicted claims fail closed instead of becoming normal output", () => {
  for (const reviewStatus of ["missing", "stale", "conflicted"] as const) {
    const broken = structuredClone(RESEARCH_COPILOT_FIXTURE);
    const claim = broken.claims.find((item) => item.claimId === "samsung-2026-08-stance");
    assert.ok(claim);
    claim.reviewStatus = reviewStatus;
    if (reviewStatus === "missing") claim.reviewedAt = null;
    const issues = validateSnapshots(broken, ["snapshot-samsung-2026-08"], RESEARCH_COPILOT_AS_OF);
    assert.ok(issues.length > 0, `${reviewStatus} must block`);
  }
});

test("expired evidence is stale even if its stored label still says verified", () => {
  const broken = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const claim = broken.claims.find((item) => item.claimId === "samsung-2026-08-stance");
  assert.ok(claim);
  claim.staleAt = "2026-08-01T00:00:00+09:00";
  assert.ok(
    validateSnapshots(broken, ["snapshot-samsung-2026-08"], RESEARCH_COPILOT_AS_OF).some(
      (issue) => issue.code === "EVIDENCE_STALE",
    ),
  );
});

test("same institution, asset class and horizon produce deterministic changes", () => {
  const previous = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-07");
  const current = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-08");
  assert.ok(previous && current);
  const first = compareViewSnapshots(RESEARCH_COPILOT_FIXTURE, previous, current, RESEARCH_COPILOT_AS_OF);
  const second = compareViewSnapshots(RESEARCH_COPILOT_FIXTURE, previous, current, RESEARCH_COPILOT_AS_OF);
  assert.deepEqual(first, second);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(
    first.changes.map((item) => item.field),
    ["stance", "driver-added", "driver-removed", "risk-added", "risk-removed"],
  );
});

test("different institutions cannot be compared as a time-series change", () => {
  const samsung = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-samsung-2026-08");
  const kb = findSnapshot(RESEARCH_COPILOT_FIXTURE, "snapshot-kb-2026-08");
  assert.ok(samsung && kb);
  const result = compareViewSnapshots(RESEARCH_COPILOT_FIXTURE, samsung, kb, RESEARCH_COPILOT_AS_OF);
  assert.deepEqual(result.changes, []);
  assert.equal(result.issues[0]?.code, "SNAPSHOT_MISMATCH");
});

test("version comparison renders no changes when either snapshot evidence is conflicted", () => {
  const broken = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const claim = broken.claims.find((item) => item.claimId === "samsung-2026-08-stance");
  const previous = findSnapshot(broken, "snapshot-samsung-2026-07");
  const current = findSnapshot(broken, "snapshot-samsung-2026-08");
  assert.ok(claim && previous && current);
  claim.reviewStatus = "conflicted";
  const result = compareViewSnapshots(broken, previous, current, RESEARCH_COPILOT_AS_OF);
  assert.deepEqual(result.changes, []);
  assert.ok(result.issues.some((issue) => issue.code === "EVIDENCE_CONFLICT"));
});

test("manifest is idempotent and insensitive to duplicate or reordered ids", () => {
  const a = evidenceManifestId(["b", "a", "a"], ["2", "1", "1"]);
  const b = evidenceManifestId(["a", "b"], ["1", "2"]);
  assert.equal(a, b);
});

test("PB approval enables output only after evidence confirmation", () => {
  const original = draft();
  const notChecked = approveResearchDraft(original, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "고객의 현금화 일정을 추가로 확인한다.",
    evidenceChecked: false,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(notChecked.ok, false);
  assert.equal(original.status, "draft");
  assert.equal(createOutputRecord(original, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  }), null);

  const approved = approveResearchDraft(original, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "고객의 현금화 일정을 추가로 확인한다.",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approved.draft.status, "approved");
  assert.equal(canConsumeResearchDraft(approved.draft, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  }), true);
  assert.ok(createOutputRecord(approved.draft, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  }));

  const record = createOutputRecord(approved.draft, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.ok(record);
  if (!record) return;
  assert.deepEqual(appendOutputRecord(appendOutputRecord([], record), record), [record]);
});

test("AI failure stays separate from source claims and blocks approval/output", () => {
  const failed = buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: "pb-a",
    clientId: "client-a",
    snapshotIds: SNAPSHOT_IDS,
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiStatus: "failed",
    aiExplanation: "모델이 임의로 만든 문장",
    aiEvidenceClaimIds: [],
  });
  assert.equal(failed.status, "blocked");
  assert.equal(failed.aiExplanation, "");
  const result = approveResearchDraft(failed, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(result.ok, false);
  assert.equal(createOutputRecord(failed, RESEARCH_COPILOT_FIXTURE, { pbId: "pb-a", clientId: "client-a", nowIso: RESEARCH_COPILOT_AS_OF, authorizedClientIds: AUTHORIZED_CLIENT_IDS }), null);
});

test("a non-empty AI explanation without linked evidence remains blocked", () => {
  const unsupported = buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: "pb-a",
    clientId: "client-a",
    snapshotIds: SNAPSHOT_IDS,
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiExplanation: "근거 없이 작성된 설명",
    aiEvidenceClaimIds: [],
  });
  assert.equal(unsupported.status, "blocked");
  assert.ok(unsupported.blockers.some((issue) => issue.code === "AI_EXPLANATION_FAILED"));
  assert.equal(createOutputRecord(unsupported, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  }), null);
});

test("identity, stale state and manifest tampering never replace the current draft", () => {
  const original = draft();
  const originalSnapshot = structuredClone(original);
  const wrongClient = approveResearchDraft(original, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-b",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(wrongClient.ok, false);
  assert.deepEqual(wrongClient.draft, originalSnapshot);

  const tampered = { ...original, evidenceManifestId: "manifest-forged" };
  const forged = approveResearchDraft(tampered, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.draft.evidenceManifestId, "manifest-forged");
});

test("an unassigned client cannot approve even when request and draft identities match", () => {
  const unassigned = buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: "pb-a",
    clientId: "client-forged",
    snapshotIds: SNAPSHOT_IDS,
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiExplanation: "교육용 설명",
    aiEvidenceClaimIds: ["samsung-2026-08-stance"],
  });
  const result = approveResearchDraft(unassigned, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-forged",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.code === "IDENTITY_MISMATCH"));
});

test("approval is bound to source, claim, AI explanation and PB memo contents", () => {
  const result = approveResearchDraft(draft(), RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "현금화 일정을 재확인한다.",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const input = { pbId: "pb-a", clientId: "client-a", nowIso: RESEARCH_COPILOT_AS_OF, authorizedClientIds: AUTHORIZED_CLIENT_IDS };

  assert.equal(canConsumeResearchDraft({ ...result.draft, aiExplanation: "변조된 AI 설명" }, RESEARCH_COPILOT_FIXTURE, input), false);
  assert.equal(canConsumeResearchDraft({ ...result.draft, pbMemo: "변조된 PB 메모" }, RESEARCH_COPILOT_FIXTURE, input), false);
  assert.equal(canConsumeResearchDraft({ ...result.draft, approvedAt: "2026-08-31T10:00:00+09:00" }, RESEARCH_COPILOT_FIXTURE, input), false);
  assert.equal(canConsumeResearchDraft({ ...result.draft, createdAt: "not-a-date" }, RESEARCH_COPILOT_FIXTURE, input), false);

  const claimTampered = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const claim = claimTampered.claims.find((item) => item.claimId === "samsung-2026-08-stance");
  assert.ok(claim);
  claim.statement = "변조된 원문 문장";
  assert.equal(canConsumeResearchDraft(result.draft, claimTampered, input), false);

  const sourceTampered = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const source = sourceTampered.documents.find((item) => item.sourceId === "demo-samsung-2026-08");
  assert.ok(source);
  source.contentHash = "forged-source-hash";
  assert.equal(canConsumeResearchDraft(result.draft, sourceTampered, input), false);
});

test("an approved draft cannot omit snapshot evidence or carry contradictory blockers", () => {
  const original = draft();
  const subsetIds = original.evidenceClaimIds.slice(1);
  const subsetManifest = researchEvidenceManifestId({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: original.pbId,
    clientId: original.clientId,
    snapshotIds: original.snapshotIds,
    evidenceClaimIds: subsetIds,
    aiStatus: original.aiStatus,
    aiExplanation: original.aiExplanation,
    aiEvidenceClaimIds: original.aiEvidenceClaimIds,
  });
  const rebuiltSubset = {
    ...original,
    evidenceClaimIds: subsetIds,
    evidenceManifestId: subsetManifest,
    draftId: `research-draft:${original.pbId}:${original.clientId}:${subsetManifest}`,
  };
  const subsetApproval = approveResearchDraft(rebuiltSubset, RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(subsetApproval.ok, false);

  const result = approveResearchDraft(draft(), RESEARCH_COPILOT_FIXTURE, {
    pbId: "pb-a",
    clientId: "client-a",
    pbMemo: "",
    evidenceChecked: true,
    nowIso: RESEARCH_COPILOT_AS_OF,
    authorizedClientIds: AUTHORIZED_CLIENT_IDS,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const input = { pbId: "pb-a", clientId: "client-a", nowIso: RESEARCH_COPILOT_AS_OF, authorizedClientIds: AUTHORIZED_CLIENT_IDS };
  assert.equal(canConsumeResearchDraft({ ...result.draft, evidenceClaimIds: result.draft.evidenceClaimIds.slice(1) }, RESEARCH_COPILOT_FIXTURE, input), false);
  assert.equal(canConsumeResearchDraft({
    ...result.draft,
    blockers: [{ code: "EVIDENCE_STALE", message: "변조된 차단 사유" }],
  }, RESEARCH_COPILOT_FIXTURE, input), false);
});

test("invalid calendar dates and snapshot metadata fail closed", () => {
  const invalidDate = structuredClone(RESEARCH_COPILOT_FIXTURE);
  invalidDate.documents[0].publishedAt = "2026-02-31";
  assert.ok(validateSnapshots(invalidDate, ["snapshot-samsung-2026-07"], RESEARCH_COPILOT_AS_OF).some((issue) => issue.code === "SOURCE_METADATA_MISSING"));

  const mismatched = structuredClone(RESEARCH_COPILOT_FIXTURE);
  mismatched.snapshots[0].institution = "다른 기관";
  assert.ok(validateSnapshots(mismatched, [mismatched.snapshots[0].snapshotId], RESEARCH_COPILOT_AS_OF).some((issue) => issue.code === "SOURCE_METADATA_MISSING"));

  const futureSnapshot = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const augustSnapshot = futureSnapshot.snapshots.find((item) => item.snapshotId === "snapshot-samsung-2026-08");
  assert.ok(augustSnapshot);
  augustSnapshot.effectiveFrom = "2099-01-01";
  assert.ok(validateSnapshots(futureSnapshot, [augustSnapshot.snapshotId], RESEARCH_COPILOT_AS_OF).some((issue) => issue.code === "SOURCE_METADATA_MISSING"));

  const futureReviewed = structuredClone(RESEARCH_COPILOT_FIXTURE);
  const claim = futureReviewed.claims.find((item) => item.claimId === "samsung-2026-08-stance");
  assert.ok(claim);
  claim.reviewedAt = "2099-01-01T00:00:00+09:00";
  assert.ok(validateSnapshots(futureReviewed, ["snapshot-samsung-2026-08"], RESEARCH_COPILOT_AS_OF).some((issue) => issue.code === "EVIDENCE_UNVERIFIED"));

  const expiresNow = structuredClone(RESEARCH_COPILOT_FIXTURE);
  for (const item of expiresNow.claims) item.staleAt = RESEARCH_COPILOT_AS_OF;
  assert.ok(validateSnapshots(expiresNow, ["snapshot-samsung-2026-08"], RESEARCH_COPILOT_AS_OF).some((issue) => issue.code === "EVIDENCE_STALE"));
});
