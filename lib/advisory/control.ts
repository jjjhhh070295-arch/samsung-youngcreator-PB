import {
  JUDGE_MAX_RETRIES,
  PDF_ALLOWED_STATUS,
  RISK_FREE_RATE_PCT,
  VAR_CONFIDENCE,
  ENGINE_SOURCE,
  ENGINE_CURRENCY,
} from "./constants";
import { judgeCitations } from "./citations";
import type {
  AdvisoryStatus,
  CalcConfig,
  CalcResults,
  CitationRef,
  ConflictAudit,
  EvidenceBundle,
  EvidenceRun,
  JudgeFinding,
  JudgeResult,
  RecommendResult,
  TickerSnapshot,
} from "./types";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(input: string): Promise<string> {
  if (typeof window === "undefined") {
    const { createHash } = await import("crypto");
    return createHash("sha256").update(input).digest("hex");
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(buf));
}

export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function newBundleId(clientId: string): string {
  return `evb-${clientId.slice(0, 8)}-${Date.now().toString(36)}`;
}

export function newRunId(clientId: string): string {
  return `run-${clientId.slice(0, 6)}-${Date.now().toString(36)}`;
}

export function defaultCalcConfig(): CalcConfig {
  return {
    horizonYears: 1,
    riskFreeRatePct: RISK_FREE_RATE_PCT,
    varConfidence: VAR_CONFIDENCE,
    currency: ENGINE_CURRENCY,
    engine: ENGINE_SOURCE,
  };
}

export function emptyBundle(clientId: string): EvidenceBundle {
  const now = new Date().toISOString();
  return {
    id: newBundleId(clientId),
    clientId,
    version: 1,
    previousBundleId: null,
    runId: newRunId(clientId),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    consultationInput: "",
    ipsExtract: null,
    calcConfig: defaultCalcConfig(),
    calcResults: null,
    citations: [],
    citation: null,
    conflict: null,
    inputHash: "",
    settingsHash: "",
    resultHash: "",
    outputHash: "",
    judgeAttempts: 0,
    blockReasons: [],
    pendingReasons: [],
    runs: [],
    judge: null,
    approvals: [],
  };
}

export function migrateBundle(raw: EvidenceBundle, clientId: string): EvidenceBundle {
  const base = emptyBundle(clientId);
  return {
    ...base,
    ...raw,
    clientId,
    version: raw.version ?? base.version,
    previousBundleId: raw.previousBundleId ?? null,
    runId: raw.runId || base.runId,
    citations: raw.citations ?? [],
    blockReasons: raw.blockReasons ?? [],
    pendingReasons: raw.pendingReasons ?? [],
    judgeAttempts: raw.judgeAttempts ?? 0,
    inputHash: raw.inputHash ?? "",
    settingsHash: raw.settingsHash ?? "",
    resultHash: raw.resultHash ?? "",
    outputHash: raw.outputHash ?? "",
  };
}

/** 고객용 최종 PDF는 locked 상태와 현재 Evidence 게이트를 모두 충족할 때만 허용. */
export function canIssueClientPdf(bundle: EvidenceBundle): boolean {
  return bundle.status === PDF_ALLOWED_STATUS && canLock(bundle);
}

export function pdfBlockReason(bundle: EvidenceBundle): string {
  if (canIssueClientPdf(bundle)) return "";
  if (bundle.status === "locked") {
    return softLockReasons(bundle)[0] || hardStopReasons(bundle)[0] || "기존 확정 상태가 현재 Evidence 게이트를 충족하지 않아 PDF를 발행할 수 없습니다.";
  }
  if (bundle.status === "blocked") {
    return bundle.blockReasons[0] || "고객 제안 차단 상태입니다. 고객용 최종 PDF를 저장할 수 없습니다.";
  }
  if (bundle.pendingReasons.length) {
    return `PDF 비활성: ${bundle.pendingReasons[0]}`;
  }
  if (bundle.status === "review") {
    return "PB 검토 중입니다. 「PB 검토 완료/승인」으로 locked가 되어야 고객용 최종 PDF를 발행할 수 있습니다.";
  }
  return "초안(draft) 상태입니다. Evidence Bundle 생성 후 PB 상담 검토 승인을 거쳐 locked가 되어야 고객용 최종 PDF를 발행할 수 있습니다.";
}

const ALLOWED: Record<AdvisoryStatus, AdvisoryStatus[]> = {
  draft: ["review", "locked", "blocked"],
  review: ["locked", "blocked", "draft"],
  locked: ["review"],
  blocked: ["review", "draft"],
};

