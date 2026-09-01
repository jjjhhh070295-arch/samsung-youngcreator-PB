import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_COPILOT_AS_OF, RESEARCH_COPILOT_FIXTURE } from "./fixture";
import { buildResearchDraft } from "./logic";
import {
  isCurrentWorkspaceGeneration,
  normalizeWorkspaceClientId,
  parseResearchWorkspaceState,
  researchWorkspaceStorageKey,
} from "./state";

function state(clientId: string) {
  const draft = buildResearchDraft({
    dataset: RESEARCH_COPILOT_FIXTURE,
    pbId: "pb-a",
    clientId,
    snapshotIds: ["snapshot-samsung-2026-08"],
    nowIso: RESEARCH_COPILOT_AS_OF,
    aiExplanation: "교육용",
    aiEvidenceClaimIds: ["samsung-2026-08-stance"],
  });
  return { version: 1 as const, pbId: "pb-a", clientId, draft, outputs: [] };
}

test("PB and client form an isolated storage namespace", () => {
  assert.notEqual(researchWorkspaceStorageKey("pb-a", "client-a"), researchWorkspaceStorageKey("pb-a", "client-b"));
  assert.notEqual(researchWorkspaceStorageKey("pb-a", "client-a"), researchWorkspaceStorageKey("pb-b", "client-a"));
  assert.equal(normalizeWorkspaceClientId(undefined), "book");
});

test("a previous client's stored state is rejected for the current client", () => {
  const clientA = JSON.stringify(state("client-a"));
  assert.equal(parseResearchWorkspaceState(clientA, { pbId: "pb-a", clientId: "client-b" }), null);
  assert.ok(parseResearchWorkspaceState(clientA, { pbId: "pb-a", clientId: "client-a" }));
});

test("an older or malformed approval state is rejected instead of being migrated as approved", () => {
  const malformed = state("client-a");
  const unsafe = structuredClone(malformed) as unknown as { draft: { aiStatus?: string } };
  delete unsafe.draft.aiStatus;
  assert.equal(parseResearchWorkspaceState(JSON.stringify(unsafe), { pbId: "pb-a", clientId: "client-a" }), null);

  const approvedWithoutManifest = state("client-a");
  approvedWithoutManifest.draft.status = "approved";
  approvedWithoutManifest.draft.approvedAt = RESEARCH_COPILOT_AS_OF;
  approvedWithoutManifest.draft.approvedBy = "pb-a";
  approvedWithoutManifest.draft.approvalManifestId = null;
  assert.equal(parseResearchWorkspaceState(JSON.stringify(approvedWithoutManifest), { pbId: "pb-a", clientId: "client-a" }), null);

  const nullEvidence = state("client-a") as unknown as { draft: { aiEvidenceClaimIds: null } };
  nullEvidence.draft.aiEvidenceClaimIds = null;
  assert.equal(parseResearchWorkspaceState(JSON.stringify(nullEvidence), { pbId: "pb-a", clientId: "client-a" }), null);

  const forgedOutput = state("client-a") as unknown as { outputs: Array<{ pbId: string; clientId: string }> };
  forgedOutput.outputs = [{ pbId: "pb-a", clientId: "client-a" }];
  assert.equal(parseResearchWorkspaceState(JSON.stringify(forgedOutput), { pbId: "pb-a", clientId: "client-a" }), null);

  const forgedCompleteOutput = state("client-a") as unknown as { outputs: Array<Record<string, unknown>> };
  forgedCompleteOutput.outputs = [{
    outputId: "research-output:fake:fake",
    draftId: "fake",
    approvalManifestId: "fake",
    pbId: "pb-a",
    clientId: "client-a",
    evidenceManifestId: "fake",
    generatedAt: "not-a-date",
    scope: "pb-consultation-brief",
    fixtureOnly: true,
  }];
  assert.equal(parseResearchWorkspaceState(JSON.stringify(forgedCompleteOutput), { pbId: "pb-a", clientId: "client-a" }), null);
});

test("stale async results require both generation and identity to match", () => {
  assert.equal(isCurrentWorkspaceGeneration(3, 3, "pb-a:client-b", "pb-a:client-b"), true);
  assert.equal(isCurrentWorkspaceGeneration(2, 3, "pb-a:client-b", "pb-a:client-b"), false);
  assert.equal(isCurrentWorkspaceGeneration(3, 3, "pb-a:client-b", "pb-a:client-a"), false);
});
