// 개략 상속세 구간 추정. 정밀 계산 엔진이 아니다 — "상담이 필요한 규모인지" 판단용이며,
// 배우자공제가 5억(법정 하한)~법정상속분 상당액(30억 한도) 사이에서 달라진다는 사실을
// 반영해 단일 값이 아닌 구간으로 낸다. 배우자가 없으면 배우자공제 자체가 없으므로 구간이
// 사실상 한 점(상한=하한)이 된다.
//
// 배우자 법정상속분 상당액 = 상속재산가액 × [1.5 / (1.5 + 자녀수)], 최소 5억 보장, 30억 초과분은
// 인정 안 됨. 자녀 수를 모르면(party_relationships에서 relation_type='child'로 못 찾으면)
// 보수적으로 2명을 가정하고, 그 사실을 결과(childrenCountAssumed)에 반드시 남긴다.
//
// 상속개시 기준 10년 내 증여는 상속재산에 합산된다(사전증여 합산과세) — 이 기능 전체가
// "10년 합산과세 때문에 지금 움직여야 한다"는 논리 위에 서 있으므로, 세액 계산에서도
// 반드시 반영한다. 커트오프 판단은 demand.ts의 isWithinYears를 그대로 재사용한다.

import { HERITAGE_DEMAND, HERITAGE_EXEMPTION, HERITAGE_TAX_ASSUMPTIONS, HERITAGE_TAX_DISCLAIMER, INHERITANCE_TAX_BRACKETS } from "./constants";
import { isWithinYears, personalOrBlanketDeductionWon } from "./demand";
import { eok } from "./format";
import type { HeritageReason, HeritageTaxRangeResult } from "./types";
import type { TransferEvent } from "../types";

function progressiveTax(base: number): number {
  if (base <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const bracket of INHERITANCE_TAX_BRACKETS) {
    if (base <= prev) break;
    tax += (Math.min(base, bracket.upToWon) - prev) * bracket.rate;
    prev = bracket.upToWon;
  }
  return tax;
}

function yearsElapsed(dateStr: string, asOf: Date): number {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  let years = asOf.getFullYear() - d.getFullYear();
  const beforeAnniversary =
    asOf.getMonth() < d.getMonth() || (asOf.getMonth() === d.getMonth() && asOf.getDate() < d.getDate());
  if (beforeAnniversary) years -= 1;
  return Math.max(0, years);
}

/** 상속개시 기준 10년 내 증여만 골라 합계와 근거 문장을 낸다 — 상속재산 가산액. */
function sumGiftAddBack(events: TransferEvent[], asOf: Date): { totalWon: number; reasons: HeritageReason[] } {
  const recent = events.filter(
    (e) => e.eventType === "gift" && isWithinYears(e.eventDate, HERITAGE_DEMAND.giftHistoryWithinYears, asOf),
  );
  const reasons = recent.map((e) => ({
    code: "gift_addback",
    text: `${yearsElapsed(e.eventDate, asOf)}년 전 증여하신 ${eok(e.amount ?? 0)}은 상속재산에 합산됩니다.`,
  }));
  const totalWon = recent.reduce((sum, e) => sum + (e.amount ?? 0), 0);
  return { totalWon, reasons };
}

/** 배우자:자녀 = 1.5:1 법정상속분 비율. 자녀 0명이면 1.0(전액)이 되는 단순화 모델이다. */
function spouseLegalPortionRatio(childrenCount: number): number {
  return HERITAGE_TAX_ASSUMPTIONS.spouseLegalPortionWeight / (HERITAGE_TAX_ASSUMPTIONS.spouseLegalPortionWeight + childrenCount);
}

