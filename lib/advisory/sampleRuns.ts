import { emptyBundle } from "./control";
import type { EvidenceBundle } from "./types";

/** 성공 실행 1건 — locked, Judge/인용 통과. 스크린샷이 아니라 파이프라인 JSON. */
export function sampleSuccessBundle(): EvidenceBundle {
  const base = emptyBundle("sample-success");
  return {
    ...base,
    id: "evb-sample-success",
    runId: "run-sample-success",
    status: "locked",
    consultationInput: "해외주식만, 기대수익률 20% 이상, 개별주식 선호",
    ipsExtract: { return: { value: "20%+", reviewed: true }, risk: { value: "적극", reviewed: true } },
    inputHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    settingsHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    resultHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    outputHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    judgeAttempts: 1,
    citations: [
      { sourceId: "eng-risk-parametric", title: "파라메트릭 VaR", asOf: "2026-08-01", chunkId: "risk-engine-v1" },
    ],
    citation: { passed: true, count: 1, incompleteIds: [], message: "인용 1건 메타데이터 통과" },
    conflict: { passed: true, needsReview: false, conflicts: [], message: "충돌 없음" },
    judge: {
      at: "2026-08-01T09:00:00.000Z",
      passed: true,
      findings: [{ code: "ASOF", severity: "pass", message: "as-of 2026-08-01" }],
    },
    blockReasons: [],
    approvals: [
      {
        at: "2026-08-01T09:05:00.000Z",
        actor: "PB",
        from: "review",
        to: "locked",
        note: "PB 승인 — 고객용 PDF 발행 가능",
      },
    ],
    runs: [
      {
        id: "run-ok-1",
        at: "2026-08-01T09:00:00.000Z",
        kind: "snapshot",
        engine: "deterministic-engine",
        inputHash: "aaaa",
        outputHash: "cccc",
        notes: "성공 샘플 — 핵심 수치 재현",
      },
    ],
  };
}

/** 의도적 blocked 실행 — 인용 실패로 locked 불가. */
export function sampleBlockedBundle(): EvidenceBundle {
  const base = emptyBundle("sample-blocked");
  return {
    ...base,
    id: "evb-sample-blocked",
    runId: "run-sample-blocked",
    status: "blocked",
    consultationInput: "신탁만 고려",
    ipsExtract: { unique: { value: "신탁만", reviewed: false } },
    inputHash: "1111111111111111111111111111111111111111111111111111111111111111",
    settingsHash: "2222222222222222222222222222222222222222222222222222222222222222",
    resultHash: "3333333333333333333333333333333333333333333333333333333333333333",
    outputHash: "3333333333333333333333333333333333333333333333333333333333333333",
    judgeAttempts: 2,
    citations: [{ sourceId: "", title: "블로그 요약", asOf: "", chunkId: "" }],
    citation: {
      passed: false,
      count: 1,
      incompleteIds: ["(empty)"],
      message: "인용 1건에 sourceId/title/as-of/chunkId가 없음 — citation failed",
    },
    conflict: {
      passed: false,
      needsReview: false,
      conflicts: ["신탁만 고려 조건에 ETF가 포함됨"],
      message: "충돌 감사 실패: 신탁만 고려 조건에 ETF가 포함됨",
    },
    judge: {
      at: "2026-08-01T10:00:00.000Z",
      passed: false,
      findings: [{ code: "TRUST_FILTER", severity: "fail", message: "신탁만 고려 조건에 다른 카테고리가 포함됨" }],
    },
    blockReasons: [
      "Judge 실패로 발행차단",
      "TRUST_FILTER: 신탁만 고려 조건에 다른 카테고리가 포함됨",
      "인용 검증 실패 — 고객 확정본 PDF 발행 불가.",
    ],
    approvals: [
      {
        at: "2026-08-01T10:00:00.000Z",
        actor: "engine",
        from: "draft",
        to: "blocked",
        note: "Judge 실패로 발행차단",
      },
    ],
    runs: [
      {
        id: "run-block-1",
        at: "2026-08-01T10:00:00.000Z",
        kind: "judge",
        engine: "deterministic-engine",
        inputHash: "1111",
        outputHash: "3333",
        notes: "blocked 샘플 — PDF 발행 불가",
      },
    ],
  };
}
