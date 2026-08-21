import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyBundle, canIssueClientPdf, canLock, transitionStatus, applyJudge, attachCitations, approveByPb, judgeRecommend, judgeCalcResults, softLockReasons, applyCalcSnapshot, defaultCalcConfig } from "./control";
import { sha256HexSync, stableStringify } from "./hash";
import { buildRiskMetrics } from "./riskEngine";
import { evaluateGoldSet } from "./goldSet";
import { judgeCitations } from "./citations";
import { JUDGE_MAX_RETRIES } from "./constants";
import { buildPipeline, currentPipelineStep, pipelineMatchesStatus } from "./pipeline";
import type { CalcResults, JudgeResult, RecommendResult } from "./types";
import { emptyIPS } from "../types";
import type { Client } from "../types";

const passJudge: JudgeResult = {
  at: "2026-08-01T00:00:00.000Z",
  passed: true,
  findings: [{ code: "ASOF", severity: "pass", message: "ok" }],
};

const failJudge: JudgeResult = {
  at: "2026-08-01T00:00:00.000Z",
  passed: false,
  findings: [{ code: "ASOF", severity: "fail", message: "missing" }],
};

describe("advisory control gates", () => {
  it("blocked cannot become locked", () => {
    let b = emptyBundle("c1");
    b = applyJudge(b, failJudge, "engine");
    assert.equal(b.status, "blocked");
    const next = transitionStatus(b, "locked", "PB", "force");
    assert.equal(next.status, "blocked");
    assert.equal(canLock(b), false);
    assert.equal(canIssueClientPdf(b.status), false);
  });

  it("Judge 실패 시 고객용 PDF 발행 불가", () => {
    let b = emptyBundle("c1");
    b.status = "review";
    b = applyJudge(b, failJudge, "engine");
    assert.equal(canIssueClientPdf(b.status), false);
    b = approveByPb(b);
    assert.notEqual(b.status, "locked");
  });

  it("locked 에서만 PDF 가능", () => {
    assert.equal(canIssueClientPdf("draft"), false);
    assert.equal(canIssueClientPdf("review"), false);
    assert.equal(canIssueClientPdf("blocked"), false);
    assert.equal(canIssueClientPdf("locked"), true);
  });

  it("같은 입력이면 핵심 계산 해시가 동일함", () => {
    const payload = { expectedReturnPct: 8, volatilityPct: 12, mddPct: -15.6, asOf: "2026-08-01T00:00:00.000Z" };
    const a = buildRiskMetrics(payload);
    const b = buildRiskMetrics(payload);
    assert.equal(sha256HexSync(stableStringify(a)), sha256HexSync(stableStringify(b)));
  });

  it("중요 숫자에는 as-of/source/currency가 있음", () => {
    const risk = buildRiskMetrics({
      expectedReturnPct: 8,
      volatilityPct: 12,
      mddPct: -15.6,
      asOf: "2026-08-01T00:00:00.000Z",
    });
    for (const n of [risk.expectedReturn, risk.volatility, risk.sharpe, risk.mdd, risk.var95, risk.cvar95]) {
      assert.ok(n.asOf);
      assert.ok(n.source);
    }
    assert.equal(risk.currency, "KRW");
  });

  it("인용 실패면 locked 불가", () => {
    let b = emptyBundle("c1");
    b = applyJudge(b, passJudge, "engine");
    b = attachCitations(b, [{ sourceId: "", title: "x", asOf: "", chunkId: "" }]);
    assert.equal(b.status, "blocked");
    assert.equal(canLock(b), false);
    assert.equal(canIssueClientPdf(b.status), false);
  });

  it("Judge 재시도 한도를 상수로 관리", () => {
    assert.equal(JUDGE_MAX_RETRIES, 2);
    let b = emptyBundle("c1");
    b = applyJudge(b, failJudge, "e");
    b.status = "draft";
    b = applyJudge(b, failJudge, "e");
    assert.ok(b.judgeAttempts >= JUDGE_MAX_RETRIES);
    assert.equal(b.status, "blocked");
    assert.equal(canLock(b), false);
  });
});

describe("gold set honesty", () => {
  it("사람 라벨과 Judge가 100%라고 주장하지 않음", () => {
    const ev = evaluateGoldSet();
    assert.ok(ev.tp + ev.tn + ev.fp + ev.fn === 22);
    assert.ok(ev.agreementPct <= 100);
  });
});

describe("citations and judgeRecommend", () => {
  it("인용 메타 없으면 citation failed", () => {
    const v = judgeCitations([{ sourceId: "", title: "x", asOf: "", chunkId: "" }]);
    assert.equal(v.passed, false);
  });
  it("as-of 없으면 실패", () => {
    const r = {
      asOf: "",
      source: "x",
      currency: "KRW",
      constraints: { rawText: "", categoryOnly: null, overseasOnly: false, minExpectedReturn: null, preferIndividualStocks: false, tags: [] },
      plans: [],
      narrativePromptFacts: [],
      disclaimers: [],
    } as RecommendResult;
    assert.equal(judgeRecommend(r).passed, false);
  });
});

