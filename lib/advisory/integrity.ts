import type { Client } from "../types";
import type { EvidenceBundle } from "./types";
import { hashObject } from "./hash";

export interface AdvisoryInputContext {
  /** PDF에 실제로 표시되는 담당 PB 이름. PB ID와 함께 해시해 마스터 이름 변경도 탐지한다. */
  assignedPbDisplay?: string;
}

export function advisoryInputPayload(client: Client, context: AdvisoryInputContext = {}) {
  return {
    clientId: client.id,
    customerName: client.name,
    customerCode: client.code,
    birthDate: client.birthDate,
    assignedPb: {
      id: client.assignedPbId,
      display: context.assignedPbDisplay ?? client.assignedPbId,
    },
    linkedClientId: client.linkedClientId ?? null,
    accountSeparation: client.accountSeparation ?? null,
    ownershipPct: client.ownershipPct ?? null,
    isMajorityShareholder: client.isMajorityShareholder ?? null,
    notes: client.consultationNotes,
    ips: client.ips,
    cashFlows: client.cashFlows,
    portfolios: client.portfolios,
    assetSize: client.assetSize,
    clientType: client.clientType,
  };
}

export function advisoryInputHash(client: Client, context: AdvisoryInputContext = {}): string {
  return hashObject(advisoryInputPayload(client, context));
}

/** 서버에서 현재 고객 원본과 검토 기록의 핵심 계산값을 다시 해시해 비교한다. */
export function verifyEvidenceAgainstClient(
  bundle: EvidenceBundle,
  client: Client,
  context: AdvisoryInputContext = {},
) {
  const reasons: string[] = [];
  if (bundle.clientId !== client.id) reasons.push("검토 기록의 고객 식별자가 현재 고객과 다릅니다.");
  if (!bundle.calcConfig) reasons.push("계산 설정이 없습니다.");
  if (!bundle.calcResults) reasons.push("계산 결과가 없습니다.");

  if (bundle.inputHash !== advisoryInputHash(client, context)) {
    reasons.push("승인 후 고객 기본정보·담당 PB·IPS·현금흐름·포트폴리오 입력이 변경되었습니다.");
  }
  if (bundle.calcConfig && bundle.settingsHash !== hashObject(bundle.calcConfig)) {
    reasons.push("계산 설정 확인값이 현재 검토 기록과 일치하지 않습니다.");
  }
  if (bundle.calcResults && bundle.resultHash !== hashObject(bundle.calcResults)) {
    reasons.push("계산 결과 확인값이 현재 검토 기록과 일치하지 않습니다.");
  }
  if (bundle.outputHash !== bundle.resultHash) {
    reasons.push("문서 출력 확인값과 계산 결과 확인값이 일치하지 않습니다.");
  }

  return { verified: reasons.length === 0, reasons };
}
