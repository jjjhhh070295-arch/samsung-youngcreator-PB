import type { Client } from "../types";
import type { AdvisoryStatus, EvidenceBundle, PipelineStep, PipelineStepState } from "./types";
import { canLock, softLockReasons } from "./control";

export const PIPELINE_STEPS: { id: PipelineStep["id"]; label: string }[] = [
  { id: "consult", label: "상담입력" },
  { id: "ips", label: "IPS 추출" },
  { id: "approve", label: "PB 승인" },
  { id: "portfolio", label: "포트폴리오 비교" },
  { id: "risk", label: "리스크/스트레스" },
  { id: "tax", label: "세전·세금·비용·세후" },
  { id: "pdf", label: "PDF" },
];

function stateOf(complete: boolean, review: boolean, blocked: boolean): PipelineStepState {
  if (blocked) return "blocked";
  if (complete) return "complete";
  if (review) return "review";
  return "pending";
}

export function buildPipeline(client: Client, bundle: EvidenceBundle): PipelineStep[] {
  const blocked = bundle.status === "blocked";
  const notes = (client.consultationNotes || bundle.consultationInput || "").trim();
  const ipsFilled = Object.values(client.ips).some((f) => f.value);
  const ipsReview = Object.values(client.ips).some((f) => f.status === "inferred" && !f.reviewed);
  const locked = bundle.status === "locked";
  const inReview = bundle.status === "review";
  const portfolioDone = !!client.stages?.portfolio && client.portfolios.length > 0;
  const riskDone = !!client.stages?.stress || !!bundle.calcResults?.stress?.length;
  const taxDone = !!bundle.calcResults?.waterfall || portfolioDone;
  const soft = softLockReasons(bundle);
  const lockReady = canLock(bundle) && !blocked;

  // PB 승인(locked) 전에는 하위 단계를 "완료"로 보이지 않게 — 3단계 고착 착시 방지
  const downstreamComplete = locked;

  const approveNote = (): string => {
    if (blocked) return bundle.blockReasons[0] || "발행차단";
    if (locked) return "locked · PB 승인 완료";
    if (lockReady) return "조건 충족 — 금색 승인 버튼 → locked";
    if (inReview || soft.length) {
      return bundle.pendingReasons[0] || soft[0] || "금색 「PB 검토 완료/승인」 버튼을 누르세요";
    }
    if (bundle.status === "draft") return "draft — 금색 승인 버튼으로 Evidence+locked";
    return bundle.status;
  };

  const approveReview =
    !locked &&
    !blocked &&
    (inReview || (!lockReady && soft.length > 0) || (lockReady && bundle.status !== "locked"));

  return [
    {
      id: "consult",
      label: "상담입력",
      state: stateOf(notes.length > 0, false, false),
      note: notes ? "상담 원문 확보" : "상담 메모가 없습니다",
    },
    {
      id: "ips",
      label: "IPS 추출",
      state: stateOf(ipsFilled && !ipsReview, ipsFilled && ipsReview, false),
      note: ipsReview ? "추론 항목 검토필요" : ipsFilled ? "RRTTLLU 추출됨" : "IPS 미추출",
    },
    {
      id: "approve",
      label: "PB 승인",
      state: stateOf(locked, approveReview && !locked, blocked),
      note: approveNote(),
    },
    {
      id: "portfolio",
      label: "포트폴리오 비교",
      state: stateOf(downstreamComplete && portfolioDone, portfolioDone && !locked, blocked && !portfolioDone),
      note: !portfolioDone
        ? "A/B/C 비교 후 확정 필요"
        : locked
          ? client.portfolios[0]?.label || "확정됨"
          : `${client.portfolios[0]?.label || "산출됨"} · PB locked 대기`,
    },
    {
      id: "risk",
      label: "리스크/스트레스",
      state: stateOf(downstreamComplete && riskDone, riskDone && !locked, blocked),
      note: !riskDone
        ? "포트폴리오 확정 후 산출"
        : locked
          ? "VaR/CVaR·시나리오 산출"
          : "산출됨 · PB locked 대기",
    },
    {
      id: "tax",
      label: "세전·세금·비용·세후",
      state: stateOf(downstreamComplete && taxDone, taxDone && !locked, blocked),
      note: !taxDone ? "세후 워터폴 대기" : locked ? "워터폴 산출" : "산출됨 · PB locked 대기",
    },
    {
      id: "pdf",
      label: "PDF",
      state: stateOf(locked, inReview || (!locked && !blocked), blocked),
      note: locked
        ? "고객용 최종본 가능"
        : blocked
          ? "발행차단"
          : "locked 전 비활성 — 3단계 승인 필요",
    },
  ];
}

/** 파이프라인 '현재 단계' — 승인(review)을 최우선으로 표시. */
export function currentPipelineStep(steps: PipelineStep[]): PipelineStep {
  const blocked = steps.find((s) => s.state === "blocked");
  if (blocked) return blocked;
  const approve = steps.find((s) => s.id === "approve");
  if (approve && approve.state !== "complete") return approve;
  const review = steps.find((s) => s.state === "review");
  if (review) return review;
  const pending = steps.find((s) => s.state === "pending");
  if (pending) return pending;
  return steps[steps.length - 1];
}

export function pipelineMatchesStatus(steps: PipelineStep[], status: AdvisoryStatus): boolean {
  const approve = steps.find((s) => s.id === "approve");
  if (!approve) return false;
  if (status === "locked") return approve.state === "complete";
  if (status === "blocked") return approve.state === "blocked";
  if (status === "review") return approve.state === "review";
  return approve.state === "pending" || approve.state === "review";
}