export function canTransition(from: AdvisoryStatus, to: AdvisoryStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function hardStopReasons(bundle: EvidenceBundle): string[] {
  const reasons: string[] = [];
  if (bundle.resultHash && bundle.outputHash && bundle.resultHash !== bundle.outputHash) {
    reasons.push("Evidence 결과 해시 불일치 — 고객 제안 차단.");
  }
  if (bundle.judge && !bundle.judge.passed) {
    reasons.push("Judge 실패 — locked로 이동할 수 없습니다.");
  }
  if (bundle.judgeAttempts >= JUDGE_MAX_RETRIES && !(bundle.judge?.passed)) {
    reasons.push(`Judge 재시도 ${JUDGE_MAX_RETRIES}회 소진 — locked 불가.`);
  }
  if (bundle.citation && !bundle.citation.passed) {
    reasons.push(bundle.citation.message || "인용 검증 실패 — 고객 확정본 PDF 발행 불가.");
  }
  if (bundle.conflict && !bundle.conflict.passed && !bundle.conflict.needsReview) {
    reasons.push(bundle.conflict.message || "충돌 감사 실패 — 고객 제안 차단.");
  }
  return reasons;
}

/** locked 전 soft gate — 아직 준비가 안 된 항목(애매하게 review에만 두지 않고 안내). */
export function softLockReasons(bundle: EvidenceBundle): string[] {
  const reasons: string[] = [];
  if (!bundle.judge || !hasCalcGateJudge(bundle.judge)) {
    reasons.push("계산 Judge 결과가 없습니다. Evidence Bundle을 생성하세요.");
  }
  if (!bundle.citation) {
    reasons.push("인용 검증 결과가 없습니다. Evidence Bundle을 생성하세요.");
  }
  if (bundle.conflict && !bundle.conflict.passed && bundle.conflict.needsReview) {
    reasons.push(bundle.conflict.message || "고객 선호·포트폴리오 충돌 — PB가 검토 후 승인해야 합니다.");
  }
  if (!bundle.calcResults) {
    reasons.push("결정론 계산 스냅샷이 없습니다. Evidence Bundle을 생성하세요.");
  }
  if (!bundle.inputHash || !bundle.settingsHash || !bundle.resultHash || !bundle.outputHash) {
    reasons.push("Evidence 핵심 해시가 없습니다. Evidence Bundle을 다시 생성하세요.");
  }
  return reasons;
}

export function canLock(bundle: EvidenceBundle): boolean {
  if (bundle.status === "blocked") return false;
  if (hardStopReasons(bundle).length > 0) return false;
  if (!bundle.judge?.passed || !hasCalcGateJudge(bundle.judge)) return false;
  if (!bundle.citation?.passed) return false;
  if (!bundle.calcResults) return false;
  if (!bundle.inputHash || !bundle.settingsHash || !bundle.resultHash || !bundle.outputHash) return false;
  if (bundle.resultHash !== bundle.outputHash) return false;
  // soft conflict는 review/draft에서 PB가 명시 승인하면 해소(아래 approveByPb에서 review면 허용)
  if (bundle.conflict && !bundle.conflict.passed && !bundle.conflict.needsReview) return false;
  if (bundle.conflict && !bundle.conflict.passed && bundle.conflict.needsReview) {
    // needsReview 충돌은 review 상태에서만 PB 상담 검토 승인으로 locked 가능
    if (bundle.status !== "review" && bundle.status !== "draft") return false;
  }
  return true;
}

const CALC_GATE_JUDGE_CODES = ["MEASURED_META", "STRESS_COUNT", "ENGINE_ONLY"] as const;

function hasCalcGateJudge(judge: JudgeResult): boolean {
  return CALC_GATE_JUDGE_CODES.every((code) =>
    judge.findings.some((finding) => finding.code === code && finding.severity !== "fail"),
  );
}

/** 결정론 스냅샷용 Judge — AI가 숫자를 확정하지 않았는지·메타 존재 여부만 검사. */
export function judgeCalcResults(results: CalcResults): JudgeResult {
  const findings: JudgeFinding[] = [];
  const now = new Date().toISOString();
  const nums = [
    results.risk.expectedReturn,
    results.risk.volatility,
    results.risk.sharpe,
    results.risk.mdd,
    results.risk.var95,
    results.risk.cvar95,
    ...(results.waterfall
      ? [results.waterfall.pretaxEnding, results.waterfall.expectedTax, results.waterfall.productCost, results.waterfall.afterTaxEnding]
      : []),
  ];
  const missingMeta = nums.some((n) => !n.asOf || !n.source);
  findings.push({
    code: "MEASURED_META",
    severity: missingMeta ? "fail" : "pass",
    message: missingMeta ? "핵심 수치 as-of/source 누락" : "핵심 수치 as-of/source 존재",
  });
  findings.push({
    code: "STRESS_COUNT",
    severity: results.stress.length >= 2 ? "pass" : "fail",
    message: results.stress.length >= 2 ? `스트레스 ${results.stress.length}건` : "스트레스 시나리오 부족",
  });
  findings.push({
    code: "ENGINE_ONLY",
    severity: "pass",
    message: "스냅샷은 결정론 엔진 산출(세금·VaR 확정 AI 없음)",
  });
  return {
    at: now,
    passed: findings.every((f) => f.severity !== "fail"),
    findings,
  };
}

export function judgeRecommend(result: RecommendResult): JudgeResult {
  const findings: JudgeFinding[] = [];
  const now = new Date().toISOString();

  const hasAsOf = Boolean(result.asOf);
  findings.push({
    code: "ASOF",
    severity: hasAsOf ? "pass" : "fail",
    message: hasAsOf ? `as-of ${result.asOf}` : "as-of 누락",
  });
  findings.push({
    code: "SOURCE",
    severity: result.source ? "pass" : "fail",
    message: result.source ? `출처 ${result.source}` : "출처 누락",
  });
  findings.push({
    code: "CCY",
    severity: result.currency === "KRW" ? "pass" : "fail",
    message: `통화 ${result.currency}`,
  });

  const blob = JSON.stringify(result);
  const confirmedWeight = /"weight"\s*:\s*\d/.test(blob);
  findings.push({
    code: "NO_AI_WEIGHT",
    severity: confirmedWeight ? "fail" : "pass",
    message: confirmedWeight
      ? "확정 비중 필드가 포함되어 발행을 차단합니다"
      : "확정 비중 없음 (초안 구간만 표시)",
  });

  const taxAmount = /확정\s*세액|"taxAmount"\s*:|"var95"\s*:\s*\{|"cvar"\s*:/i.test(blob);
  findings.push({
    code: "NO_AI_TAX_VAR",
    severity: taxAmount ? "fail" : "pass",
    message: taxAmount ? "세금 또는 VaR/CVaR 확정값이 추천 결과에 포함됨" : "세금·VaR/CVaR 미확정 유지",
  });

  for (const plan of result.plans) {
    if (result.constraints.tags.length && !plan.constraintNote.includes("조건")) {
      findings.push({
        code: "CONSTRAINT_ALL_PLANS",
        severity: "warn",
        message: `${plan.id}안 제약 문구 확인 필요`,
      });
    }
    if (plan.products.some((p) => p.expectedReturnPct && !p.expectedReturnPct.asOf)) {
      findings.push({
        code: "RETURN_ASOF",
        severity: "fail",
        message: `${plan.id}안 기대수익률 as-of 누락`,
      });
    }
  }

  if (result.constraints.categoryOnly === "trust" || result.constraints.categoryOnly === "wrap") {
    const expectedStructure = result.constraints.categoryOnly;
    const leak = result.plans.some((plan) =>
      plan.products.some((product) =>
        product.category !== "trust" || product.productStructure !== expectedStructure,
      ),
    );
    findings.push({
      code: "TRUST_FILTER",
      severity: leak ? "fail" : "pass",
      message: leak ? `${expectedStructure === "wrap" ? "랩/일임" : "신탁"}만 조건에 다른 구조가 포함됨` : "신탁/랩 구조 필터 준수",
    });
  }

  if (result.constraints.overseasOnly) {
    const leaks = result.plans.flatMap((plan) =>
      plan.products.filter((product) =>
        product.isOverseas !== true || (product.category !== "stock" && product.category !== "etf"),
      ),
    );
    findings.push({
      code: "OVERSEAS_ONLY_FILTER",
      severity: leaks.length > 0 ? "fail" : "pass",
      message: leaks.length > 0
        ? `해외주식만 조건에 해외주식·주식형 ETF가 아닌 후보 ${leaks.length}건 포함`
        : "해외주식만 조건에 해외주식·주식형 ETF 후보만 포함",
    });
  }

  if (result.constraints.minExpectedReturn != null) {
    const minimum = result.constraints.minExpectedReturn;
    const leaks = result.plans.flatMap((plan) =>
      plan.products.filter((product) =>
        product.expectedReturnPct == null || product.expectedReturnPct.value < minimum,
      ),
    );
    findings.push({
      code: "MIN_RETURN_FILTER",
      severity: leaks.length > 0 ? "fail" : "pass",
      message: leaks.length > 0
        ? `기대수익률 proxy ${minimum}% 미달 또는 미산출 상품 ${leaks.length}건 포함`
        : `기대수익률 proxy ${minimum}% 미달 상품 없음(충족 후보가 없으면 빈 결과 유지)`,
    });
  }

  const passed = findings.every((f) => f.severity !== "fail");
  return { at: now, passed, findings };
}

export function judgeTicker(snapshot: TickerSnapshot): JudgeResult {
  const findings: JudgeFinding[] = [
    {
      code: "TICKER_ASOF",
      severity: snapshot.asOf ? "pass" : "fail",
      message: snapshot.asOf ? `as-of ${snapshot.asOf}` : "as-of 누락",
    },
    {
      code: "TICKER_SOURCE",
      severity: snapshot.source ? "pass" : "fail",
      message: snapshot.source || "출처 누락",
    },
    {
      code: "TICKER_CCY",
      severity: snapshot.currency ? "pass" : "fail",
      message: snapshot.currency || "통화 누락",
    },
    {
      code: "PRICE_MEASURED",
      severity: snapshot.lastPrice?.source ? "pass" : "fail",
      message: snapshot.lastPrice?.source ? "가격은 결정론 시세" : "가격 출처 없음",
    },
  ];
  return {
    at: new Date().toISOString(),
    passed: findings.every((f) => f.severity !== "fail"),
    findings,
  };
}

export function auditConflict(conflicts: string[], hard = false): ConflictAudit {
  if (conflicts.length === 0) {
    return { passed: true, needsReview: false, conflicts: [], message: "충돌 없음" };
  }
  if (hard) {
    return {
      passed: false,
      needsReview: false,
      conflicts,
      message: `충돌 감사 실패: ${conflicts[0]}`,
    };
  }
  return {
    passed: false,
    needsReview: true,
    conflicts,
    message: `고객 선호와 포트폴리오가 어긋납니다. PB 검토필요: ${conflicts[0]}`,
  };
}

export function appendRun(
  bundle: EvidenceBundle,
  run: Omit<EvidenceRun, "id" | "at"> & { at?: string },
): EvidenceBundle {
  const at = run.at ?? new Date().toISOString();
  const nextRun: EvidenceRun = {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at,
    kind: run.kind,
    engine: run.engine,
    inputHash: run.inputHash,
    outputHash: run.outputHash,
    notes: run.notes,
    judge: run.judge,
    citations: run.citations,
  };
  const evidenceIsFinal = bundle.status === "locked" || bundle.status === "blocked";
  return {
    ...bundle,
    // 실행 이력은 append-only 보조 로그다. 특히 locked/blocked Evidence의
    // 핵심 해시와 확정 시각을 추천·티커 실행으로 사후 변경하지 않는다.
    updatedAt: evidenceIsFinal ? bundle.updatedAt : at,
    runs: [nextRun, ...bundle.runs].slice(0, 40),
  };
}

export function applyJudge(bundle: EvidenceBundle, judge: JudgeResult, actor: string): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  const attempts = bundle.judgeAttempts + 1;
  const retriesExhausted = attempts >= JUDGE_MAX_RETRIES && !judge.passed;
  const nextStatus: AdvisoryStatus = judge.passed ? bundle.status : "blocked";
  const reasons = judge.passed
    ? []
    : [
        "Judge 실패로 고객 제안 차단",
        ...judge.findings.filter((f) => f.severity === "fail").map((f) => `${f.code}: ${f.message}`),
        ...(retriesExhausted ? [`재시도 ${JUDGE_MAX_RETRIES}회 소진`] : []),
      ];
  const approvals =
    nextStatus !== bundle.status
      ? [
          {
            at: judge.at,
            actor,
            from: bundle.status,
            to: nextStatus,
            note: judge.passed ? "Judge 통과" : "Judge 실패로 고객 제안 차단",
          },
          ...bundle.approvals,
        ]
      : bundle.approvals;
  return {
    ...bundle,
    updatedAt: judge.at,
    status: nextStatus,
    judge,
    judgeAttempts: attempts,
    blockReasons: nextStatus === "blocked" ? reasons : [],
    approvals,
  };
}

export function attachCitations(bundle: EvidenceBundle, citations: CitationRef[]): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  const citation = judgeCitations(citations);
  if (citation.passed) {
    return { ...bundle, citations, citation, updatedAt: new Date().toISOString() };
  }
  const blocked: EvidenceBundle = {
    ...bundle,
    citations,
    citation,
    status: "blocked",
    blockReasons: [citation.message],
    updatedAt: new Date().toISOString(),
  };
  if (bundle.status === blocked.status) return blocked;
  return {
    ...blocked,
    approvals: [
      {
        at: blocked.updatedAt,
        actor: "engine",
        from: bundle.status,
        to: "blocked",
        note: citation.message,
      },
      ...bundle.approvals,
    ],
  };
}

