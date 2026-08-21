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
  const portfolio = !!client.stages?.portfolio && client.portfolios.length > 0;
  const risk = !!client.stages?.stress || !!bundle.calcResults?.stress?.length;
  const tax = !!bundle.calcResults?.waterfall || portfolio;
  const soft = softLockReasons(bundle);
  const lockReady = canLock(bundle) && !blocked;

  const approveNote = (): string => {
    if (blocked) return bundle.blockReasons[0] || "발행차단";
    if (locked) return "locked · PB 승인 완료";
    if (lockReady) return "조건 충족 — 「PB 검토 완료/승인」을 누르면 locked";
    if (inReview || soft.length) {
      return (bundle.pendingReasons[0] || soft[0] || "검토필요") + " · 아래 CTA 확인";
    }
    if (bundle.status === "draft") return "draft — Evidence 생성 후 PB 승인";
    return bundle.status;
  };

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
      state: stateOf(locked, !lockReady && (inReview || soft.length > 0) && !locked && !blocked, blocked),
      note: approveNote(),
    },
    {
      id: "portfolio",
      label: "포트폴리오 비교",
      state: stateOf(portfolio, false, blocked && !portfolio),
      note: portfolio ? client.portfolios[0]?.label || "확정됨" : "A/B/C 비교 후 확정 필요",
    },
    {
      id: "risk",
      label: "리스크/스트레스",
      state: stateOf(risk, portfolio && !risk, blocked),
      note: risk ? "VaR/CVaR·시나리오 산출" : "포트폴리오 확정 후 산출",
    },
    {
      id: "tax",
      label: "세전·세금·비용·세후",
      state: stateOf(tax, false, blocked),
      note: tax ? "워터폴 산출" : "세후 워터폴 대기",
    },
    {
      id: "pdf",
      label: "PDF",
      state: stateOf(locked, inReview, blocked || bundle.status === "draft"),
      note: locked
        ? "고객용 최종본 가능"
        : blocked
          ? "발행차단"
          : inReview
            ? "locked 전 비활성 — PB 승인 필요"
            : "locked 전 비활성",
    },
  ];
}

/** 파이프라인 '현재 단계' — review에만 고정되지 않고, 다음 pending을 우선 표시. */
export function currentPipelineStep(steps: PipelineStep[]): PipelineStep {
  const blocked = steps.find((s) => s.state === "blocked");
  if (blocked) return blocked;
  const pending = steps.find((s) => s.state === "pending");
  const review = steps.find((s) => s.state === "review");
  // 승인 단계가 review이고 그 외는 완료면 승인 카드가 현재
  if (review?.id === "approve") return review;
  if (pending) return pending;
  if (review) return review;
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
