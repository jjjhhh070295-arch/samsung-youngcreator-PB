import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyIPS } from "../types";
import type { Client } from "../types";
import { emptyBundle } from "./control";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
  validateBasicWorkflowApproval,
  validateIpsWorkflowApproval,
  workflowPdfReady,
} from "./workflowApprovals";

function sampleClient(stages: Client["stages"] = {}): Client {
  const client: Client = {
    id: "c1",
    code: "C-1",
    clientType: "individual",
    name: "테스트",
    birthDate: "1980-01-01",
    assignedPbId: "PB-001",
    assetSize: 1_000_000_000,
    consultationNotes: "",
    ips: emptyIPS(),
    cashFlows: [],
    portfolios: [],
    stages,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  client.ips.return = { ...client.ips.return, value: "8%", status: "explicit", reviewed: true };
  return client;
}

describe("workflowApprovals", () => {
  it("기본정보 승인 플래그를 판정한다", () => {
    assert.equal(isBasicWorkflowApproved(sampleClient()), false);
    assert.equal(
      isBasicWorkflowApproved(sampleClient({ basic: true, factors: true, cashflow: true })),
      true,
    );
    assert.equal(validateBasicWorkflowApproval(sampleClient()).length, 0);
  });

  it("IPS 승인·PDF는 앞 단계 완료가 필요하다", () => {
    const mid = sampleClient({
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
    });
    const reasons = validateIpsWorkflowApproval(mid, emptyBundle(mid.id));
    assert.equal(reasons.length, 0);
    assert.equal(workflowPdfReady(mid, emptyBundle(mid.id)), false);

    const done = sampleClient({
      basic: true,
      factors: true,
      cashflow: true,
      portfolio: true,
      stress: true,
      ips: true,
    });
    assert.equal(isPortfolioWorkflowApproved(done), true);
    assert.equal(isIpsWorkflowApproved(done), true);
    assert.equal(workflowPdfReady(done, emptyBundle(done.id)), true);
  });
});
