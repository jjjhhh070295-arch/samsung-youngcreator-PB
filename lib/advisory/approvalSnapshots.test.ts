import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyIPS } from "../types";
import type { Client } from "../types";
import {
  computeBasicApprovalHash,
  detectApprovalInvalidation,
  mergeStagesPayload,
  splitStagesPayload,
  APPROVAL_HASHES_KEY,
} from "./approvalSnapshots";

function sampleClient(stages: Client["stages"] = {}, hashes: Client["approvalHashes"] = {}): Client {
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
    approvalHashes: hashes,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  client.ips.return = { ...client.ips.return, value: "8%", status: "explicit", reviewed: true };
  return client;
}

describe("approvalSnapshots", () => {
  it("기본정보 해시가 바뀌면 승인 무효화를 감지한다", () => {
    const approved = sampleClient(
      { basic: true, factors: true, cashflow: true },
      { basic: "stale-hash" },
    );
    const hit = detectApprovalInvalidation(approved);
    assert.equal(hit?.level, "basic");
  });

  it("해시가 일치하면 무효화하지 않는다", () => {
    const client = sampleClient({ basic: true, factors: true, cashflow: true });
    const hash = computeBasicApprovalHash(client);
    const hit = detectApprovalInvalidation({
      ...client,
      approvalHashes: { basic: hash },
    });
    assert.equal(hit, null);
  });

  it("stages payload에 해시를 심고 다시 분리한다", () => {
    const merged = mergeStagesPayload(
      { basic: true, factors: true, cashflow: true },
      { basic: "abc" },
    );
    assert.equal(merged.basic, true);
    assert.deepEqual(merged[APPROVAL_HASHES_KEY], { basic: "abc" });
    const split = splitStagesPayload(merged);
    assert.equal(split.stages.basic, true);
    assert.equal(split.approvalHashes.basic, "abc");
  });
});
