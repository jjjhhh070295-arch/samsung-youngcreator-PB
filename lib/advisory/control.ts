import type {
  AdvisoryStatus,
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

export function emptyBundle(clientId: string): EvidenceBundle {
  const now = new Date().toISOString();
  return {
    id: newBundleId(clientId),
    clientId,
    createdAt: now,
    updatedAt: now,
    status: "draft",
    inputHash: "",
    outputHash: "",
    runs: [],
    judge: null,
    approvals: [],
  };
}

export function canIssueClientPdf(status: AdvisoryStatus): boolean {
  return status !== "blocked";
}

const ALLOWED: Record<AdvisoryStatus, AdvisoryStatus[]> = {
  draft: ["review", "blocked"],
  review: ["locked", "blocked", "draft"],
  locked: ["review"],
  blocked: ["review", "draft"],
};

export function canTransition(from: AdvisoryStatus, to: AdvisoryStatus): boolean {
  return ALLOWED[from].includes(to);
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

  const confirmedWeight = JSON.stringify(result).match(/"weight"\s*:\s*\d/);
  findings.push({
    code: "NO_AI_WEIGHT",
    severity: confirmedWeight ? "fail" : "pass",
    message: confirmedWeight
      ? "확정 비중 필드가 포함되어 발행을 차단합니다"
      : "확정 비중 없음 (초안 구간만 표시)",
  });

  const taxAmount = /확정\s*세액|taxAmount|var\b|cvar\b/i.test(JSON.stringify(result));
  findings.push({
    code: "NO_AI_TAX_VAR",
    severity: taxAmount ? "fail" : "pass",
    message: taxAmount ? "세금 또는 VaR/CVaR 확정값이 포함됨" : "세금·VaR/CVaR 미확정 유지",
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
  const nextStatus: AdvisoryStatus = judge.passed
    ? bundle.status === "blocked"
      ? "review"
      : bundle.status
    : "blocked";
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
    approvals,
  };
}

const LS_KEY = "pb-advisory-evidence-v1";

export function loadBundle(clientId: string): EvidenceBundle {
  if (typeof window === "undefined") return emptyBundle(clientId);
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyBundle(clientId);
    const all = JSON.parse(raw) as Record<string, EvidenceBundle>;
    return all[clientId] ?? emptyBundle(clientId);
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
  if (to === "locked" && bundle.judge && !bundle.judge.passed) return bundle;
  const at = new Date().toISOString();
  return {
    ...bundle,
    updatedAt: at,
    status: to,
    approvals: [{ at, actor, from: bundle.status, to, note }, ...bundle.approvals],
  };
}
