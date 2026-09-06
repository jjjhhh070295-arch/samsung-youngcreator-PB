/**
 * 고객 상세 3단 승인 — client.stages 플래그로 7단계 파이프라인을 묶는다.
 * 1) 기본정보 승인 → stages basic/factors/cashflow (파이프라인 1~3)
 * 2) 포트폴리오 승인 → stages portfolio/stress (파이프라인 4~6)
 * 3) IPS 승인 → stages ips (파이프라인 7)
 *
 * 승인은 토글 가능. 앞 단계 취소 시 종속 후속 승인도 함께 해제한다.
 */

import type { Client, Stages } from "../types";
import type { EvidenceBundle } from "./types";
import { validateManualPortfolioForApproval } from "../manualPortfolioDraft";
import { financialIncomeBlockReason, isFinancialIncomeReadyForTax } from "../financialIncome";

export function isBasicWorkflowApproved(client: Client): boolean {
  const s = client.stages ?? {};
  return !!(s.basic && s.factors && s.cashflow);
}

export function isPortfolioWorkflowApproved(client: Client): boolean {
  const s = client.stages ?? {};
  return !!(s.portfolio && s.stress);
}

export function isIpsWorkflowApproved(client: Client): boolean {
  return !!client.stages?.ips;
}

export function basicApprovalStagePatch(): Stages {
  return { basic: true, factors: true, cashflow: true };
}

export function portfolioApprovalStagePatch(): Stages {
  return { portfolio: true, stress: true };
}

export function ipsApprovalStagePatch(): Stages {
  return { ips: true };
}

/** 기본정보 취소 → 1~3 + 종속 포트폴리오(4~6)·IPS(7) 해제 */
export function basicUnapprovalStagePatch(): Stages {
  return {
    basic: false,
    factors: false,
    cashflow: false,
    portfolio: false,
    stress: false,
    ips: false,
  };
}

/** 포트폴리오 취소 → 4~6 + 종속 IPS(7) 해제 (기본정보 유지) */
export function portfolioUnapprovalStagePatch(): Stages {
  return { portfolio: false, stress: false, ips: false };
}

/** IPS 취소 → 7만 해제 */
export function ipsUnapprovalStagePatch(): Stages {
  return { ips: false };
}

export const MSG_BASIC_APPROVED = "기본정보 승인 완료";
export const MSG_BASIC_UNAPPROVED =
  "기본정보 승인 취소됨. 포트폴리오와 IPS 승인이 초기화되었습니다.";
export const MSG_PORTFOLIO_APPROVED = "포트폴리오 승인 완료";
export const MSG_PORTFOLIO_UNAPPROVED =
  "포트폴리오 승인 취소됨. IPS 승인이 초기화되었습니다.";
export const MSG_IPS_APPROVED = "IPS 승인 완료";
export const MSG_IPS_UNAPPROVED = "IPS 승인 취소됨. 최종 PDF 발행이 비활성화되었습니다.";

export function validateBasicWorkflowApproval(client: Client): string[] {
  const reasons: string[] = [];
  if (!client.name?.trim()) reasons.push("고객 이름이 없습니다.");
  if (!client.code?.trim()) reasons.push("고객 식별코드가 없습니다.");
  const ipsFilled = Object.values(client.ips ?? {}).some((f) => f?.value);
  if (!ipsFilled) {
    reasons.push("7요인(RRTTLLU) 값이 비어 있습니다. 설문 또는 요인 입력을 완료하세요.");
  }
  return reasons;
}

export function validatePortfolioWorkflowApproval(client: Client, clientId: string): string[] {
  const reasons: string[] = [];
  if (!isBasicWorkflowApproved(client)) {
    reasons.push("기본정보 승인이 먼저 필요합니다.");
  }
  reasons.push(...validateManualPortfolioForApproval(clientId));
  if (!isFinancialIncomeReadyForTax(client)) {
    reasons.push(financialIncomeBlockReason(client) || "금융소득 종합과세 정보가 부족합니다.");
  }
  return reasons;
}

export function validateIpsWorkflowApproval(client: Client, _bundle: EvidenceBundle): string[] {
  const reasons: string[] = [];
  if (!isBasicWorkflowApproved(client)) {
    reasons.push("기본정보 승인이 먼저 필요합니다.");
  }
  if (!isPortfolioWorkflowApproved(client)) {
    reasons.push("포트폴리오 승인이 먼저 필요합니다.");
  }
  // Evidence blocked/하드스톱은 IPS 승인 시 syncEvidenceAfterIpsApproval에서 해제한다.
  return reasons;
}

/** 고객용 PDF — 3단 승인(client.stages) 완료. Evidence는 승인 sync가 locked로 맞춘다. */
export function workflowPdfReady(client: Client, _bundle: EvidenceBundle): boolean {
  return (
    isBasicWorkflowApproved(client) &&
    isPortfolioWorkflowApproved(client) &&
    isIpsWorkflowApproved(client)
  );
}

export function workflowPdfBlockReason(client: Client, bundle: EvidenceBundle): string {
  if (workflowPdfReady(client, bundle)) return "";
  const ipsReasons = validateIpsWorkflowApproval(client, bundle);
  if (ipsReasons.length) return ipsReasons[0];
  if (!isIpsWorkflowApproved(client)) return "IPS 승인 후 고객용 최종 PDF를 발행할 수 있습니다.";
  return "문서 발행 조건을 확인하세요.";
}
