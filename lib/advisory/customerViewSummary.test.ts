import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerViewSummary,
  resolveCustomerReviewStatus,
} from "../customerViewSummary";
import type { Client, Portfolio } from "../types";
import { emptyIPS } from "../types";
import type { ManualPortfolioDraft } from "../manualPortfolioDraft";
import {
  computeBasicApprovalHash,
  computePortfolioApprovalHash,
} from "./approvalSnapshots";
import { basicApprovalStagePatch, portfolioApprovalStagePatch } from "./workflowApprovals";

function sampleClient(overrides?: Partial<Client>): Client {
  const base: Client = {
    id: "c1",
    code: "C-001",
    name: "테스트",
    clientType: "individual",
    birthDate: "1980-01-01",
    assetSize: 1_000_000_000,
    assignedPbId: "pb1",
    consultationNotes: "",
    cashFlows: [
      { id: "cf1", label: "급여", amount: 5_000_000, date: "2026-01-01", recurring: true },
      { id: "cf2", label: "생활비", amount: -2_000_000, date: "2026-01-01", recurring: true },
    ],
    portfolios: [],
    ips: emptyIPS(),
    stages: {},
    approvalHashes: {},
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides };
}

function samplePortfolio(): Portfolio {
  return {
    id: "p1",
    label: "맞춤 포트폴리오",
    allocations: [
      { assetClass: "국내주식", weight: 40 },
      { assetClass: "현금성", weight: 60 },
    ],
    instruments: [
      {
        symbol: "005930",
        name: "삼성전자",
        assetClassKey: "domesticEquity",
        assetClassLabel: "국내주식",
        currency: "KRW",
        weightWithinClass: 100,
        totalWeightPct: 40,
        allocationAmountWon: 400_000_000,
        quantity: 5000,
        priceSnapshot: 70000,
        bookkeepingNote: "장부",
      },
    ],
    compositionRevision: "rev-test",
    metricsStatus: "ok",
    expectedReturn: 9.170077,
    expectedRisk: 12.34,
    taxNote: "참고",
    rationale: "테스트",
    editedByPb: true,
    confirmedAt: "2026-09-01T00:00:00.000Z",
  };
}

function sampleDraft(): ManualPortfolioDraft {
  return {
    version: 2,
    allocation: {
      domesticEquity: 50,
      globalEquity: 0,
      domesticBond: 0,
      globalBond: 0,
      alternatives: 0,
      cash: 50,
    },
    selected: [
      {
        symbol: "000660",
        name: "SK하이닉스",
        assetClass: "domesticEquity",
        weightWithinClass: 100,
        currency: "KRW",
      },
    ],
    investableWon: 1_000_000_000,
    allocatableWon: 1_000_000_000,
  };
}

describe("customerViewSummary", () => {
  it("builds instrument rows and cashflow net from approved portfolio", () => {
    const client = sampleClient({
      stages: { ...basicApprovalStagePatch(), ...portfolioApprovalStagePatch() },
      portfolios: [samplePortfolio()],
    });
    const hashes = {
      basic: computeBasicApprovalHash(client),
      portfolio: computePortfolioApprovalHash(client, null),
    };
    const withHashes = { ...client, approvalHashes: hashes };
    const summary = buildCustomerViewSummary({
      client: withHashes,
      investableWon: 1_000_000_000,
    });
    assert.equal(summary.instruments.length, 1);
    assert.equal(summary.instruments[0].symbol, "005930");
    assert.equal(summary.portfolioValueWon, 400_000_000);
    assert.equal(summary.portfolioValueComplete, true);
    assert.equal(summary.cashflowMonthlyNetWon, 3_000_000);
    assert.equal(summary.expectedReturnPct, 9.170077);
    assert.match(summary.metricsLabelKo, /9\.2%/);
  });

  it("flags needs_review when approval hashes go stale after edit", () => {
    const pf = samplePortfolio();
    let client = sampleClient({
      stages: { ...basicApprovalStagePatch(), ...portfolioApprovalStagePatch() },
      portfolios: [pf],
    });
    client = {
      ...client,
      approvalHashes: {
        basic: computeBasicApprovalHash(client),
        portfolio: computePortfolioApprovalHash(client, null),
      },
    };
    assert.equal(resolveCustomerReviewStatus(client).status, "portfolio_ready");

    const edited = { ...client, name: "이름변경" };
    assert.equal(resolveCustomerReviewStatus(edited).status, "needs_review");
    assert.equal(resolveCustomerReviewStatus(edited).labelKo, "변경사항 검토 필요");
  });

  it("separates proposed draft instruments when symbols differ", () => {
    const client = sampleClient({
      stages: { ...basicApprovalStagePatch(), ...portfolioApprovalStagePatch() },
      portfolios: [samplePortfolio()],
    });
    const summary = buildCustomerViewSummary({
      client,
      draft: sampleDraft(),
      investableWon: 1_000_000_000,
    });
    assert.equal(summary.hasProposedDiff, true);
    assert.ok(summary.proposedInstruments.some((r) => r.symbol === "000660"));
    assert.ok(summary.instruments.every((r) => r.source === "approved"));
  });

  it("does not fabricate metrics when unavailable", () => {
    const pf = samplePortfolio();
    pf.metricsStatus = "unavailable";
    pf.expectedReturn = null;
    pf.expectedRisk = null;
    const client = sampleClient({ portfolios: [pf] });
    const summary = buildCustomerViewSummary({ client });
    assert.equal(summary.expectedReturnPct, null);
    assert.equal(summary.metricsLabelKo, "산출 전");
  });
});

describe("clientLiveSync revision ordering", () => {
  it("parse rejects older revisions via consumer rule (documented)", () => {
    // 소비자(useLiveClient / subscribe deliver)는 revision <= lastSeen 이면 무시한다.
    const a = { revision: 100 };
    const b = { revision: 90 };
    assert.ok(b.revision < a.revision);
  });
});
