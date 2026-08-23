// 개략 상속세 구간 추정. 정밀 계산 엔진이 아니다 — "상담이 필요한 규모인지" 판단용이며,
// 배우자공제가 5억(법정 하한)~법정상속분 한도(단순화해 30억) 사이에서 달라진다는 사실을
// 반영해 단일 값이 아닌 구간으로 낸다. 배우자가 없으면 배우자공제 자체가 없으므로 구간이
// 사실상 한 점(상한=하한)이 된다.

import { HERITAGE_EXEMPTION, HERITAGE_TAX_DISCLAIMER, INHERITANCE_TAX_BRACKETS } from "./constants";
import type { HeritageTaxRangeResult } from "./types";

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

export function estimateInheritanceTaxRange(input: {
  assetSizeWon: number;
  hasSpouse: boolean;
  childrenCount: number;
}): HeritageTaxRangeResult {
  const childDeductionWon = input.childrenCount * HERITAGE_EXEMPTION.perChildWon;

  // 상한 시나리오(세액 최대) = 배우자공제 최소(5억) → 공제가 작으니 과세표준이 커진다.
  const maxTaxExemptionWon =
    HERITAGE_EXEMPTION.baseWon + (input.hasSpouse ? HERITAGE_EXEMPTION.spouseMinWon : 0) + childDeductionWon;
  // 하한 시나리오(세액 최소) = 배우자공제 법정상속분 한도(단순화 30억) → 공제가 크니 과세표준이 작아진다.
  const minTaxExemptionWon =
    HERITAGE_EXEMPTION.baseWon + (input.hasSpouse ? HERITAGE_EXEMPTION.spouseMaxWon : 0) + childDeductionWon;

  const maxTaxBaseWon = Math.max(0, input.assetSizeWon - maxTaxExemptionWon);
  const minTaxBaseWon = Math.max(0, input.assetSizeWon - minTaxExemptionWon);

  return {
    maxTaxWon: Math.round(progressiveTax(maxTaxBaseWon)),
    minTaxWon: Math.round(progressiveTax(minTaxBaseWon)),
    maxTaxExemptionWon,
    minTaxExemptionWon,
    disclaimer: HERITAGE_TAX_DISCLAIMER,
  };
}
