import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyBundle, canIssueClientPdf, canLock, transitionStatus, applyJudge, attachCitations, attachConflict, approveByPb, judgeRecommend, judgeCalcResults, softLockReasons, applyCalcSnapshot, appendRun, defaultCalcConfig, migrateBundle, loadBundle, loadArchivedBundles, saveBundle, startNewReviewVersion } from "./control";
import { sha256HexSync, stableStringify } from "./hash";
import { buildRiskMetrics } from "./riskEngine";
import { evaluateGoldSet } from "./goldSet";
import { judgeCitations } from "./citations";
import { JUDGE_MAX_RETRIES } from "./constants";
import { buildPipeline, pipelineMatchesStatus } from "./pipeline";
import { buildRecommendResult } from "./recommend";
import { parseAdvisoryConstraints } from "./constraints";
import {
  advisoryInputHash,
  legacyAdvisoryInputHash,
  needsLegacyAdvisoryInputHashRefresh,
  verifyEvidenceAgainstClient,
} from "./integrity";
import { syncEvidenceAfterIpsApproval } from "./workflowEvidenceSync";
import { hashObject } from "./hash";
import type { CalcResults, EvidenceBundle, JudgeResult, RecommendResult } from "./types";
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

interface MemoryStorageHooks {
  beforeGet?: (key: string, count: number, values: Map<string, string>) => void;
  beforeSet?: (key: string, value: string, count: number, values: Map<string, string>) => void;
  failSet?: (key: string, value: string) => boolean;
  silentSet?: (key: string, value: string, count: number) => boolean;
}

function createMemoryStorage(hooks: MemoryStorageHooks = {}): Storage {
  const values = new Map<string, string>();
  const getCounts = new Map<string, number>();
  const setCounts = new Map<string, number>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      const count = (getCounts.get(key) ?? 0) + 1;
      getCounts.set(key, count);
      hooks.beforeGet?.(key, count, values);
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      const count = (setCounts.get(key) ?? 0) + 1;
      setCounts.set(key, count);
      hooks.beforeSet?.(key, value, count, values);
      if (hooks.failSet?.(key, value)) throw new Error(`storage write failed: ${key}`);
      if (hooks.silentSet?.(key, value, count)) return;
      values.set(key, value);
    },
  };
}

const LEGACY_CURRENT_KEY = "pb-advisory-evidence-v1";
const CURRENT_KEY_PREFIX = "pb-advisory-evidence-current-v2:";
const ARCHIVE_RECORD_PREFIX = "pb-advisory-evidence-archive-v2:";
const CLIENT_LOCK_PREFIX = "pb-advisory-evidence-lock-v2:";

function currentStorageKey(clientId: string): string {
  return `${CURRENT_KEY_PREFIX}${encodeURIComponent(clientId)}`;
}

function archiveStoragePrefix(clientId: string): string {
  return `${ARCHIVE_RECORD_PREFIX}${encodeURIComponent(clientId)}:`;
}

function lockStoragePrefix(clientId: string): string {
  return `${CLIENT_LOCK_PREFIX}${encodeURIComponent(clientId)}:`;
}

function withInstalledStorage<T>(storage: Storage, run: (storage: Storage) => T): T {
  const runtime = globalThis as unknown as { window?: { localStorage: Storage } };
  const previousWindow = runtime.window;
  runtime.window = { localStorage: storage };
  try {
    return run(storage);
  } finally {
    if (previousWindow) runtime.window = previousWindow;
    else delete runtime.window;
  }
}

function withMemoryStorage<T>(run: (storage: Storage) => T): T {
  return withInstalledStorage(createMemoryStorage(), run);
}