function readyBundle() {
  let b = emptyBundle("c1");
  const asOf = "2026-08-01T00:00:00.000Z";
  const risk = buildRiskMetrics({ expectedReturnPct: 8, volatilityPct: 12, mddPct: -15, asOf });
  const calcResults: CalcResults = {
    risk,
    stress: [
      {
        id: "a",
        label: "금리 +100bp",
        assumption: "test",
        shockPct: { value: -1, unit: "%", asOf, source: "engine" },
        pnlWon: { value: -1000, unit: "KRW", asOf, source: "engine", currency: "KRW" },
      },
      {
        id: "b",
        label: "주식 -20%",
        assumption: "test",
        shockPct: { value: -8, unit: "%", asOf, source: "engine" },
        pnlWon: { value: -8000, unit: "KRW", asOf, source: "engine", currency: "KRW" },
      },
    ],
    waterfall: {
      pretaxEnding: { value: 1e9, unit: "KRW", asOf, source: "engine", currency: "KRW" },
      expectedTax: { value: 1e7, unit: "KRW", asOf, source: "engine", currency: "KRW" },
      productCost: { value: 1e6, unit: "KRW", asOf, source: "engine", currency: "KRW" },
      afterTaxEnding: { value: 9.89e8, unit: "KRW", asOf, source: "engine", currency: "KRW" },
    },
  };
  b = applyCalcSnapshot(b, {
    consultationInput: "해외주식만",
    ipsExtract: {},
    calcConfig: defaultCalcConfig(),
    calcResults,
    inputHash: "aa",
    settingsHash: "bb",
    resultHash: "cc",
    citations: [
      { sourceId: "eng-risk-parametric", title: "VaR", asOf: "2026-08-01", chunkId: "risk-engine-v1" },
      { sourceId: "eng-tax-waterfall", title: "tax", asOf: "2026-08-01", chunkId: "tax-projection-v1" },
      { sourceId: "eng-stress-scenarios", title: "stress", asOf: "2026-08-01", chunkId: "stress-scenarios-v1" },
    ],
  });
  return b;
}

describe("PB approve gate", () => {
  it("조건 충족 시 PB 승인하면 locked로 전환", () => {
    let b = readyBundle();
    assert.equal(b.judge?.passed, true);
    assert.equal(b.citation?.passed, true);
    assert.equal(canLock(b), true);
    b = approveByPb(b, "PB");
    assert.equal(b.status, "locked");
    assert.equal(canIssueClientPdf(b.status), true);
    assert.equal(b.pendingReasons.length, 0);
  });

  it("이미 review여도 조건 충족이면 locked로 전환 (고착 방지)", () => {
    let b = readyBundle();
    b = transitionStatus(b, "review", "PB", "검토");
    assert.equal(b.status, "review");
    b = approveByPb(b, "PB");
    assert.equal(b.status, "locked");
  });

  it("Judge/인용 실패 시 locked 불가", () => {
    let b = emptyBundle("c1");
    b = applyJudge(b, failJudge, "engine");
    assert.equal(approveByPb(b).status, "blocked");
    assert.equal(canLock(b), false);

    b = emptyBundle("c2");
    b = applyJudge(b, passJudge, "engine");
    b = attachCitations(b, [{ sourceId: "", title: "x", asOf: "", chunkId: "" }]);
    assert.equal(b.status, "blocked");
    assert.notEqual(approveByPb(b).status, "locked");
  });

  it("준비 미완이면 review + pendingReasons (no-op 아님)", () => {
    let b = emptyBundle("c1");
    b = approveByPb(b, "PB");
    assert.equal(b.status, "review");
    assert.ok(b.pendingReasons.length > 0);
    assert.ok(softLockReasons(b).length > 0);
    // 두 번째 승인해도 review에 고착만 하지 않고 이력이 남음
    const before = b.approvals.length;
    b = approveByPb(b, "PB");
    assert.equal(b.status, "review");
    assert.ok(b.approvals.length > before);
    assert.notEqual(b.status, "locked");
  });

  it("충돌 감사 hard fail이면 locked 불가", () => {
    let b = readyBundle();
    b = {
      ...b,
      conflict: { passed: false, needsReview: false, conflicts: ["선호 불일치"], message: "충돌 감사 실패" },
    };
    assert.equal(canLock(b), false);
    const next = approveByPb(b);
    assert.equal(next.status, "blocked");
  });
});

describe("pipeline steps", () => {
  it("pipeline approve 단계가 review에만 고정되지 않음", () => {
    const client: Client = {
      id: "c1",
      code: "C-1",
      clientType: "individual",
      name: "테스트",
      birthDate: "1980-01-01",
      assignedPbId: "PB-001",
      assetSize: 1_000_000_000,
      consultationNotes: "해외주식만",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    client.ips.return = { ...client.ips.return, value: "10%", status: "explicit", reviewed: true };

    let b = readyBundle();
    b = approveByPb(b);
    assert.equal(b.status, "locked");
    const steps = buildPipeline(client, b);
    const approve = steps.find((s) => s.id === "approve");
    assert.equal(approve?.state, "complete");
    assert.equal(pipelineMatchesStatus(steps, "locked"), true);
    assert.notEqual(currentPipelineStep(steps).state, "review");
  });

  it("judgeCalcResults는 메타 있으면 통과", () => {
    const asOf = "2026-08-01T00:00:00.000Z";
    const risk = buildRiskMetrics({ expectedReturnPct: 8, volatilityPct: 12, mddPct: -10, asOf });
    const j = judgeCalcResults({
      risk,
      stress: [
        { id: "1", label: "a", assumption: "x", shockPct: { value: 1, unit: "%", asOf, source: "e" }, pnlWon: { value: 1, unit: "KRW", asOf, source: "e", currency: "KRW" } },
        { id: "2", label: "b", assumption: "x", shockPct: { value: 1, unit: "%", asOf, source: "e" }, pnlWon: { value: 1, unit: "KRW", asOf, source: "e", currency: "KRW" } },
      ],
      waterfall: null,
    });
    assert.equal(j.passed, true);
  });
});
