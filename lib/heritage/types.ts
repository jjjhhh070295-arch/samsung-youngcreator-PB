// 헤리티지(신탁·상속·증여) 상담 수요 판정 + 긴급도 계산 — 공용 타입.
//
// 이 모듈이 하는 일은 두 가지뿐이다:
//   (1) 이 고객에게 신탁·승계 상담 수요가 있는가?
//   (2) 있다면 언제 상담 일정을 잡아야 하는가?
// 세금을 계산하지 않는다(정밀 세액 산정은 세무사·회계사의 일). 상속세액은 3번 단계에서
// "상담이 필요한 규모인지"를 가늠할 개략 추정치만 낸다.

import type { ClientType, TransferEvent } from "../types";

export interface HeritageChild {
  /** 있으면 미성년 판정에 사용한다. 없으면(모름) 미성년 여부 판단에서 그 자녀는 제외한다. */
  birthDate?: string | null;
}

export interface HeritageAssessmentInput {
  /** 기준일. 테스트에서만 고정값을 넘긴다 — 기본은 현재 시각. */
  asOf?: Date;
  clientType: ClientType;
  /** 개인 고객의 생년월일. 법인이면 null. */
  birthDate: string | null;
  assetSizeWon: number;
  /** 0~100. 모르면 null(구조 신호 하나가 빠졌다는 뜻이며, 판정에서는 단순히 반영하지 않는다). */
  realEstateWeightPct: number | null;
  hasSpouse: boolean;
  children: HeritageChild[];
  /** 이 고객이 증여자(fromPartyId)인 gift 타입 TransferEvent만 호출부에서 걸러 넘긴다. */
  givenGiftEvents: TransferEvent[];
  /** lib/rrttlluScoring.ts에서 이미 매칭된 태그 id (예: "inheritance","gift","trust","corporate","family_gov","philanthropy"). */
  taxTagIds: string[];
}

export interface HeritageReason {
  code: string;
  /** PB가 고객에게 그대로 말할 수 있는 한 문장. */
  text: string;
}

export interface HeritageDemandResult {
  hasNeed: boolean;
  /** 0~100. 랭킹·우선순위용. hasNeed=false여도 참고용으로 남긴다. */
  score: number;
  reasons: HeritageReason[];
  /** 판정에 쓰인 개략 예상 공제액(원) — 투명성을 위해 노출. */
  estimatedExemptionWon: number;
  /** 총자산 - 예상 공제액. 0 미만이면 0. */
  taxableExcessWon: number;
}

export type HeritageUrgencyLevel = "즉시" | "3개월 내" | "6개월 내" | "1년 내" | "해당없음";

export interface HeritageUrgencyResult {
  level: HeritageUrgencyLevel;
  reasons: HeritageReason[];
  ageAtAssessment: number | null;
}

export interface HeritageAssessment {
  demand: HeritageDemandResult;
  urgency: HeritageUrgencyResult;
}