describe("advisory control gates", () => {
  it("blocked cannot become locked", () => {
    let b = emptyBundle("c1");
    b = applyJudge(b, failJudge, "engine");
    assert.equal(b.status, "blocked");
    const next = transitionStatus(b, "locked", "PB", "force");
    assert.equal(next.status, "blocked");
    assert.equal(canLock(b), false);
    assert.equal(canIssueClientPdf(b), false);
  });

  it("Judge 실패 시 고객용 PDF 발행 불가", () => {
    let b = emptyBundle("c1");
    b.status = "review";
    b = applyJudge(b, failJudge, "engine");
    assert.equal(canIssueClientPdf(b), false);
    b = approveByPb(b);
    assert.notEqual(b.status, "locked");
  });

  it("locked 상태만으로는 부족하고 현재 Evidence 게이트까지 충족해야 PDF 가능", () => {
    const incomplete = emptyBundle("c1");
    incomplete.status = "locked";
    assert.equal(canIssueClientPdf(incomplete), false);

    const complete = approveByPb(readyBundle(), "PB");
    assert.equal(complete.status, "locked");
    assert.equal(canIssueClientPdf(complete), true);
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
    assert.equal(canIssueClientPdf(b), false);
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

  it("추천 Judge·인용만 통과하고 결정론 계산 스냅샷이 없으면 locked 불가", () => {
    let b = emptyBundle("c1");
    b = applyJudge(b, passJudge, "recommend-engine");
    b = attachCitations(b, [
      { sourceId: "catalog", title: "교육용 추천 카탈로그", asOf: "2026-08-01", chunkId: "catalog-v1" },
    ]);

    assert.equal(b.calcResults, null);
    assert.equal(canLock(b), false);

    b = approveByPb(b, "PB");
    assert.equal(b.status, "review");
    assert.ok(b.pendingReasons.some((reason) => reason.includes("계산 스냅샷")));
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
  it("신탁만과 랩/일임만 제약을 서로 다른 상품 구조로 분류", () => {
    assert.equal(parseAdvisoryConstraints("신탁만 검토").categoryOnly, "trust");
    assert.equal(parseAdvisoryConstraints("랩만 검토").categoryOnly, "wrap");
    assert.equal(parseAdvisoryConstraints("일임형만 검토").categoryOnly, "wrap");
  });

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

  it("최소 기대수익률 proxy 조건 미달 상품은 후보에서 제외하고 Judge가 누수를 차단", () => {
    const client: Client = {
      id: "return-filter-client",
      code: "C-RETURN",
      clientType: "individual",
      name: "기대수익 조건 테스트",
      birthDate: "1980-01-01",
      assignedPbId: "PB-001",
      assetSize: 1_000_000_000,
      consultationNotes: "",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const result = buildRecommendResult(client, "기대수익률 20% 이상", "2026-08-01T00:00:00.000Z");

    assert.equal(result.plans.every((plan) => plan.products.length === 0), true);
    assert.equal(result.plans.every((plan) => plan.constraintNote.includes("후보 없음")), true);
    assert.equal(judgeRecommend(result).passed, true);

    const leaked = buildRecommendResult(client, "", "2026-08-01T00:00:00.000Z");
    leaked.constraints.minExpectedReturn = 20;
    leaked.constraints.tags.push("기대수익률 20% 이상");
    assert.equal(judgeRecommend(leaked).passed, false);

    const overseasOnly = buildRecommendResult(client, "해외주식만", "2026-08-01T00:00:00.000Z");
    assert.equal(
      overseasOnly.plans.every((plan) =>
        plan.products.every((product) =>
          product.isOverseas === true && (product.category === "stock" || product.category === "etf"),
        ),
      ),
      true,
    );
    assert.equal(judgeRecommend(overseasOnly).passed, true);

    const overseasLeak = buildRecommendResult(client, "", "2026-08-01T00:00:00.000Z");
    overseasLeak.constraints.overseasOnly = true;
    overseasLeak.constraints.tags.push("해외주식만");
    assert.equal(judgeRecommend(overseasLeak).passed, false);

    const contradictory = buildRecommendResult(client, "신탁만 검토, 해외주식만", "2026-08-01T00:00:00.000Z");
    assert.equal(contradictory.plans.every((plan) => plan.products.length === 0), true);
    assert.equal(judgeRecommend(contradictory).passed, true);
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
  it("조건 충족 시 PB 상담 검토 승인하면 locked로 전환", () => {
    let b = readyBundle();
    assert.equal(b.judge?.passed, true);
    assert.equal(b.citation?.passed, true);
    assert.equal(canLock(b), true);
    b = approveByPb(b, "PB");
    assert.equal(b.status, "locked");
    assert.equal(canIssueClientPdf(b), true);
    assert.equal(b.pendingReasons.length, 0);
  });

  it("추천 실행 이력을 추가해도 locked Evidence 핵심 해시·승인 상태는 변하지 않음", () => {
    const locked = approveByPb(readyBundle(), "PB");
    const next = appendRun(locked, {
      kind: "recommend",
      engine: "deterministic-catalog",
      inputHash: "recommend-input",
      outputHash: "recommend-output",
      notes: "교육용 추천 실행",
    });

    assert.equal(next.status, "locked");
    assert.equal(next.updatedAt, locked.updatedAt);
    assert.equal(next.inputHash, locked.inputHash);
    assert.equal(next.settingsHash, locked.settingsHash);
    assert.equal(next.resultHash, locked.resultHash);
    assert.equal(next.outputHash, locked.outputHash);
    assert.deepEqual(next.approvals, locked.approvals);
    assert.equal(next.runs.length, locked.runs.length + 1);
    assert.equal(canIssueClientPdf(next), true);
  });

  it("locked Evidence에는 새 계산 스냅샷을 덮어쓸 수 없음", () => {
    const ready = readyBundle();
    const locked = approveByPb(ready, "PB");
    assert.ok(ready.calcResults);
    assert.ok(ready.calcConfig);
    const next = applyCalcSnapshot(locked, {
      consultationInput: "사후 변경 시도",
      ipsExtract: { changed: true },
      calcConfig: ready.calcConfig,
      calcResults: ready.calcResults,
      inputHash: "mutated-input",
      settingsHash: "mutated-settings",
      resultHash: "mutated-result",
      citations: ready.citations,
    });

    assert.deepEqual(next, locked);
    assert.equal(canIssueClientPdf(next), true);
  });

  it("locked Evidence의 Judge·인용·충돌·상태·승인은 제어 함수로 사후 변경할 수 없음", () => {
    const locked = approveByPb(readyBundle(), "PB");
    const changedCitation = [{ sourceId: "new", title: "새 근거", asOf: "2026-08-22", chunkId: "new-v1" }];
    const attempts = [
      applyJudge(locked, failJudge, "engine"),
      attachCitations(locked, changedCitation),
      attachConflict(locked, { passed: false, needsReview: false, conflicts: ["사후 충돌"], message: "사후 충돌" }),
      transitionStatus(locked, "review", "PB", "사후 변경"),
      approveByPb(locked, "PB"),
    ];

    for (const next of attempts) {
      assert.deepEqual(next, locked);
      assert.equal(canIssueClientPdf(next), true);
    }
  });

  it("migrateBundle 단독 호출은 과거 locked 원본의 ID·상태를 바꾸지 않음", () => {
    const legacy = emptyBundle("legacy-client");
    legacy.status = "locked";
    const migrated = migrateBundle(legacy, "legacy-client");

    assert.equal(migrated.id, legacy.id);
    assert.equal(migrated.status, "locked");
    assert.equal(canIssueClientPdf(migrated), false);
    assert.deepEqual(legacy.approvals, []);
  });

  it("구형 locked 원문을 먼저 정확히 보존하고 새 ID review를 현재본으로 만듦", () => {
    withMemoryStorage((storage) => {
      const legacy = emptyBundle("legacy-locked-client");
      legacy.status = "locked";
      const original = structuredClone(legacy);
      storage.setItem("pb-advisory-evidence-v1", JSON.stringify({ [legacy.clientId]: legacy }));

      const next = loadBundle(legacy.clientId);

      assert.equal(next.status, "review");
      assert.notEqual(next.id, legacy.id);
      assert.equal(next.previousBundleId, legacy.id);
      assert.equal(next.version, legacy.version + 1);
      assert.equal(next.approvals[0]?.actor, "migration");
      assert.deepEqual(loadArchivedBundles(legacy.clientId), [original]);
      const persisted = JSON.parse(storage.getItem("pb-advisory-evidence-v1") ?? "{}") as Record<string, EvidenceBundle>;
      assert.deepEqual(persisted[legacy.clientId], next);
      assert.deepEqual(legacy, original);
    });
  });

  it("구형 blocked 원문도 필드 보정 전에 정확히 보존하고 별도 review를 생성", () => {
    withMemoryStorage((storage) => {
      const complete = {
        ...emptyBundle("legacy-blocked-client"),
        status: "blocked" as const,
        blockReasons: ["과거 고객 제안 차단 사유"],
      };
      const legacy = structuredClone(complete) as Partial<EvidenceBundle> & Pick<EvidenceBundle, "id" | "clientId" | "status">;
      delete legacy.version;
      delete legacy.previousBundleId;
      const exactOriginal = structuredClone(legacy);
      storage.setItem("pb-advisory-evidence-v1", JSON.stringify({ [legacy.clientId]: legacy }));

      const next = loadBundle(legacy.clientId);

      assert.equal(next.status, "review");
      assert.notEqual(next.id, legacy.id);
      assert.equal(next.previousBundleId, legacy.id);
      assert.equal(next.version, 2);
      assert.ok(next.pendingReasons.includes("과거 고객 제안 차단 사유"));
      assert.deepEqual(loadArchivedBundles(legacy.clientId), [exactOriginal]);
    });
  });

  it("구형 final archive 저장 실패 시 현재본을 한 글자도 교체하지 않음", () => {
    const storage = createMemoryStorage({
      failSet: (key) => key.startsWith(ARCHIVE_RECORD_PREFIX),
    });
    const legacy = emptyBundle("legacy-archive-failure");
    legacy.status = "locked";
    const exactOriginal = structuredClone(legacy);
    storage.setItem("pb-advisory-evidence-v1", JSON.stringify({ [legacy.clientId]: legacy }));

    withInstalledStorage(storage, () => {
      const result = loadBundle(legacy.clientId);
      assert.equal(result.id, legacy.id);
      assert.equal(result.status, "locked");
    });

    const persisted = JSON.parse(storage.getItem("pb-advisory-evidence-v1") ?? "{}") as Record<string, EvidenceBundle>;
    assert.deepEqual(persisted[legacy.clientId], exactOriginal);
    assert.equal(storage.getItem("pb-advisory-evidence-archive-v1"), null);
  });

  it("구형 final migration 잠금 직전 최신본이 바뀌면 stale 원본을 보존·교체하지 않음", () => {
    const legacy = emptyBundle("legacy-stale-client");
    legacy.status = "locked";
    const newer = {
      ...legacy,
      id: `${legacy.id}-newer`,
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    const storage = createMemoryStorage({
      beforeSet: (writeKey, _value, count, values) => {
        // 최초 legacy 읽기 후 client lock을 얻는 순간 다른 탭의 v2 현재본을 반영한다.
        if (writeKey.startsWith(lockStoragePrefix(legacy.clientId)) && count === 1) {
          values.set(currentStorageKey(legacy.clientId), JSON.stringify(newer));
        }
      },
    });
    storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [legacy.clientId]: legacy }));

    withInstalledStorage(storage, () => {
      const staleView = loadBundle(legacy.clientId);
      assert.equal(staleView.id, newer.id);
    });

    const persisted = JSON.parse(storage.getItem(currentStorageKey(legacy.clientId)) ?? "null") as EvidenceBundle;
    assert.deepEqual(persisted, newer);
    withInstalledStorage(storage, () => {
      assert.deepEqual(loadArchivedBundles(legacy.clientId), []);
    });
  });

  it("구형 final load를 반복해도 archive·새 검토본을 중복 생성하지 않음", () => {
    withMemoryStorage((storage) => {
      const legacy = emptyBundle("legacy-repeat-client");
      legacy.status = "locked";
      storage.setItem("pb-advisory-evidence-v1", JSON.stringify({ [legacy.clientId]: legacy }));

      const first = loadBundle(legacy.clientId);
      const second = loadBundle(legacy.clientId);

      assert.equal(second.id, first.id);
      assert.equal(second.version, first.version);
      assert.equal(second.previousBundleId, legacy.id);
      assert.equal(loadArchivedBundles(legacy.clientId).length, 1);
      assert.deepEqual(loadArchivedBundles(legacy.clientId)[0], legacy);
    });
  });

  it("archive에 같은 ID의 다른 원문이 있으면 기존 archive·현재 final을 덮어쓰지 않음", () => {
    withMemoryStorage((storage) => {
      const legacy = emptyBundle("legacy-archive-collision");
      legacy.status = "locked";
      const conflicting = { ...legacy, consultationInput: "서로 다른 보존 원문" };
      storage.setItem("pb-advisory-evidence-v1", JSON.stringify({ [legacy.clientId]: legacy }));
      storage.setItem("pb-advisory-evidence-archive-v1", JSON.stringify({ [legacy.clientId]: [conflicting] }));

      const result = loadBundle(legacy.clientId);

      assert.equal(result.id, legacy.id);
      assert.equal(result.status, "locked");
      const current = JSON.parse(storage.getItem("pb-advisory-evidence-v1") ?? "{}") as Record<string, EvidenceBundle>;
      assert.deepEqual(current[legacy.clientId], legacy);
      assert.deepEqual(loadArchivedBundles(legacy.clientId), [conflicting]);
    });
  });

  it("고객별 스냅샷 archive는 다른 고객의 동시 보존 레코드를 지우지 않음", () => {
    const clientA = "archive-race-a";
    const clientB = "archive-race-b";
    const finalA = { ...emptyBundle(clientA), id: "final-a", status: "locked" as const };
    const finalB = { ...emptyBundle(clientB), id: "final-b", status: "blocked" as const };
    const concurrentKey = `${archiveStoragePrefix(clientB)}concurrent-record`;
    const storage = createMemoryStorage({
      beforeSet: (key, _value, count, values) => {
        if (key.startsWith(archiveStoragePrefix(clientA)) && count === 1) {
          values.set(concurrentKey, JSON.stringify({
            archivedAt: "2026-08-23T00:00:00.000Z",
            fingerprint: "concurrent",
            snapshot: finalB,
          }));
        }
      },
    });
    storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientA]: finalA }));

    withInstalledStorage(storage, () => {
      const result = startNewReviewVersion(finalA);
      assert.equal(result.ok, true);
      assert.deepEqual(loadArchivedBundles(clientA), [finalA]);
      assert.deepEqual(loadArchivedBundles(clientB), [finalB]);
    });
  });

  it("동시 쓰기 contender가 있으면 ticket·token 우선순위로 한 쓰기만 진입", () => {
    const clientId = "two-writer-client";
    const finalBundle = { ...emptyBundle(clientId), id: "two-writer-final", status: "locked" as const };
    let injectedKey = "";
    let didInject = false;
    const storage = createMemoryStorage({
      beforeSet: (key, value, count, values) => {
        if (didInject || !key.startsWith(lockStoragePrefix(clientId)) || count !== 2) return;
        didInject = true;
        const own = JSON.parse(value) as { ticket: number; expiresAt: number };
        injectedKey = `${lockStoragePrefix(clientId)}000-earlier-writer`;
        values.set(injectedKey, JSON.stringify({
          token: "000-earlier-writer",
          choosing: false,
          ticket: own.ticket,
          expiresAt: own.expiresAt,
        }));
      },
    });
    storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientId]: finalBundle }));

    withInstalledStorage(storage, () => {
      const losingWriter = startNewReviewVersion(finalBundle);
      assert.equal(losingWriter.ok, false);
      assert.deepEqual(loadArchivedBundles(clientId), []);
      assert.deepEqual(loadBundle(clientId), finalBundle);

      storage.removeItem(injectedKey);
      const winningRetry = startNewReviewVersion(finalBundle);
      assert.equal(winningRetry.ok, true);
      assert.equal(winningRetry.bundle.status, "draft");
      assert.deepEqual(loadArchivedBundles(clientId), [finalBundle]);
    });
  });

  it("잠금 contender를 안전하게 읽지 못하면 무경쟁으로 간주하지 않고 fail-closed", () => {
    const clientId = "malformed-lock-client";
    const finalBundle = { ...emptyBundle(clientId), id: "malformed-lock-final", status: "locked" as const };
    withMemoryStorage((storage) => {
      storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientId]: finalBundle }));
      storage.setItem(`${lockStoragePrefix(clientId)}unreadable`, "{not-json");

      const result = startNewReviewVersion(finalBundle);
      assert.equal(result.ok, false);
      assert.deepEqual(loadArchivedBundles(clientId), []);
      const persisted = JSON.parse(storage.getItem(LEGACY_CURRENT_KEY) ?? "{}") as Record<string, EvidenceBundle>;
      assert.deepEqual(persisted[clientId], finalBundle);
    });
  });

  it("새 검토본 현재 포인터 쓰기가 조용히 실패하면 성공으로 보고하지 않음", () => {
    const clientId = "silent-current-failure";
    const finalBundle = { ...emptyBundle(clientId), id: "silent-final", status: "locked" as const };
    const storage = createMemoryStorage({
      silentSet: (key) => key === currentStorageKey(clientId),
    });
    storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientId]: finalBundle }));

    withInstalledStorage(storage, () => {
      const result = startNewReviewVersion(finalBundle);
      assert.equal(result.ok, false);
      assert.equal(result.bundle.id, finalBundle.id);
      assert.deepEqual(loadArchivedBundles(clientId), [finalBundle]);
      assert.deepEqual(loadBundle(clientId), finalBundle);
    });
    const legacy = JSON.parse(storage.getItem(LEGACY_CURRENT_KEY) ?? "{}") as Record<string, EvidenceBundle>;
    assert.deepEqual(legacy[clientId], finalBundle);
  });

  it("stale draft/review의 일반 save가 최신 locked/blocked 현재본을 덮어쓰지 못함", () => {
    withMemoryStorage(() => {
      const ready = readyBundle();
      assert.equal(saveBundle(ready), true);
      const locked = approveByPb(ready, "PB");
      assert.equal(locked.status, "locked");
      assert.equal(saveBundle(locked), true);

      const staleDraft = {
        ...ready,
        consultationInput: "오래된 탭의 draft가 final을 덮어쓰려는 시도",
      };
      assert.equal(saveBundle(staleDraft), false);
      assert.equal(saveBundle(locked), true, "동일 final의 멱등 저장은 허용");
      assert.deepEqual(loadBundle(locked.clientId), JSON.parse(JSON.stringify(locked)));
    });
  });

  it("손상된 v2 현재본이 있으면 오래된 legacy로 fallback하여 덮어쓰지 않음", () => {
    const clientId = "corrupt-v2-client";
    const legacyFinal = { ...emptyBundle(clientId), id: "legacy-final", status: "blocked" as const };
    withMemoryStorage((storage) => {
      storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientId]: legacyFinal }));
      storage.setItem(currentStorageKey(clientId), "{corrupt-json");

      const result = startNewReviewVersion(legacyFinal);
      assert.equal(result.ok, false);
      assert.equal(saveBundle({ ...legacyFinal, status: "draft" }), false);
      assert.equal(storage.getItem(currentStorageKey(clientId)), "{corrupt-json");
      assert.deepEqual(loadArchivedBundles(clientId), []);
    });
  });

  it("새 Evidence ID가 기존 archive ID와 겹치면 충돌 없는 ID를 사용", () => {
    const realNow = Date.now;
    try {
      Date.now = () => 1_000;
      const clientId = "id-collision-client";
      const generatedId = `evb-${clientId.slice(0, 8)}-${(1_000).toString(36)}`;
      const finalBundle = { ...emptyBundle(clientId), id: "current-final-id", status: "locked" as const };
      const olderArchived = {
        ...emptyBundle(clientId),
        id: generatedId,
        status: "locked" as const,
        consultationInput: "기존 archive",
      };

      withMemoryStorage((storage) => {
        storage.setItem(LEGACY_CURRENT_KEY, JSON.stringify({ [clientId]: finalBundle }));
        storage.setItem("pb-advisory-evidence-archive-v1", JSON.stringify({ [clientId]: [olderArchived] }));

        const result = startNewReviewVersion(finalBundle);
        assert.equal(result.ok, true);
        assert.notEqual(result.bundle.id, generatedId);
        const ids = [result.bundle, ...loadArchivedBundles(clientId)].map((bundle) => bundle.id);
        assert.equal(new Set(ids).size, ids.length);
      });
    } finally {
      Date.now = realNow;
    }
  });

  it("Evidence 결과 해시가 어긋나면 고객 제안 차단", () => {
    const tampered = { ...readyBundle(), outputHash: "tampered-output" };
    assert.equal(canLock(tampered), false);
    const next = approveByPb(tampered, "PB");
    assert.equal(next.status, "blocked");
    assert.ok(next.blockReasons.some((reason) => reason.includes("해시 불일치")));
  });

  it("서버 무결성 검증은 승인 후 고객 입력·계산값 변경을 탐지", () => {
    const client: Client = {
      id: "c1",
      code: "C-1",
      clientType: "individual",
      name: "무결성 테스트",
      birthDate: "1980-01-01",
      assignedPbId: "PB-001",
      linkedClientId: "linked-c1",
      ownershipPct: 51,
      isMajorityShareholder: true,
      accountSeparation: "separated",
      assetSize: 1_000_000_000,
      consultationNotes: "원본 상담",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const inputContext = { assignedPbDisplay: "김삼성 PB" };
    const ready = readyBundle();
    assert.ok(ready.calcConfig);
    assert.ok(ready.calcResults);
    const resultHash = hashObject(ready.calcResults);
    const prepared = {
      ...ready,
      inputHash: advisoryInputHash(client, inputContext),
      settingsHash: hashObject(ready.calcConfig),
      resultHash,
      outputHash: resultHash,
    };
    const locked = approveByPb(prepared, "PB");
    assert.equal(verifyEvidenceAgainstClient(locked, client, inputContext).verified, true);

    const changedInputs: Array<[string, Client]> = [
      ["고객 이름", { ...client, name: "변경된 이름" }],
      ["고객 코드", { ...client, code: "C-CHANGED" }],
      ["생년월일", { ...client, birthDate: "1981-01-01" }],
      ["담당 PB ID", { ...client, assignedPbId: "PB-002" }],
      ["연결 고객", { ...client, linkedClientId: "linked-c2" }],
      ["계좌 분리", { ...client, accountSeparation: "mixed" }],
      ["지분율", { ...client, ownershipPct: 49 }],
      ["최대주주 여부", { ...client, isMajorityShareholder: false }],
    ];
    for (const [label, changedClient] of changedInputs) {
      assert.equal(
        verifyEvidenceAgainstClient(locked, changedClient, inputContext).verified,
        false,
        `${label} 변경을 탐지해야 함`,
      );
    }
    assert.equal(
      verifyEvidenceAgainstClient(locked, client, { assignedPbDisplay: "변경된 PB 이름" }).verified,
      false,
      "PDF에 표시되는 담당 PB 이름 변경을 탐지해야 함",
    );

    // 상담 메모는 계산 입력이 아니므로 무결성을 깨뜨리지 않는다. 예전에는 여기에 걸려
    // 상담 종료 시 메모를 저장하는 것만으로 최종 PDF 가 막혔다.
    assert.equal(
      verifyEvidenceAgainstClient(locked, { ...client, consultationNotes: "메모만 수정" }, inputContext)
        .verified,
      true,
      "상담 메모 변경은 탐지 대상이 아니어야 함",
    );

    const changedEvidence = structuredClone(locked);
    if (changedEvidence.calcResults) changedEvidence.calcResults.risk.expectedReturn.value = 99;
    assert.equal(verifyEvidenceAgainstClient(changedEvidence, client, inputContext).verified, false);
  });

  it("3단계 IPS 승인 시 현재 입력으로 Evidence를 재생성해 PDF 게이트를 연다", () => {
    withMemoryStorage(() => {
      const client: Client = {
        id: "c1",
        code: "C-1",
        clientType: "individual",
        name: "승인 테스트",
        birthDate: "1980-01-01",
        assignedPbId: "PB-001",
        assetSize: 1_000_000_000,
        consultationNotes: "승인 후 저장된 상담 메모",
        ips: emptyIPS(),
        cashFlows: [],
        portfolios: [],
        stages: {
          basic: true,
          factors: true,
          cashflow: true,
          portfolio: true,
          stress: true,
          ips: true,
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const inputContext = { assignedPbDisplay: "김삼성 PB" };
      const oldHash = legacyAdvisoryInputHash(client, inputContext);
      const oldLocked = approveByPb({ ...readyBundle(), inputHash: oldHash }, "PB");
      assert.equal(saveBundle(oldLocked), true);
      assert.equal(needsLegacyAdvisoryInputHashRefresh(oldHash, client, inputContext), true);

      const refreshed = syncEvidenceAfterIpsApproval(client, inputContext);

      assert.equal(refreshed.status, "locked");
      assert.equal(refreshed.inputHash, advisoryInputHash(client, inputContext));
      assert.equal(refreshed.outputHash, refreshed.resultHash);
      assert.equal(canIssueClientPdf(refreshed), true);
      assert.equal(verifyEvidenceAgainstClient(refreshed, client, inputContext).verified, true);
      assert.notEqual(refreshed.id, oldLocked.id);
      assert.ok(loadArchivedBundles(client.id).some((archived) => archived.id === oldLocked.id));
    });
  });

  it("실제 고객 입력이 바뀐 경우에는 구형 해시 마이그레이션으로 오인하지 않는다", () => {
    const client: Client = {
      id: "c1",
      code: "C-1",
      clientType: "individual",
      name: "원래 이름",
      birthDate: "1980-01-01",
      assignedPbId: "PB-001",
      assetSize: 1_000_000_000,
      consultationNotes: "메모",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const inputContext = { assignedPbDisplay: "김삼성 PB" };
    const oldHash = legacyAdvisoryInputHash(client, inputContext);
    assert.equal(
      needsLegacyAdvisoryInputHashRefresh(oldHash, { ...client, name: "변경된 이름" }, inputContext),
      false,
    );
  });

  it("locked/blocked 원본을 정확히 보존한 뒤 새 draft 버전을 시작", () => {
    withMemoryStorage((storage) => {
      for (const status of ["locked", "blocked"] as const) {
        storage.clear();
        const finalBundle =
          status === "locked"
            ? approveByPb(readyBundle(), "PB")
            : {
                ...readyBundle(),
                status: "blocked" as const,
                blockReasons: ["테스트 고객 제안 차단"],
              };
        const original = structuredClone(finalBundle);
        const persistedOriginal = JSON.parse(JSON.stringify(original)) as typeof original;
        assert.equal(saveBundle(finalBundle), true);

        const result = startNewReviewVersion(finalBundle, "PB");
        assert.equal(result.ok, true);
        assert.equal(result.archivedBundleId, finalBundle.id);
        assert.deepEqual(finalBundle, original, `${status} 원본 객체가 변하면 안 됨`);
        assert.deepEqual(loadArchivedBundles(finalBundle.clientId)[0], persistedOriginal);
        assert.notEqual(result.bundle.id, finalBundle.id);
        assert.equal(result.bundle.status, "draft");
        assert.equal(result.bundle.version, finalBundle.version + 1);
        assert.equal(result.bundle.previousBundleId, finalBundle.id);
        assert.equal(result.bundle.calcResults, null);
        assert.equal(result.bundle.judge, null);
        assert.equal(result.bundle.inputHash, "");
        assert.equal(result.bundle.outputHash, "");
        assert.deepEqual(result.bundle.blockReasons, []);
      }
    });
  });

  it("draft/review 및 stale final에서는 새 검토본 시작을 거부", () => {
    withMemoryStorage(() => {
      const draft = emptyBundle("draft-client");
      assert.equal(startNewReviewVersion(draft).ok, false);
      assert.equal(startNewReviewVersion({ ...draft, status: "review" }).ok, false);

      const oldFinal = approveByPb(readyBundle(), "PB");
      const newerFinal = { ...oldFinal, id: `${oldFinal.id}-newer` };
      assert.equal(saveBundle(newerFinal), true);
      const staleResult = startNewReviewVersion(oldFinal, "PB");
      assert.equal(staleResult.ok, false);
      assert.equal(loadArchivedBundles(oldFinal.clientId).length, 0);
    });
  });

  it("이미 review여도 조건 충족이면 locked로 전환 (고착 방지)", () => {
    let b = readyBundle();
    b = transitionStatus(b, "review", "PB", "검토");
    assert.equal(b.status, "review");
    b = approveByPb(b, "PB");
    assert.equal(b.status, "locked");
  });

  it("review 상태에서 Evidence를 재생성해도 PB 상담 검토 승인 전에는 locked가 되지 않는다", () => {
    let b = emptyBundle("c1");
    b = transitionStatus(b, "review", "PB", "검토만");
    assert.equal(b.status, "review");
    // readyBundle의 applyCalcSnapshot 경로를 재현
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
    assert.equal(b.status, "review");
    assert.equal(canLock(b), true);
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
  it("기본정보·포트폴리오 stages로 파이프라인 1~6을 완료한다", () => {
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
      portfolios: [{
        id: "p1",
        label: "성장형",
        allocations: [
          { assetClass: "해외주식", weight: 60 },
          { assetClass: "채권", weight: 40 },
        ],
        expectedReturn: 8,
        expectedRisk: 12,
        taxNote: "테스트",
        rationale: "파이프라인 테스트용 포트폴리오",
        editedByPb: false,
      }],
      stages: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    client.ips.return = { ...client.ips.return, value: "10%", status: "explicit", reviewed: true };

    let b = readyBundle();
    b = transitionStatus(b, "review", "PB", "검토");
    let steps = buildPipeline(client, b);
    assert.equal(steps.find((s) => s.id === "approve")?.state, "review");
    assert.notEqual(steps.find((s) => s.id === "portfolio")?.state, "complete");

    client.stages = { basic: true, factors: true, cashflow: true };
    steps = buildPipeline(client, b);
    assert.equal(steps.find((s) => s.id === "consult")?.state, "complete");
    assert.equal(steps.find((s) => s.id === "ips")?.state, "complete");
    assert.equal(steps.find((s) => s.id === "approve")?.state, "complete");
    assert.notEqual(steps.find((s) => s.id === "portfolio")?.state, "complete");

    client.stages = { ...client.stages, portfolio: true, stress: true };
    steps = buildPipeline(client, b);
    assert.equal(steps.find((s) => s.id === "portfolio")?.state, "complete");
    assert.equal(steps.find((s) => s.id === "risk")?.state, "complete");
    assert.equal(steps.find((s) => s.id === "tax")?.state, "complete");
    assert.notEqual(steps.find((s) => s.id === "pdf")?.state, "complete");

    client.stages = { ...client.stages, ips: true };
    steps = buildPipeline(client, b);
    assert.equal(steps.find((s) => s.id === "pdf")?.state, "complete");
    assert.equal(pipelineMatchesStatus(steps, "locked"), true);
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
