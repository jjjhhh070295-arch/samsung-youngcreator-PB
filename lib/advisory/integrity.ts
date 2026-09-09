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
    // consultationNotes(상담 메모)는 여기 넣지 않는다.
    //
    // 이 해시는 "승인 후 계산 입력이 바뀌었는가"를 판정한다. 상담 메모는 계산에 들어가는
    // 값이 아니라 PB 가 남기는 서술이다 — 메모를 고쳐도 IPS·현금흐름·포트폴리오의 어떤
    // 숫자도 달라지지 않는다. 그런데 예전에는 notes 로 포함돼 있어서, 상담을 종료하며
    // 메모를 저장하는 것만으로 inputHash 가 어긋나 최종 PDF 가 막혔다.
    //
    // 워크플로 승인 해시(buildBasicApprovalPayload)와 정의를 맞추는 것이기도 하다.
    // 그쪽에는 consultationNotes 가 없다. 같은 "승인 후 변경"을 판정하면서 한쪽만 상담
    // 메모를 세면 두 판정이 어긋난다. verifyEvidenceAgainstClient 가 내는 문구
    // ("고객 기본정보·담당 PB·IPS·현금흐름·포트폴리오 입력이 변경되었습니다")도
    // 상담 메모를 열거하지 않는다 — 문구가 실제 판정 범위와 맞게 된다.
    //
    // 메모 자체가 검토 기록에서 사라지는 것은 아니다. snapshot.ts 가 consultationInput
    // 으로 따로 담는다. 해시 대상에서만 빠진다.
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

/**
 * consultationNotes가 계산 입력에 포함되던 구형 Evidence만 식별하기 위한 호환 해시.
 * 새 Evidence를 만들 때는 사용하지 않는다.
 */
export function legacyAdvisoryInputHash(client: Client, context: AdvisoryInputContext = {}): string {
  return hashObject({
    ...advisoryInputPayload(client, context),
    notes: client.consultationNotes,
  });
}

export function needsLegacyAdvisoryInputHashRefresh(
  inputHash: string,
  client: Client,
  context: AdvisoryInputContext = {},
): boolean {
  const currentHash = advisoryInputHash(client, context);
  return inputHash !== currentHash && inputHash === legacyAdvisoryInputHash(client, context);
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
