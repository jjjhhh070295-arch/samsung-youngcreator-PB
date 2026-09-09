import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { emptyIPS } from "../types";
import type { Client } from "../types";
import {
  __resetApprovalTransitionInflightForTests,
  isLevelApproved,
  runApprovalUnapproval,
} from "./approvalTransition";
import {
  canonicalizeFinancialIncomeProfile,
  computeBasicApprovalHash,
  detectApprovalInvalidation,
  MSG_BASIC_STALE,
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

describe("approvalTransition", () => {
  beforeEach(() => {
    __resetApprovalTransitionInflightForTests();
  });

  it("unapproved customer produces already_unapproved with no persist", async () => {
    let writes = 0;
    const client = sampleClient({ basic: false, factors: false, cashflow: false });
    let latest: Client | null = client;
    const result = await runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, {
      generation: 1,
      getGeneration: () => 1,
      getLatest: () => latest,
      persist: async () => {
        writes += 1;
      },
    });
    assert.equal(result.status, "already_unapproved");
    assert.equal(writes, 0);
  });

  it("approved customer invalidates once; repeat is already_unapproved", async () => {
    let writes = 0;
    let latest: Client | null = sampleClient(
      { basic: true, factors: true, cashflow: true, portfolio: true, stress: true, ips: true },
      { basic: "x" },
    );
    const deps = {
      generation: 1,
      getGeneration: () => 1,
      getLatest: () => latest,
      persist: async (_id: string, patch: Partial<Client>) => {
        writes += 1;
        latest = { ...latest!, ...patch } as Client;
      },
    };
    const first = await runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, deps);
    assert.equal(first.status, "changed");
    assert.equal(writes, 1);
    assert.equal(isLevelApproved(latest!, "basic"), false);

    const second = await runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, deps);
    assert.equal(second.status, "already_unapproved");
    assert.equal(writes, 1);
  });

  it("concurrent basic+portfolio coalesce to one write", async () => {
    let writes = 0;
    let latest: Client | null = sampleClient(
      { basic: true, factors: true, cashflow: true, portfolio: true, stress: true },
      { basic: "x", portfolio: "y" },
    );
    let resolvePersist!: () => void;
    const persistGate = new Promise<void>((r) => {
      resolvePersist = r;
    });
    const deps = {
      generation: 1,
      getGeneration: () => 1,
      getLatest: () => latest,
      persist: async (_id: string, patch: Partial<Client>) => {
        writes += 1;
        await persistGate;
        latest = { ...latest!, ...patch } as Client;
      },
    };
    const p1 = runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, deps);
    const p2 = runApprovalUnapproval("c1", "portfolio", "포트폴리오 스테일", deps);
    resolvePersist();
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(writes, 1);
    assert.equal(r1.status, "changed");
    assert.ok(r2.status === "already_unapproved" || r2.status === "changed" || r2.status === "superseded");
    assert.equal(isLevelApproved(latest!, "basic"), false);
    assert.equal(isLevelApproved(latest!, "portfolio"), false);
  });

  it("generation mismatch after await is superseded", async () => {
    let generation = 1;
    let latest: Client | null = sampleClient(
      { basic: true, factors: true, cashflow: true },
      { basic: "x" },
    );
    const result = await runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, {
      generation: 1,
      getGeneration: () => generation,
      getLatest: () => latest,
      persist: async () => {
        generation = 2;
      },
    });
    assert.equal(result.status, "superseded");
  });

  it("failed persist reports failed once without throwing", async () => {
    const client = sampleClient({ basic: true, factors: true, cashflow: true }, { basic: "x" });
    const result = await runApprovalUnapproval("c1", "basic", MSG_BASIC_STALE, {
      generation: 1,
      getGeneration: () => 1,
      getLatest: () => client,
      persist: async () => {
        throw new Error("db down");
      },
    });
    assert.equal(result.status, "failed");
    assert.match(result.error || "", /db down/);
  });
});

describe("approvalSnapshots derived exclusion", () => {
  it("derived deposit interest change does not alter basic hash", () => {
    const base = sampleClient({ basic: true, factors: true, cashflow: true });
    base.financialIncomeProfile = {
      interestIncomeWon: 1_000_000,
      dividendIncomeWon: 0,
      parseStatus: "manual",
      derivedDepositInterestWon: 100,
    };
    const h1 = computeBasicApprovalHash(base);
    const h2 = computeBasicApprovalHash({
      ...base,
      financialIncomeProfile: {
        ...base.financialIncomeProfile!,
        derivedDepositInterestWon: 999_999,
      },
    });
    assert.equal(h1, h2);
    assert.equal(detectApprovalInvalidation({ ...base, approvalHashes: { basic: h1 } }), null);
  });

  it("actual interest income edit does invalidate", () => {
    const base = sampleClient({ basic: true, factors: true, cashflow: true });
    base.financialIncomeProfile = {
      interestIncomeWon: 1_000_000,
      dividendIncomeWon: 0,
      parseStatus: "manual",
    };
    const hash = computeBasicApprovalHash(base);
    const edited = {
      ...base,
      financialIncomeProfile: {
        ...base.financialIncomeProfile!,
        interestIncomeWon: 2_000_000,
      },
      approvalHashes: { basic: hash },
    };
    assert.equal(detectApprovalInvalidation(edited)?.level, "basic");
  });

  it("canonicalize drops derived fields only", () => {
    const c = canonicalizeFinancialIncomeProfile({
      interestIncomeWon: 10,
      dividendIncomeWon: null,
      parseStatus: "manual",
      derivedDepositInterestWon: 55,
      extractedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal((c as any).derivedDepositInterestWon, undefined);
    assert.equal((c as any).extractedAt, undefined);
    assert.equal(c?.interestIncomeWon, 10);
  });
});