export function attachConflict(bundle: EvidenceBundle, conflict: ConflictAudit): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  if (conflict.passed) return { ...bundle, conflict };
  if (conflict.needsReview) {
    return { ...bundle, conflict };
  }
  return {
    ...bundle,
    conflict,
    status: "blocked",
    blockReasons: [conflict.message],
    approvals: [
      {
        at: new Date().toISOString(),
        actor: "engine",
        from: bundle.status,
        to: "blocked",
        note: conflict.message,
      },
      ...bundle.approvals,
    ],
  };
}

const LS_KEY = "pb-advisory-evidence-v1";
const ARCHIVE_LS_KEY = "pb-advisory-evidence-archive-v1";
const CURRENT_KEY_PREFIX = "pb-advisory-evidence-current-v2:";
const ARCHIVE_RECORD_PREFIX = "pb-advisory-evidence-archive-v2:";
const CLIENT_LOCK_PREFIX = "pb-advisory-evidence-lock-v2:";
const CLIENT_LOCK_TTL_MS = 2_500;

interface ArchiveRecord {
  archivedAt: string;
  fingerprint: string;
  snapshot: EvidenceBundle;
}

interface ClientLockRecord {
  token: string;
  choosing: boolean;
  ticket: number;
  expiresAt: number;
}

function jsonSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function encodedClientId(clientId: string): string {
  return encodeURIComponent(clientId);
}

function currentKey(clientId: string): string {
  return `${CURRENT_KEY_PREFIX}${encodedClientId(clientId)}`;
}

function archiveRecordPrefix(clientId: string): string {
  return `${ARCHIVE_RECORD_PREFIX}${encodedClientId(clientId)}:`;
}

function lockPrefix(clientId: string): string {
  return `${CLIENT_LOCK_PREFIX}${encodedClientId(clientId)}:`;
}

function lockContenderKey(clientId: string, token: string): string {
  return `${lockPrefix(clientId)}${encodeURIComponent(token)}`;
}

/**
 * Browser-safe deterministic fingerprint. It is used as a storage address, not
 * as a cryptographic signature; a matching key is always verified by comparing
 * the complete stable JSON before it is trusted.
 */
function snapshotFingerprint(serialized: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function createLockToken(): string {
  const randomPart = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return `${Date.now().toString(36)}-${randomPart}`;
}

/**
 * Short cooperative mutex used by every control.ts writer for a client. This
 * prevents two app tabs using these APIs from interleaving the archive/current
 * sequence. Direct, uncooperative localStorage mutation still requires an async
 * Web Lock or transactional server store for a formal atomic guarantee.
 */
function listLiveClientLocks(
  clientId: string,
  now: number,
): Array<{ key: string; record: ClientLockRecord }> | null {
  const prefix = lockPrefix(clientId);
  const live: Array<{ key: string; record: ClientLockRecord }> = [];
  const expiredKeys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as ClientLockRecord;
        if (
          !record.token
          || typeof record.choosing !== "boolean"
          || !Number.isFinite(record.ticket)
          || !Number.isFinite(record.expiresAt)
        ) return null;
        if (record.expiresAt <= now) expiredKeys.push(key);
        else live.push({ key, record });
      } catch {
        return null;
      }
    }
    for (const key of expiredKeys) window.localStorage.removeItem(key);
  } catch {
    return null;
  }
  return live;
}

function earlierLock(a: ClientLockRecord, b: ClientLockRecord): boolean {
  return a.ticket < b.ticket || (a.ticket === b.ticket && a.token.localeCompare(b.token) < 0);
}

