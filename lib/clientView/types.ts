// 고객 공유 링크가 브라우저로 내려보내는 payload.
//
// 원본 Client 를 그대로 보내지 않는 것이 이 타입의 존재 이유다. parties 행에는
// consultation_notes·notes·evidence·score 같은 PB 내부 기록이 섞여 있고, 지금
// /client/[clientId] 는 getClient() 로 그걸 전부 브라우저까지 가져온다.
// 여기서는 화면이 실제로 그리는 것만 화이트리스트로 담는다.
//
// 의도적으로 빠진 것:
//   id(UUID)            — 이 값이 없으면 payload 만으로 parties 를 다시 조회할 수 없다
//   consultationNotes   — PB 상담 메모
//   notes/evidence/score/reviewed/status/source — 내부 상태
//   pbId/email/emailOptIn/financialIncomeProfile — 화면이 쓰지 않는다
//   approvalHashes/stages — 서버에서 gates 로 환원한다
//   portfolios 원본     — taxNote 만 뽑는다. 나머지는 summary 에 정제돼 있다
//   미승인 초안(draft)  — 고객 링크에는 승인분만 보낸다(설계 결정)

import type { CashFlow, ClientType, IPS } from "@/lib/types";
import type { CustomerViewSummary } from "@/lib/customerViewSummary";

export const CLIENT_VIEW_PAYLOAD_VERSION = 1;

export interface ClientViewGates {
  basicReady: boolean;
  portfolioReady: boolean;
  ipsReady: boolean;
  /** stages.factors 단독. 7요인 레이더를 그릴지 판단하는 데만 쓴다. */
  factorsApproved: boolean;
}

export interface ClientViewProfile {
  code: string;
  name: string;
  clientType: ClientType;
  birthDate: string;
}

export interface ClientViewTax {
  comprehensive: boolean | null;
  note: string | null;
}

export interface ClientViewPayload {
  v: typeof CLIENT_VIEW_PAYLOAD_VERSION;
  /** 링크 만료(ISO). 화면 하단에 유효기간으로 띄운다. */
  expiresAt: string;
  profile: ClientViewProfile;
  gates: ClientViewGates;
  /** = parties.asset_size. lib/assets.ts 의 investableKrw 와 같은 값이다. */
  investableWon: number;
  ips: IPS;
  cashFlows: CashFlow[];
  tax: ClientViewTax | null;
  summary: CustomerViewSummary;
}
