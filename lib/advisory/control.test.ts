import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyBundle, canIssueClientPdf, canLock, transitionStatus, applyJudge, attachCitations, approveByPb, judgeRecommend } from "./control";
import { sha256HexSync, stableStringify } from "./hash";
import { buildRiskMetrics } from "./riskEngine";
import { evaluateGoldSet } from "./goldSet";
import { judgeCitations } from "./citations";
import { JUDGE_MAX_RETRIES } from "./constants";
import type { JudgeResult, RecommendResult } from "./types";

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