function acquireClientLock(clientId: string): string | null {
  const now = Date.now();
  const token = createLockToken();
  const key = lockContenderKey(clientId, token);
  try {
    const choosing: ClientLockRecord = {
      token,
      choosing: true,
      ticket: 0,
      expiresAt: now + CLIENT_LOCK_TTL_MS,
    };
    window.localStorage.setItem(key, JSON.stringify(choosing));
    const choosingRaw = window.localStorage.getItem(key);
    if (!choosingRaw || stableStringify(JSON.parse(choosingRaw)) !== stableStringify(choosing)) {
      window.localStorage.removeItem(key);
      return null;
    }

    const contendersWhileChoosing = listLiveClientLocks(clientId, now);
    if (!contendersWhileChoosing) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (contendersWhileChoosing.some(({ record }) => record.token !== token && record.choosing)) {
      window.localStorage.removeItem(key);
      return null;
    }
    const maxTicket = contendersWhileChoosing.reduce(
      (maximum, { record }) => Math.max(maximum, record.ticket),
      0,
    );
    const proposed: ClientLockRecord = {
      token,
      choosing: false,
      ticket: maxTicket + 1,
      expiresAt: now + CLIENT_LOCK_TTL_MS,
    };
    window.localStorage.setItem(key, JSON.stringify(proposed));
    const persistedRaw = window.localStorage.getItem(key);
    if (!persistedRaw) return null;
    const persisted = JSON.parse(persistedRaw) as ClientLockRecord;
    if (stableStringify(persisted) !== stableStringify(proposed)) {
      window.localStorage.removeItem(key);
      return null;
    }

    const finalContenders = listLiveClientLocks(clientId, now);
    if (!finalContenders) {
      window.localStorage.removeItem(key);
      return null;
    }
    const blocked = finalContenders.some(({ record }) =>
      record.token !== token && (record.choosing || earlierLock(record, proposed)),
    );
    const own = finalContenders.find(({ record }) => record.token === token)?.record;
    if (blocked || !own || stableStringify(own) !== stableStringify(proposed)) {
      window.localStorage.removeItem(key);
      return null;
    }
    return token;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best-effort cleanup; expiry is the final recovery path.
    }
    return null;
  }
}

function releaseClientLock(clientId: string, token: string): void {
  const key = lockContenderKey(clientId, token);
  try {
    const persistedRaw = window.localStorage.getItem(key);
    if (!persistedRaw) return;
    const persisted = JSON.parse(persistedRaw) as ClientLockRecord;
    if (persisted.token === token) window.localStorage.removeItem(key);
  } catch {
    // Expiry makes a failed cleanup recoverable; never remove an unverified lock.
  }
}

function withClientLock<T>(
  clientId: string,
  onBusy: () => T,
  action: () => T,
): T {
  const token = acquireClientLock(clientId);
  if (!token) return onBusy();
  try {
    return action();
  } finally {
    releaseClientLock(clientId, token);
  }
}

type CurrentReadResult =
  | { state: "ok"; bundle: EvidenceBundle }
  | { state: "missing" }
  | { state: "invalid" };

function isStoredBundle(value: unknown, clientId: string): value is EvidenceBundle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<EvidenceBundle>;
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && candidate.clientId === clientId
    && (candidate.status === "draft"
      || candidate.status === "review"
      || candidate.status === "locked"
      || candidate.status === "blocked");
}

function readLegacyCurrent(clientId: string): CurrentReadResult {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { state: "missing" };
    const value = (JSON.parse(raw) as Record<string, unknown>)[clientId];
    if (value == null) return { state: "missing" };
    return isStoredBundle(value, clientId)
      ? { state: "ok", bundle: value }
      : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

/** Per-client v2 current is authoritative; only a genuinely absent key falls back. */
function readCurrent(clientId: string): CurrentReadResult {
  try {
    const raw = window.localStorage.getItem(currentKey(clientId));
    if (raw !== null) {
      try {
        const value = JSON.parse(raw) as unknown;
        return isStoredBundle(value, clientId)
          ? { state: "ok", bundle: value }
          : { state: "invalid" };
      } catch {
        return { state: "invalid" };
      }
    }
  } catch {
    return { state: "invalid" };
  }
  return readLegacyCurrent(clientId);
}

/**
 * Keep the legacy map only as a best-effort compatibility/event mirror. All
 * correctness checks read the per-client v2 key first, so a cross-client mirror
 * race cannot destroy the authoritative current record.
 */
function mirrorLegacyCurrent(clientId: string, bundle: EvidenceBundle): void {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, EvidenceBundle>) : {};
    all[clientId] = jsonSnapshot(bundle);
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    // Compatibility mirror failure must not invalidate a verified v2 write.
  }
}

function writeCurrentExact(clientId: string, bundle: EvidenceBundle): boolean {
  const snapshot = jsonSnapshot(bundle);
  const expected = stableStringify(snapshot);
  try {
    window.localStorage.setItem(currentKey(clientId), JSON.stringify(snapshot));
    const persistedRaw = window.localStorage.getItem(currentKey(clientId));
    if (!persistedRaw) return false;
    const persisted = JSON.parse(persistedRaw) as EvidenceBundle;
    if (stableStringify(persisted) !== expected) return false;
    mirrorLegacyCurrent(clientId, snapshot);
    return true;
  } catch {
    return false;
  }
}

function readLegacyArchives(clientId: string): EvidenceBundle[] | null {
  try {
    const raw = window.localStorage.getItem(ARCHIVE_LS_KEY);
    if (!raw) return [];
    const records = (JSON.parse(raw) as Record<string, unknown>)[clientId];
    if (records == null) return [];
    if (!Array.isArray(records) || records.some((record) => !isStoredBundle(record, clientId))) return null;
    return records as EvidenceBundle[];
  } catch {
    return null;
  }
}

function readV2ArchiveRecords(clientId: string): ArchiveRecord[] | null {
  const prefix = archiveRecordPrefix(clientId);
  const records: ArchiveRecord[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const record = JSON.parse(raw) as ArchiveRecord;
      if (
        !record
        || typeof record.archivedAt !== "string"
        || typeof record.fingerprint !== "string"
        || !isStoredBundle(record.snapshot, clientId)
      ) return null;
      records.push(record);
    }
  } catch {
    return null;
  }
  return records.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
}

