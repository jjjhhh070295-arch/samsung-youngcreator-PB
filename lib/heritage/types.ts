// 헤리티지(신탁·상속·증여) 상담 수요 판정 + 긴급도 계산 — 공용 타입.
//
// 이 모듈이 하는 일은 두 가지뿐이다:
//   (1) 이 고객에게 신탁·승계 상담 수요가 있는가?
//   (2) 있다면 언제 상담 일정을 잡아야 하는가?
// 세금을 계산하지 않는다(정밀 세액 산정은 세무사·회계사의 일). 상속세액은 "상담이 필요한
// 규모인지"를 가늠할 개략 추정치(구간)만 낸다. 법인 고객은 이 트랙에서 다루지 않는다 —
// 가업승계는 최대주주 개인 쪽에 "별도 검토" 표시만 달고(succession.ts) 실제 판정 로직은
// 만들지 않는다.

import type { ClientType, TransferEvent } from "../types";

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
  /** 자녀 수만 쓴다(자녀공제 계산용) — 자녀 개별 생년월일/미성년 여부는 판정에 쓰지 않는다.
   *  이유: 세대생략증여(조부모→손자)가 흔해 자녀의 성년 여부가 증여 시점을 결정하지 못한다. */
  childrenCount: number;
  /** 이 고객이 증여자(fromPartyId)인 gift 타입 TransferEvent만 호출부에서 걸러 넘긴다. */
  givenGiftEvents: TransferEvent[];
  /** lib/rrttlluScoring.ts에서 이미 매칭된 태그 id (예: "inheritance","gift","trust","corporate","family_gov","philanthropy"). */
  taxTagIds: string[];
}

export interface HeritageReason {
  code: string;
  /** PB가 고객에게 그대로 말할 수 있는 한 문장. "긴급도를 올렸다" 같은 시스템 내부 표현 금지. */
  text: string;
}

export interface HeritageDemandResult {
  hasNeed: boolean;
  /** 0~100. 랭킹 2순위 기준(1순위는 긴급도, priority.ts 참고). hasNeed=false여도 참고용으로 남긴다. */
  score: number;
  reasons: HeritageReason[];
  /** 판정에 쓰인 개략 예상 공제액(원) — 투명성을 위해 노출. 배우자공제는 "최소 5억" 가정. */
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

export interface HeritageTaxRangeResult {
  /** 상한 시나리오(세액 최대) — 배우자공제 최소(5억원) 적용. */
  maxTaxWon: number;
  /** 하한 시나리오(세액 최소) — 배우자공제 법정상속분 한도(단순화, 최대 30억원) 적용. */
  minTaxWon: number;
  maxTaxExemptionWon: number;
  minTaxExemptionWon: number;
  /** 화면에 절대 숨기거나 축소하면 안 되는 문구. */
  disclaimer: string;
}

export interface HeritageAssessment {
  demand: HeritageDemandResult;
  urgency: HeritageUrgencyResult;
  /** 법인 고객이면 null(이 트랙에서 다루지 않음). */
  taxRange: HeritageTaxRangeResult | null;
}