export function estimateInheritanceTaxRange(input: {
  assetSizeWon: number;
  hasSpouse: boolean;
  /** null이면 자녀 수를 모른다는 뜻 — 보수적으로 2명을 가정하고 그 사실을 결과에 남긴다. */
  childrenCount: number | null;
  /** 이 고객이 증여자인 gift 타입 TransferEvent. 10년 내 것만 내부에서 걸러 가산한다. */
  givenGiftEvents?: TransferEvent[];
  asOf?: Date;
}): HeritageTaxRangeResult {
  const asOf = input.asOf ?? new Date();
  const childrenCountAssumed = input.childrenCount == null;
  const childrenCountUsed = input.childrenCount ?? HERITAGE_TAX_ASSUMPTIONS.assumedChildrenCountWhenUnknown;

  const { totalWon: giftAddBackWon, reasons: giftAddBackReasons } = sumGiftAddBack(input.givenGiftEvents ?? [], asOf);
  // 사전증여 10년 합산 — 과세가액은 현재 자산 + 10년 내 증여 합계.
  const grossEstateWon = input.assetSizeWon + giftAddBackWon;

  // 상속공제 = max(기초공제 + 자녀공제 합계, 일괄공제) — 일괄공제를 택하면 자녀공제는 별도로
  // 더하지 않는다(이중계상 금지). 자녀 7명 미만이면 일괄공제(5억) 쪽이 항상 더 크다.
  const personalDeductionWon = HERITAGE_EXEMPTION.basicWon + childrenCountUsed * HERITAGE_EXEMPTION.perChildWon;
  const baseOrPersonalDeductionWon = personalOrBlanketDeductionWon(childrenCountUsed);
  const usedBlanket = baseOrPersonalDeductionWon <= HERITAGE_EXEMPTION.baseWon;

  // 상한 시나리오(세액 최대) = 배우자공제 최소(5억)만 적용 → 공제가 작으니 과세표준이 커진다.
  const spouseDeductionForMaxTax = input.hasSpouse ? HERITAGE_EXEMPTION.spouseMinWon : 0;
  const maxTaxExemptionWon = baseOrPersonalDeductionWon + spouseDeductionForMaxTax;

  // 하한 시나리오(세액 최소) = 배우자공제 = min(법정상속분 상당액, 30억 한도), 최소 5억 보장.
  let spouseDeductionForMinTax = 0;
  if (input.hasSpouse) {
    const legalPortionWon = grossEstateWon * spouseLegalPortionRatio(childrenCountUsed);
    spouseDeductionForMinTax = Math.min(
      HERITAGE_EXEMPTION.spouseMaxWon,
      Math.max(HERITAGE_EXEMPTION.spouseMinWon, legalPortionWon),
    );
  }
  const minTaxExemptionWon = baseOrPersonalDeductionWon + spouseDeductionForMinTax;

  const maxTaxBaseWon = Math.max(0, grossEstateWon - maxTaxExemptionWon);
  const minTaxBaseWon = Math.max(0, grossEstateWon - minTaxExemptionWon);

  const reasons: HeritageReason[] = [...giftAddBackReasons];
  if (childrenCountAssumed) {
    reasons.push({
      code: "children_count_assumed",
      text: `자녀 수를 확인할 수 없어 보수적으로 ${childrenCountUsed}명으로 가정해 계산했습니다 — 실제 자녀 수를 확인하면 세액 구간이 달라질 수 있습니다.`,
    });
  }
  if (!usedBlanket) {
    reasons.push({
      code: "used_personal_deduction",
      text: `자녀 ${childrenCountUsed}명 기준 기초공제+자녀공제 합계(${eok(personalDeductionWon)})가 일괄공제(5억원)보다 커서 일괄공제 대신 이쪽을 적용했습니다.`,
    });
  }
  if (input.hasSpouse && minTaxBaseWon === 0 && maxTaxBaseWon > 0) {
    reasons.push({
      code: "min_tax_zero",
      text: "배우자가 법정상속분 상당액까지 상속받는 경우를 가정하면 공제액이 과세가액을 넘어 하한 세액이 0원으로 계산됩니다 — 실제 배우자 상속 비율에 따라 달라질 수 있습니다.",
    });
  }

  return {
    maxTaxWon: Math.round(progressiveTax(maxTaxBaseWon)),
    minTaxWon: Math.round(progressiveTax(minTaxBaseWon)),
    maxTaxExemptionWon,
    minTaxExemptionWon,
    giftAddBackWon,
    childrenCountUsed,
    childrenCountAssumed,
    breakdown: {
      personalDeductionWon,
      blanketDeductionWon: HERITAGE_EXEMPTION.baseWon,
      usedBlanket,
      baseOrPersonalDeductionWon,
      spouseDeductionForMaxTaxWon: spouseDeductionForMaxTax,
      spouseDeductionForMinTaxWon: spouseDeductionForMinTax,
      maxTaxBaseWon,
      minTaxBaseWon,
    },
    reasons,
    disclaimer: HERITAGE_TAX_DISCLAIMER,
  };
}