function allArchivedSnapshots(clientId: string): EvidenceBundle[] | null {
  const v2Records = readV2ArchiveRecords(clientId);
  const legacyRecords = readLegacyArchives(clientId);
  if (!v2Records || !legacyRecords) return null;
  const combined = [
    ...v2Records.map((record) => record.snapshot),
    ...legacyRecords,
  ];
  const seen = new Set<string>();
  return combined.filter((snapshot) => {
    const serialized = stableStringify(snapshot);
    if (seen.has(serialized)) return false;
    seen.add(serialized);
    return true;
  });
}

function isFinalStatus(status: AdvisoryStatus): status is "locked" | "blocked" {
  return status === "locked" || status === "blocked";
}

/**
 * 최종본은 읽기 과정에서 제자리 보정하지 않는다. 구형 스키마이거나 현재
 * 발행 게이트를 충족하지 않는 locked만 원본 보존 후 별도 review로 넘긴다.
 */
function needsArchivedMigration(raw: EvidenceBundle, normalized: EvidenceBundle): boolean {
  if (!isFinalStatus(raw.status)) return false;
  const schemaChanged = stableStringify(raw) !== stableStringify(normalized);
  const lockedNeedsReview = raw.status === "locked" && !canLock(normalized);
  return schemaChanged || lockedNeedsReview;
}

/** 같은 ID의 다른 원본을 덮어쓰지 않고, JSON 원본을 정확히 한 번만 보존한다. */
function archiveExactOriginal(clientId: string, original: EvidenceBundle): boolean {
  const originalSnapshot = jsonSnapshot(original);
  const originalSerialized = stableStringify(originalSnapshot);
  const existing = allArchivedSnapshots(clientId);
  if (!existing) return false;
  // 동일 ID의 서로 다른 내용이 하나라도 있으면 감사 추적 충돌로 fail-closed한다.
  if (existing.some(
    (saved) => saved.id === original.id && stableStringify(saved) !== originalSerialized,
  )) return false;

  const fingerprint = snapshotFingerprint(originalSerialized);
  const key = `${archiveRecordPrefix(clientId)}${encodeURIComponent(original.id)}:${fingerprint}`;
  try {
    const existingRaw = window.localStorage.getItem(key);
    if (existingRaw) {
      const record = JSON.parse(existingRaw) as ArchiveRecord;
      return record.fingerprint === fingerprint
        && stableStringify(record.snapshot) === originalSerialized;
    }

    const record: ArchiveRecord = {
      archivedAt: new Date().toISOString(),
      fingerprint,
      snapshot: originalSnapshot,
    };
    window.localStorage.setItem(key, JSON.stringify(record));

    // setItem이 조용히 실패하는 Storage 구현도 fail-closed로 다룬다.
    const persistedRaw = window.localStorage.getItem(key);
    if (!persistedRaw) return false;
    const persisted = JSON.parse(persistedRaw) as ArchiveRecord;
    return persisted.fingerprint === fingerprint
      && stableStringify(persisted.snapshot) === originalSerialized;
  } catch {
    return false;
  }
}

function collisionCheckedBundleId(clientId: string, currentId: string, version: number): string | null {
  const archived = allArchivedSnapshots(clientId);
  if (!archived) return null;
  const used = new Set(archived.map((bundle) => bundle.id));
  used.add(currentId);
  const generated = newBundleId(clientId);
  if (!used.has(generated)) return generated;

  const versionedBase = `${generated}-v${version}`;
  if (!used.has(versionedBase)) return versionedBase;
  let suffix = 2;
  while (used.has(`${versionedBase}-${suffix}`)) suffix += 1;
  return `${versionedBase}-${suffix}`;
}

function buildLegacyReviewVersion(
  original: EvidenceBundle,
  normalized: EvidenceBundle,
  nextId: string,
): EvidenceBundle {
  const at = new Date().toISOString();
  const fresh = emptyBundle(normalized.clientId);
  const nextVersion = (normalized.version || 1) + 1;
  const nextRunId = fresh.runId === normalized.runId
    ? `${fresh.runId}-v${nextVersion}`
    : fresh.runId;
  const note = original.status === "locked"
    ? "기존 locked 원본을 보존하고 현재 Evidence 게이트 재검토본을 생성"
    : "기존 blocked 원본을 보존하고 별도 재검토본을 생성";
  const pendingReasons = Array.from(new Set([
    note,
    ...normalized.blockReasons,
    ...hardStopReasons(normalized),
    ...softLockReasons(normalized),
  ]));

  let next: EvidenceBundle = {
    ...normalized,
    id: nextId,
    version: nextVersion,
    previousBundleId: normalized.id,
    runId: nextRunId,
    createdAt: at,
    updatedAt: at,
    status: "review",
    blockReasons: [],
    pendingReasons,
    approvals: [
      {
        at,
        actor: "migration",
        from: original.status,
        to: "review",
        note,
      },
      ...normalized.approvals,
    ],
  };
  next = appendRun(next, {
    at,
    kind: "status",
    engine: "migration",
    inputHash: normalized.inputHash,
    outputHash: normalized.outputHash,
    notes: `${note} · 원본 ${normalized.id}`,
  });
  return next;
}

