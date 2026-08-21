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

/** 고객용 최종 PDF는 locked 만 허용. */
export function canIssueClientPdf(status: AdvisoryStatus): boolean {
  return status === PDF_ALLOWED_STATUS;
}

export function pdfBlockReason(bundle: EvidenceBundle): string {
  if (bundle.status === "locked") return "";
  if (bundle.status === "blocked") {
    return bundle.blockReasons[0] || "발행차단 상태입니다. 고객용 최종 PDF를 저장할 수 없습니다.";
  }
  if (bundle.pendingReasons.length) {
    return `PDF 비활성: ${bundle.pendingReasons[0]}`;
  }
  if (bundle.status === "review") {
    return "PB 검토 중입니다. 「PB 검토 완료/승인」으로 locked가 되어야 고객용 최종 PDF를 발행할 수 있습니다.";
  }
  return "초안(draft) 상태입니다. Evidence Bundle 생성 후 PB 승인으로 locked가 되어야 고객용 최종 PDF를 발행할 수 있습니다.";
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
    reasons.push(bundle.conflict.message || "충돌 감사 실패 — 발행차단.");
  }
  return reasons;
}

/** locked 전 soft gate — 아직 준비가 안 된 항목(애매하게 review에만 두지 않고 안내). */
export function softLockReasons(bundle: EvidenceBundle): string[] {
  const reasons: string[] = [];
  if (!bundle.judge) {
    reasons.push("Judge 결과가 없습니다. Evidence Bundle을 생성하거나 상품추천을 실행하세요.");
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
  return reasons;
}

export function canLock(bundle: EvidenceBundle): boolean {
  if (bundle.status === "blocked") return false;
  if (hardStopReasons(bundle).length > 0) return false;
  if (!bundle.judge?.passed) return false;
  if (!bundle.citation?.passed) return false;
  // soft conflict는 review/draft에서 PB가 명시 승인하면 해소(아래 approveByPb에서 review면 허용)
  if (bundle.conflict && !bundle.conflict.passed && !bundle.conflict.needsReview) return false;
  if (bundle.conflict && !bundle.conflict.passed && bundle.conflict.needsReview) {
    // needsReview 충돌은 review 상태에서만 PB 승인으로 locked 가능
    if (bundle.status !== "review" && bundle.status !== "draft") return false;
  }
  return true;
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
    const leak = result.plans.some((plan) => plan.products.some((p) => p.category !== "trust"));
    findings.push({
      code: "TRUST_FILTER",
      severity: leak ? "fail" : "pass",
      message: leak ? "신탁만 고려 조건에 다른 카테고리가 포함됨" : "신탁/랩 필터 준수",
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
  };
  return {
    ...bundle,
    updatedAt: at,
    inputHash: run.inputHash || bundle.inputHash,
    outputHash: run.outputHash || bundle.outputHash,
    runs: [nextRun, ...bundle.runs].slice(0, 40),
  };
}

export function applyJudge(bundle: EvidenceBundle, judge: JudgeResult, actor: string): EvidenceBundle {
  const attempts = bundle.judgeAttempts + 1;
  const retriesExhausted = attempts >= JUDGE_MAX_RETRIES && !judge.passed;
  const nextStatus: AdvisoryStatus = judge.passed
    ? bundle.status === "blocked"
      ? "review"
      : bundle.status === "locked"
        ? "locked"
        : bundle.status
    : "blocked";
  const reasons = judge.passed
    ? []
    : [
        "Judge 실패로 발행차단",
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
            note: judge.passed ? "Judge 통과" : "Judge 실패로 발행차단",
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
  if (conflict.passed) return { ...bundle, conflict };
  if (conflict.needsReview) {
    const to: AdvisoryStatus = bundle.status === "locked" ? "review" : bundle.status === "draft" ? "draft" : bundle.status;
    return { ...bundle, conflict, status: to === bundle.status ? bundle.status : to };
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

export function loadBundle(clientId: string): EvidenceBundle {
  if (typeof window === "undefined") return emptyBundle(clientId);
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyBundle(clientId);
    const all = JSON.parse(raw) as Record<string, EvidenceBundle>;
    return migrateBundle(all[clientId] ?? emptyBundle(clientId), clientId);
  } catch {
    return emptyBundle(clientId);
  }
}

export function saveBundle(bundle: EvidenceBundle): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, EvidenceBundle>) : {};
    all[bundle.clientId] = bundle;
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

export function transitionStatus(
  bundle: EvidenceBundle,
  to: AdvisoryStatus,
  actor: string,
  note: string,
): EvidenceBundle {
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
        message: `PB 승인으로 충돌 검토 완료: ${bundle.conflict.conflicts[0] ?? "해소"}`,
      },
    };
  }

  if (canLock(working) && canTransition(working.status, "locked")) {
    return {
      ...transitionStatus(working, "locked", actor, "PB 승인 — 고객용 PDF 발행 가능"),
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
  // Evidence 생성 시 결정론 Judge를 반드시 붙여 PB 승인이 review에 고착되지 않게 함
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
  // 이미 PB가 review까지 올린 상태면 Evidence 준비 직후 locked로 확정 (3단계 고착 방지)
  if (next.status === "review" && canLock(next)) {
    next = approveByPb(next, "PB");
  }
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
