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
  /** 총 상속재산(채무 차감 전). demand.ts의 수요 판정은 이 값을 그대로 쓴다(개략 스크리닝이므로). */
  assetSizeWon: number;
  /** 채무(부동산 담보대출 등, client_real_estate_debt 합계). 세액 구간 계산에서만 차감한다
   *  — 수요 판정 스코어는 기존대로 총자산 기준 개략치를 유지한다. 모르면 0. */
  debtWon?: number;
  /** 0~100. 모르면 null(구조 신호 하나가 빠졌다는 뜻이며, 판정에서는 단순히 반영하지 않는다). */
  realEstateWeightPct: number | null;
  /** party_relationships에 배우자 관계 행이 없으면 "확인된 배우자 없음"이 아니라 "미입력"일
   *  수 있다 — 모르면 null(demand.ts/tax.ts가 보수적으로 가정하고 그 사실을 결과에 표시한다). */
  hasSpouse: boolean | null;
  /** 자녀 수만 쓴다(자녀공제 계산용) — 자녀 개별 생년월일/미성년 여부는 판정에 쓰지 않는다.
   *  이유: 세대생략증여(조부모→손자)가 흔해 자녀의 성년 여부가 증여 시점을 결정하지 못한다.
   *  모르면 null(위 hasSpouse와 동일한 이유 — 관계 행 부재가 "확인된 0명"을 증명하지 못한다). */
  childrenCount: number | null;
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
  /** true면 배우자 유무를 몰라서 보수적으로 "없음"을 가정해 계산했다는 뜻. */
  hasSpouseAssumed: boolean;
  /** true면 자녀 수를 몰라서 보수적으로 가정한 값을 썼다는 뜻. */
  childrenCountAssumed: boolean;
}

export type HeritageUrgencyLevel = "즉시" | "3개월 내" | "6개월 내" | "1년 내" | "해당없음";

export interface HeritageUrgencyResult {
  level: HeritageUrgencyLevel;
  reasons: HeritageReason[];
  ageAtAssessment: number | null;
}

export interface HeritageTaxRangeResult {
  /** 상한 시나리오(세액 최대) — 배우자공제 최소(5억원)만 적용. */
  maxTaxWon: number;
  /** 하한 시나리오(세액 최소) — 배우자공제 = min(배우자 법정상속분 상당액, 30억), 최소 5억 보장. */
  minTaxWon: number;
  maxTaxExemptionWon: number;
  minTaxExemptionWon: number;
  /** 상속개시 기준 10년 내 증여 합계 — 과세가액에 가산된 금액. 0이면 해당 없음. */
  giftAddBackWon: number;
  /** 계산에 실제로 쓰인 자녀 수(모르면 assumedChildrenCountWhenUnknown이 대입된다). */
  childrenCountUsed: number;
  /** true면 자녀 수를 몰라서 보수적으로 가정한 값을 썼다는 뜻 — 결과 표시에서 숨기면 안 된다. */
  childrenCountAssumed: boolean;
  /** 계산에 실제로 쓰인 배우자 유무(모르면 hasSpouseWhenUnknown=false가 대입된다). */
  hasSpouseUsed: boolean;
  /** true면 배우자 유무를 몰라서 보수적으로 "없음"을 가정해 계산했다는 뜻 — 배우자공제 유무를
   *  가르므로 자녀 수 가정보다 결과에 미치는 영향이 훨씬 크다. 숨기면 안 된다. */
  hasSpouseAssumed: boolean;
  /** 검산용 공제 내역 분해 — 상한/하한 모두 기초+인적공제 vs 일괄공제 중 큰 쪽 하나만 쓴다. */
  breakdown: {
    /** 총 상속재산(채무 차감 전). */
    grossAssetWon: number;
    /** 채무(부동산 담보대출 등). */
    debtWon: number;
    /** 순자산 = max(0, grossAssetWon - debtWon). 과세가액 산정의 출발점. */
    netAssetWon: number;
    /** 기초공제(2억) + 자녀공제 합계 — "인적공제 조합"을 택했을 때의 값. */
    personalDeductionWon: number;
    /** 일괄공제(5억). */
    blanketDeductionWon: number;
    /** true면 일괄공제를 택함(= personalDeductionWon <= blanketDeductionWon, 자녀 7명 미만이면 항상 이쪽). */
    usedBlanket: boolean;
    /** max(personalDeductionWon, blanketDeductionWon) — 실제 적용된 기초/인적 vs 일괄 공제액. */
    baseOrPersonalDeductionWon: number;
    /** 상한 시나리오에서 적용된 배우자공제(항상 5억, 배우자 없으면 0). */
    spouseDeductionForMaxTaxWon: number;
    /** 하한 시나리오에서 적용된 배우자공제(법정상속분 한도, 배우자 없으면 0). */
    spouseDeductionForMinTaxWon: number;
    /** 과세가액(자산 + 10년 내 증여 합산) - 상한 시나리오 공제 총액. */
    maxTaxBaseWon: number;
    /** 과세가액(자산 + 10년 내 증여 합산) - 하한 시나리오 공제 총액. */
    minTaxBaseWon: number;
  };
  /** 증여 합산 가산, 자녀 수 가정 등 세액 구간 산출 근거를 PB가 그대로 말할 수 있는 문장들. */
  reasons: HeritageReason[];
  /** 화면에 절대 숨기거나 축소하면 안 되는 문구. */
  disclaimer: string;
}

export interface HeritageAssessment {
  demand: HeritageDemandResult;
  urgency: HeritageUrgencyResult;
  /** 법인 고객이면 null(이 트랙에서 다루지 않음). */
  taxRange: HeritageTaxRangeResult | null;
  /** demand 또는 taxRange 어느 쪽이든 배우자/자녀 정보를 몰라 가정을 썼으면 true — 화면에
   *  "가족 정보 미입력 — 추정치입니다" 배지를 띄울지 결정하는 단일 플래그. */
  dataAssumptionsUsed: boolean;
}