export function loadBundle(clientId: string): EvidenceBundle {
  if (typeof window === "undefined") return emptyBundle(clientId);
  const stored = readCurrent(clientId);
  if (stored.state !== "ok") return emptyBundle(clientId);
  const original = jsonSnapshot(stored.bundle);

  const migrated = migrateBundle(original, clientId);
  if (!needsArchivedMigration(original, migrated)) return migrated;

  return withClientLock<EvidenceBundle>(
    clientId,
    () => {
      const latest = readCurrent(clientId);
      return latest.state === "ok" ? migrateBundle(latest.bundle, clientId) : migrated;
    },
    () => {
      const latest = readCurrent(clientId);
      if (latest.state !== "ok") return migrated;
      if (stableStringify(latest.bundle) !== stableStringify(original)) {
        return migrateBundle(latest.bundle, clientId);
      }

      if (!archiveExactOriginal(clientId, original)) return migrated;

      const afterArchive = readCurrent(clientId);
      if (afterArchive.state !== "ok" || stableStringify(afterArchive.bundle) !== stableStringify(original)) {
        return afterArchive.state === "ok" ? migrateBundle(afterArchive.bundle, clientId) : migrated;
      }

      const nextVersion = (migrated.version || 1) + 1;
      const nextId = collisionCheckedBundleId(clientId, migrated.id, nextVersion);
      if (!nextId) return migrated;
      const next = buildLegacyReviewVersion(original, migrated, nextId);
      return writeCurrentExact(clientId, next) ? jsonSnapshot(next) : migrated;
    },
  );
}

export function saveBundle(bundle: EvidenceBundle): boolean {
  if (typeof window === "undefined") return false;
  return withClientLock(bundle.clientId, () => false, () => {
    const current = readCurrent(bundle.clientId);
    if (current.state === "invalid") return false;
    if (current.state === "ok" && isFinalStatus(current.bundle.status)) {
      return stableStringify(current.bundle) === stableStringify(jsonSnapshot(bundle));
    }
    return writeCurrentExact(bundle.clientId, bundle);
  });
}

export function loadArchivedBundles(clientId: string): EvidenceBundle[] {
  if (typeof window === "undefined") return [];
  return allArchivedSnapshots(clientId) ?? [];
}

export interface StartNewReviewVersionResult {
  ok: boolean;
  bundle: EvidenceBundle;
  archivedBundleId?: string;
  error?: string;
}

/**
 * locked/blocked 원본을 append-only 보관한 뒤에만 새 draft를 현재본으로 교체한다.
 * archive 저장이 실패하면 현재 final 원본은 절대 덮어쓰지 않는다.
 */
export function startNewReviewVersion(
  bundle: EvidenceBundle,
  actor = "PB",
): StartNewReviewVersionResult {
  if (bundle.status !== "locked" && bundle.status !== "blocked") {
    return {
      ok: false,
      bundle,
      error: "새 검토본은 locked 또는 blocked 원본에서만 시작할 수 있습니다.",
    };
  }

  if (typeof window === "undefined") {
    return {
      ok: false,
      bundle,
      error: "브라우저 보존 저장소를 사용할 수 없어 새 검토본을 만들지 않았습니다.",
    };
  }

  return withClientLock<StartNewReviewVersionResult>(
    bundle.clientId,
    () => ({
      ok: false,
      bundle,
      error: "다른 화면에서 같은 고객의 Evidence를 저장 중입니다. 잠시 후 다시 시도하세요.",
    }),
    () => {
      const current = readCurrent(bundle.clientId);
      const latestRaw = current.state === "ok" ? current.bundle : undefined;
      const latest = latestRaw ? migrateBundle(latestRaw, bundle.clientId) : undefined;
      const persistedLatest = latest ? jsonSnapshot(latest) : undefined;
      const persistedRequested = jsonSnapshot(bundle);
      if (
        !latestRaw
        || !persistedLatest
        || persistedLatest.id !== bundle.id
        || (persistedLatest.status !== "locked" && persistedLatest.status !== "blocked")
        || stableStringify(persistedLatest) !== stableStringify(persistedRequested)
      ) {
        return {
          ok: false,
          bundle,
          error: "다른 화면에서 현재본이 변경되었습니다. 최신 상태를 다시 불러온 뒤 시도하세요.",
        };
      }

      const persistedOriginal = jsonSnapshot(latestRaw);
      if (!archiveExactOriginal(bundle.clientId, persistedOriginal)) {
        return {
          ok: false,
          bundle,
          error: "원본을 안전하게 보존하지 못해 현재본을 변경하지 않았습니다.",
        };
      }

      const afterArchive = readCurrent(bundle.clientId);
      if (
        afterArchive.state !== "ok"
        || stableStringify(afterArchive.bundle) !== stableStringify(persistedOriginal)
      ) {
        return {
          ok: false,
          bundle,
          error: "다른 화면에서 현재본이 변경되었습니다. 최신 상태를 다시 불러온 뒤 시도하세요.",
        };
      }

      const nextVersion = (bundle.version || 1) + 1;
      const at = new Date().toISOString();
      const fresh = emptyBundle(bundle.clientId);
      const nextId = collisionCheckedBundleId(bundle.clientId, bundle.id, nextVersion);
      if (!nextId) {
        return {
          ok: false,
          bundle,
          error: "기존 보존본을 안전하게 읽지 못해 새 검토본을 만들지 않았습니다.",
        };
      }
      let next: EvidenceBundle = {
        ...fresh,
        id: nextId,
        version: nextVersion,
        previousBundleId: bundle.id,
        createdAt: at,
        updatedAt: at,
        approvals: [
          {
            at,
            actor,
            from: bundle.status,
            to: "draft",
            note: `새 버전 생성 — 이전 ${bundle.status} 원본 ${bundle.id}은 상태 변경 없이 보존`,
          },
        ],
      };
      next = appendRun(next, {
        at,
        kind: "status",
        engine: "human-review",
        inputHash: bundle.inputHash,
        outputHash: "",
        notes: `새 draft v${nextVersion} 생성 · 이전 원본 ${bundle.id} 보존`,
      });

      if (!writeCurrentExact(bundle.clientId, next)) {
        return {
          ok: false,
          bundle,
          error: "새 검토본 저장을 확인하지 못해 기존 확정·차단본을 유지했습니다.",
        };
      }
      return { ok: true, bundle: jsonSnapshot(next), archivedBundleId: bundle.id };
    },
  );
}

