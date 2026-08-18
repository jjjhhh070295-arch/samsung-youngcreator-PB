import type { Client } from "../types";
import type { AdvisoryStatus, EvidenceBundle, PipelineStep, PipelineStepState } from "./types";

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
  const approved = bundle.status === "review" || bundle.status === "locked";
  const portfolio = !!client.stages?.portfolio && client.portfolios.length > 0;
  const risk = !!client.stages?.stress || !!bundle.calcResults?.stress?.length;
  const tax = !!bundle.calcResults?.waterfall || portfolio;
  const pdfLocked = bundle.status === "locked";

  const statusNote = (s: AdvisoryStatus) =>
    s === "blocked" ? bundle.blockReasons[0] || "발행차단" : s;

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
      state: stateOf(pdfLocked, approved && !pdfLocked, blocked),
      note: statusNote(bundle.status),
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
      state: stateOf(pdfLocked, bundle.status === "review", blocked || bundle.status === "draft"),
      note: pdfLocked ? "고객용 최종본 가능" : blocked ? "발행차단" : "locked 전 비활성",
    },
  ];
}
