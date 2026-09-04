import type { Client } from "../types";
import type { AdvisoryStatus, EvidenceBundle, PipelineStep, PipelineStepState } from "./types";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "./workflowApprovals";

export const PIPELINE_STEPS: { id: PipelineStep["id"]; label: string }[] = [
  { id: "consult", label: "상담입력" },
  { id: "ips", label: "IPS 추출" },
  { id: "approve", label: "PB 상담 검토 승인" },
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

/**
 * 7단계 표시 — 3단 승인(client.stages)을 우선하고,
 * Evidence locked/blocked는 차단·레거시 호환에 사용한다.
 */
export function buildPipeline(client: Client, bundle: EvidenceBundle): PipelineStep[] {
  const blocked = bundle.status === "blocked";
  const notes = (client.consultationNotes || bundle.consultationInput || "").trim();
  const ipsFilled = Object.values(client.ips).some((f) => f.value);
  const ipsReview = Object.values(client.ips).some((f) => f.status === "inferred" && !f.reviewed);
  const locked = bundle.status === "locked";
  const basicApproved = isBasicWorkflowApproved(client) || locked;
  const portfolioApproved = isPortfolioWorkflowApproved(client);
  const ipsApproved = isIpsWorkflowApproved(client);
  const hasConfirmedPortfolio = !!client.stages?.portfolio && client.portfolios.length > 0;
  const hasManualOrConfirmed = portfolioApproved || hasConfirmedPortfolio;

  return [
    {
      id: "consult",
      label: "상담입력",
      state: stateOf(basicApproved || notes.length > 0, false, false),
      note: basicApproved
        ? "기본정보 승인 완료"
        : notes
          ? "상담 원문 확보"
          : "기본 정보·상담 입력을 확인하세요",
    },
    {
      id: "ips",
      label: "IPS 추출",
      state: stateOf(
        basicApproved || (ipsFilled && !ipsReview),
        !basicApproved && ipsFilled && ipsReview,
        false,
      ),
      note: basicApproved
        ? "기본정보 승인 완료"
        : ipsReview
          ? "추론 항목 검토필요"
          : ipsFilled
            ? "RRTTLLU 추출됨"
            : "7요인 입력 후 기본정보 승인",
    },
    {
      id: "approve",
      label: "PB 상담 검토 승인",
      state: stateOf(basicApproved, !basicApproved && !blocked, blocked),
      note: blocked
        ? bundle.blockReasons[0] || "고객 제안 차단"
        : basicApproved
          ? "기본정보 승인 완료"
          : "기본 정보 탭에서 「기본정보 승인」",
    },
    {
      id: "portfolio",
      label: "포트폴리오 비교",
      state: stateOf(
        portfolioApproved,
        !portfolioApproved && hasManualOrConfirmed && basicApproved,
        blocked && !portfolioApproved,
      ),
      note: !basicApproved
        ? "기본정보 승인 후 진행"
        : portfolioApproved
          ? client.portfolios[0]?.label || "포트폴리오 승인 완료"
          : "포트폴리오 2에서 구성 후 「포트폴리오 승인」",
    },
    {
      id: "risk",
      label: "리스크/스트레스",
      state: stateOf(
        portfolioApproved,
        !portfolioApproved && basicApproved,
        blocked && !portfolioApproved,
      ),
      note: portfolioApproved
        ? "포트폴리오 승인에 포함됨"
        : "포트폴리오 승인 시 함께 완료",
    },
    {
      id: "tax",
      label: "세전·세금·비용·세후",
      state: stateOf(
        portfolioApproved,
        !portfolioApproved && basicApproved,
        blocked && !portfolioApproved,
      ),
      note: portfolioApproved
        ? "세전·세후 결과 확인·승인 완료"
        : "포트폴리오 2 하단 세전·세후 결과 확인 후 승인",
    },
    {
      id: "pdf",
      label: "PDF",
      state: stateOf(ipsApproved, !ipsApproved && portfolioApproved && basicApproved, blocked),
      note: blocked
        ? "고객 제안 차단"
        : ipsApproved
          ? "고객용 최종본 가능"
          : !basicApproved || !portfolioApproved
            ? "앞 단계 승인 후 IPS 탭에서 승인"
            : "IPS 탭에서 「IPS 승인」",
    },
  ];
}

/** 파이프라인 '현재 단계' — 승인(review)을 최우선으로 표시. */
export function currentPipelineStep(steps: PipelineStep[]): PipelineStep {
  const blocked = steps.find((s) => s.state === "blocked");
  if (blocked) return blocked;
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
  if (status === "review") return approve.state === "review" || approve.state === "pending";
  return approve.state === "pending" || approve.state === "review";
}