export function transitionStatus(
  bundle: EvidenceBundle,
  to: AdvisoryStatus,
  actor: string,
  note: string,
): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  if (!canTransition(bundle.status, to)) return bundle;
  if (to === "locked" && !canLock(bundle)) return bundle;
  const at = new Date().toISOString();
  return {
    ...bundle,
    updatedAt: at,
    status: to,
    blockReasons: to === "blocked" ? [note, ...bundle.blockReasons] : to === "locked" ? [] : bundle.blockReasons,
    pendingReasons: to === "locked" || to === "blocked" ? [] : bundle.pendingReasons,
    approvals: [{ at, actor, from: bundle.status, to, note }, ...bundle.approvals],
  };
}

/**
 * PB HITL 승인.
 * - hard stop → blocked (명확한 사유)
 * - Judge·인용 통과 → locked
 * - 준비 미완 → review + pendingReasons (무엇을 해야 하는지 명시). 이미 review여도 no-op 금지.
 */
export function approveByPb(bundle: EvidenceBundle, actor = "PB"): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  const stops = hardStopReasons(bundle);
  if (stops.length) {
    return transitionStatus({ ...bundle, blockReasons: stops, pendingReasons: [] }, "blocked", actor, stops[0]);
  }

  // soft conflict는 review에서 PB가 승인하면 해소된 것으로 본다
  let working: EvidenceBundle = bundle;
  if (bundle.conflict && !bundle.conflict.passed && bundle.conflict.needsReview) {
    working = {
      ...bundle,
      conflict: {
        ...bundle.conflict,
        passed: true,
        needsReview: false,
        message: `PB 상담 검토 승인으로 충돌 검토 완료: ${bundle.conflict.conflicts[0] ?? "해소"}`,
      },
    };
  }

  if (canLock(working) && canTransition(working.status, "locked")) {
    return {
      ...transitionStatus(working, "locked", actor, "PB 상담 검토 승인 — 고객용 PDF 발행 가능"),
      pendingReasons: [],
      blockReasons: [],
    };
  }

  const soft = softLockReasons(working);
  const at = new Date().toISOString();
  const note =
    soft.length > 0
      ? `PB 검토 대기 — ${soft[0]}`
      : "PB 검토 대기 — locked 조건을 충족하지 못했습니다.";

  // 이미 review여도 pendingReasons를 갱신하고 승인 이력을 남겨 UI가 멈춘 것처럼 보이지 않게 함
  if (working.status === "review" || canTransition(working.status, "review")) {
    const to: AdvisoryStatus = working.status === "review" ? "review" : "review";
    const from = working.status;
    return {
      ...working,
      updatedAt: at,
      status: to,
      pendingReasons: soft.length ? soft : [note],
      blockReasons: [],
      approvals: [{ at, actor, from, to, note }, ...working.approvals],
    };
  }

  return {
    ...working,
    updatedAt: at,
    pendingReasons: soft.length ? soft : [note],
    approvals: [{ at, actor, from: working.status, to: working.status, note }, ...working.approvals],
  };
}

export function applyCalcSnapshot(
  bundle: EvidenceBundle,
  payload: {
    consultationInput: string;
    ipsExtract: unknown;
    calcConfig: CalcConfig;
    calcResults: CalcResults;
    inputHash: string;
    settingsHash: string;
    resultHash: string;
    citations: CitationRef[];
  },
): EvidenceBundle {
  // 확정·차단본은 불변이다. 새 근거를 반영하려면 별도 draft/review 버전을
  // 만드는 흐름을 거쳐 다시 PB 상담 검토 승인을 받아야 한다.
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;

  const at = new Date().toISOString();
  let next: EvidenceBundle = {
    ...bundle,
    updatedAt: at,
    runId: newRunId(bundle.clientId),
    consultationInput: payload.consultationInput,
    ipsExtract: payload.ipsExtract,
    calcConfig: payload.calcConfig,
    calcResults: payload.calcResults,
    inputHash: payload.inputHash,
    settingsHash: payload.settingsHash,
    resultHash: payload.resultHash,
    outputHash: payload.resultHash,
    pendingReasons: [],
  };
  next = attachCitations(next, payload.citations);
  // Evidence 생성 시 결정론 Judge를 붙이되, PB 상담 검토 승인은 별도 사람 행동으로 남긴다.
  if (next.status !== "blocked") {
    next = applyJudge(next, judgeCalcResults(payload.calcResults), "engine");
  }
  next = appendRun(next, {
    kind: "snapshot",
    engine: ENGINE_SOURCE,
    inputHash: payload.inputHash,
    outputHash: payload.resultHash,
    notes: `Evidence Bundle 생성 · settings ${payload.settingsHash.slice(0, 8)} · result ${payload.resultHash.slice(0, 8)}`,
  });
  // Evidence 준비는 사람의 PB 상담 검토 승인을 대신하지 않는다.
  // canLock(next)가 true여도 명시적인 승인 버튼을 누르기 전에는 기존 상태를 유지한다.
  return next;
}

/**
 * review 고착 복구: soft gate면 Evidence 스냅샷을 붙인 뒤, 가능하면 locked.
 * UI/허브에서 비동기로 snap을 가져온 뒤 호출.
 */
export function completeApprovalIfReady(bundle: EvidenceBundle, actor = "PB"): EvidenceBundle {
  if (bundle.status === "locked" || bundle.status === "blocked") return bundle;
  if (hardStopReasons(bundle).length) {
    return approveByPb(bundle, actor);
  }
  if (canLock(bundle)) {
    return approveByPb(bundle, actor);
  }
  return bundle;
}
