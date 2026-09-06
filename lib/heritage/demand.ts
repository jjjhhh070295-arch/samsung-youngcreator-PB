// 헤리티지(신탁·상속·증여) 상담 수요 판정.
// 구조적 데이터(총자산·공제·부동산 비중·증여이력)를 주 신호로 쓰고, RRTTLLU 키워드 매칭
// 결과는 보조 신호로만 가중치를 더한다 — 키워드만으로 판정하지 않는다.
// 법인 고객은 이 트랙에서 다루지 않는다(가업승계는 별도 — lib/heritage/succession.ts).

import { HERITAGE_DEMAND, HERITAGE_EXEMPTION, HERITAGE_TAX_ASSUMPTIONS } from "./constants";
import { eok } from "./format";
import type { HeritageAssessmentInput, HeritageDemandResult, HeritageReason } from "./types";

/** 만 나이. 파싱 불가면 null. urgency.ts 도 이 함수를 쓴다 — 나이 축이 demand/urgency
 *  두 곳에서 갈라지지 않게 한 곳에 둔다. */
export function calcAgeAt(birthDate: string, asOf: Date): number | null {
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < d.getMonth() || (asOf.getMonth() === d.getMonth() && asOf.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// tax.ts가 사전증여 10년 합산 가산에 그대로 재사용한다 — 커트오프 로직이 두 곳에서 갈라지지 않게.
export function isWithinYears(dateStr: string, years: number, asOf: Date): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return d >= cutoff;
}

/** 상속공제 = max(기초공제 + 기타인적공제(자녀) 합계, 일괄공제) — 일괄공제를 택하면 자녀공제는
 *  별도로 더하지 않는다(이중계상 금지). tax.ts도 이 함수를 그대로 재사용한다. */
export function personalOrBlanketDeductionWon(childrenCount: number): number {
  const personalWon = HERITAGE_EXEMPTION.basicWon + childrenCount * HERITAGE_EXEMPTION.perChildWon;
  return Math.max(personalWon, HERITAGE_EXEMPTION.baseWon);
}

/**
 * 과세초과액 → 자산 축 점수(0~60). 로그 스케일이라 1조까지 점수가 계속 벌어진다.
 * 곡선을 고정한 두 기준점과 상수 유도는 constants.ts 의 assetLogScaleWon 주석 참고.
 */
export function assetAxisScore(taxableExcessWon: number): number {
  if (taxableExcessWon <= 0) return 0;
  const k = HERITAGE_DEMAND.assetLogScaleWon;
  const denominator = Math.log(1 + HERITAGE_DEMAND.assetLogCeilingWon / k);
  const ratio = Math.log(1 + taxableExcessWon / k) / denominator;
  return Math.round(Math.min(1, ratio) * HERITAGE_DEMAND.assetScoreMax);
}

/** party_relationships에 배우자 관계 행이 없는 것은 "확인된 배우자 없음"이 아니라 "미입력"일
 *  수 있다 — 이 스키마로는 둘을 구분할 방법이 없다(양의 관계 행만 존재를 증명할 수 있고,
 *  부재는 아무것도 증명하지 못한다). null이면 무조건 "모름"으로 취급하고, 판정에서는
 *  보수적으로 "배우자 없음"(더 작은 공제 → 상담 필요 신호를 놓치지 않는 쪽)으로 가정한다.
 *  tax.ts도 이 함수를 그대로 재사용해 가정 기준이 어긋나지 않게 한다. */
export function resolveHasSpouse(hasSpouse: boolean | null): { value: boolean; assumed: boolean } {
  if (hasSpouse == null) return { value: HERITAGE_TAX_ASSUMPTIONS.hasSpouseWhenUnknown, assumed: true };
  return { value: hasSpouse, assumed: false };
}

/** 자녀도 마찬가지로 관계 행 부재가 "확인된 0명"을 증명하지 못한다 — null이면 "모름"으로
 *  취급하고 보수적으로 assumedChildrenCountWhenUnknown(2명)을 가정한다. */
export function resolveChildrenCount(childrenCount: number | null): { value: number; assumed: boolean } {
  if (childrenCount == null) return { value: HERITAGE_TAX_ASSUMPTIONS.assumedChildrenCountWhenUnknown, assumed: true };
  return { value: childrenCount, assumed: false };
}

/** 위 공제(일괄 vs 기초+인적, 큰 쪽) + 배우자공제(최소) — 단순화된 개략 공제 추정.
 *  hasSpouse/childrenCount가 null(미상)이면 resolveHasSpouse/resolveChildrenCount의
 *  가정값을 조용히 적용한다 — "가정이 쓰였다"는 사실 자체는 assessHeritageDemand/
 *  estimateInheritanceTaxRange 쪽에서 별도로 보고한다(이 함수는 숫자만 낸다). */
export function estimateExemptionWon(input: Pick<HeritageAssessmentInput, "hasSpouse" | "childrenCount">): number {
  const hasSpouse = resolveHasSpouse(input.hasSpouse).value;
  const childrenCount = resolveChildrenCount(input.childrenCount).value;
  return personalOrBlanketDeductionWon(childrenCount) + (hasSpouse ? HERITAGE_EXEMPTION.spouseMinWon : 0);
}

export function assessHeritageDemand(input: HeritageAssessmentInput): HeritageDemandResult {
  // 법인은 별도 트랙 — 이 함수는 개인 고객 전용이다.
  if (input.clientType !== "individual") {
    return {
      hasNeed: false,
      score: 0,
      reasons: [
        {
          code: "corporate_separate_track",
          text: "법인 고객은 상속·증여 개인 상담 트랙과 별도로 다룹니다.",
        },
      ],
      estimatedExemptionWon: 0,
      taxableExcessWon: 0,
      hasSpouseAssumed: false,
      childrenCountAssumed: false,
    };
  }

  const asOf = input.asOf ?? new Date();
  const reasons: HeritageReason[] = [];

  const { value: hasSpouse, assumed: hasSpouseAssumed } = resolveHasSpouse(input.hasSpouse);
  const { value: childrenCount, assumed: childrenCountAssumed } = resolveChildrenCount(input.childrenCount);

  // 가정이 쓰였으면 다른 어떤 사유보다 먼저 보여준다 — PB가 이게 추정치라는 걸 가장 먼저
  // 알아야 한다.
  if (hasSpouseAssumed) {
    reasons.push({
      code: "has_spouse_assumed",
      text: "가족관계 정보가 없어 배우자가 없는 것으로 보수적으로 가정해 계산했습니다 — 배우자 유무에 따라 공제액이 크게(최대 25억원) 달라질 수 있어, 실제 확인이 필요합니다.",
    });
  }
  if (childrenCountAssumed) {
    reasons.push({
      code: "children_count_assumed",
      text: `자녀 관계 정보가 없어 보수적으로 ${childrenCount}명으로 가정해 계산했습니다 — 실제 자녀 수를 확인하면 결과가 달라질 수 있습니다.`,
    });
  }

  const exemptionWon = personalOrBlanketDeductionWon(childrenCount) + (hasSpouse ? HERITAGE_EXEMPTION.spouseMinWon : 0);
  const taxableExcessWon = Math.max(0, input.assetSizeWon - exemptionWon);

  let score = 0;

  // ── 구조 신호 1: 예상 공제 대비 초과 자산 (주 신호, 로그 스케일) ──
  // 곡선 근거는 constants.ts 의 assetLogScaleWon 주석 참고.
  score += assetAxisScore(taxableExcessWon);

  if (taxableExcessWon > 0) {
    const personalDeductionWon = personalOrBlanketDeductionWon(childrenCount);
    const usedBlanket = personalDeductionWon <= HERITAGE_EXEMPTION.baseWon;
    const baseDeductionNote = usedBlanket
      ? "일괄공제 5억원"
      : `기초공제 2억원 + 자녀공제 ${childrenCount}인×5천만원(일괄공제 5억원보다 커서 이쪽을 적용)`;
    reasons.push({
      code: "taxable_excess",
      text:
        `총자산 ${eok(input.assetSizeWon)}이 예상 공제 ${eok(exemptionWon)}` +
        `(${baseDeductionNote} + 배우자공제 ${hasSpouse ? "5억원" : "0원(배우자 없음)"})을 ` +
        `${eok(taxableExcessWon)} 초과합니다 — 과세 가능성이 있습니다.`,
    });
  } else {
    reasons.push({
      code: "within_exemption",
      text: `총자산 ${eok(input.assetSizeWon)}이 예상 공제 ${eok(exemptionWon)} 이내입니다 — 현재 구조로는 과세 가능성이 낮습니다.`,
    });
  }

  // ── 구조 신호 2: 나이 (사전증여 10년 룰까지 남은 시간) ──
  const age = input.birthDate ? calcAgeAt(input.birthDate, asOf) : null;
  const ageBand = age == null ? undefined : HERITAGE_DEMAND.ageBonusBands.find((b) => age >= b.minAge);
  if (age != null && ageBand) {
    score += ageBand.bonus;
    reasons.push({
      code: "age_band",
      text: `만 ${age}세입니다 — 사전증여는 10년이 지나야 상속재산에서 빠지므로, 설계를 시작할 시간이 그만큼 줄어듭니다.`,
    });
  }

  // ── 구조 신호 3: 상속인(자녀) 수 — 확인된 값일 때만 ──
  // 가정값에는 가산하지 않는다(근거는 constants.ts 의 childrenManyBonus 주석).
  if (!childrenCountAssumed && childrenCount >= HERITAGE_DEMAND.childrenManyThreshold) {
    score += HERITAGE_DEMAND.childrenManyBonus;
    reasons.push({
      code: "many_heirs",
      text: `자녀가 ${childrenCount}명으로 확인됩니다 — 상속인이 많을수록 분할 협의와 유류분 검토가 복잡해집니다.`,
    });
  }

  // ── 구조 신호 4: 부동산 비중 (주 신호) ──
  if (input.realEstateWeightPct != null && input.realEstateWeightPct >= HERITAGE_DEMAND.realEstateHighWeightPct) {
    score += HERITAGE_DEMAND.realEstateBonus;
    reasons.push({
      code: "real_estate_heavy",
      text: `자산 중 부동산 비중이 ${input.realEstateWeightPct}%로 높습니다 — 상속·증여 재원 마련 관점에서 상담이 유용합니다.`,
    });
  }

  // ── 구조 신호 5: 최근 10년 내 증여 이력 (주 신호) ──
  const recentGifts = input.givenGiftEvents.filter(
    (e) => e.eventType === "gift" && isWithinYears(e.eventDate, HERITAGE_DEMAND.giftHistoryWithinYears, asOf),
  );
  if (recentGifts.length > 0) {
    score += HERITAGE_DEMAND.giftHistoryBonus;
    const totalGiven = recentGifts.reduce((sum, e) => sum + (e.amount ?? 0), 0);
    reasons.push({
      code: "recent_gift_history",
      text: `최근 10년 내 증여 이력 ${recentGifts.length}건(합계 ${eok(totalGiven)})이 있습니다 — 상속재산에 합산될 수 있어 재설계가 필요합니다.`,
    });
  }

  // ── 보조 신호: RRTTLLU 태그 매칭 ──
  const matchedTags = input.taxTagIds.filter((id) =>
    (HERITAGE_DEMAND.heritageRelevantTagIds as readonly string[]).includes(id),
  );
  if (matchedTags.length > 0) {
    const bonus = Math.min(HERITAGE_DEMAND.tagBonusCap, matchedTags.length * HERITAGE_DEMAND.tagBonusPerHit);
    score += bonus;
    reasons.push({
      code: "keyword_signal",
      text: `상담 내용에서 관련 키워드(${matchedTags.join(", ")})가 감지됐습니다 — 구조적 신호를 보조하는 참고용으로만 반영했습니다.`,
    });
  }

  // ── 저자산 우선순위 하향: 배우자 유무로 공제 기준선이 다르다 ──
  // 배우자 있음 → 일괄공제(5억)+배우자공제(5억)=10억, 배우자 없음 → 일괄공제(5억)만.
  const lowPriorityCeilingWon = HERITAGE_EXEMPTION.baseWon + (hasSpouse ? HERITAGE_EXEMPTION.spouseMinWon : 0);
  if (input.assetSizeWon < lowPriorityCeilingWon) {
    score = Math.min(score, HERITAGE_DEMAND.lowPriorityScoreCap);
    reasons.push({
      code: "low_priority_small_estate",
      text: hasSpouse
        ? "총자산이 10억원 미만으로, 일괄공제(5억)와 배우자공제(5억)만으로도 과세 가능성이 낮습니다."
        : "총자산이 5억원 미만으로, 일괄공제(5억)만으로도 과세 가능성이 낮습니다.",
    });
  }

  score = Math.max(0, Math.min(100, score));

  return {
    hasNeed: score >= HERITAGE_DEMAND.needThresholdScore,
    score,
    reasons,
    estimatedExemptionWon: exemptionWon,
    taxableExcessWon,
    hasSpouseAssumed,
    childrenCountAssumed,
  };
}
