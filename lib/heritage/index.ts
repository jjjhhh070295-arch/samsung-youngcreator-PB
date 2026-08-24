export * from "./types";
export * from "./constants";
export { assessHeritageDemand, estimateExemptionWon, personalOrBlanketDeductionWon, resolveHasSpouse, resolveChildrenCount } from "./demand";
export { assessHeritageUrgency } from "./urgency";
export { estimateInheritanceTaxRange } from "./tax";
export { compareHeritagePriority, URGENCY_RANK } from "./priority";
export type { HeritagePriorityInput } from "./priority";
export { flagBusinessSuccessionReview, buildMajorityShareholderMap } from "./succession";
export type { BusinessSuccessionSignal, BusinessSuccessionFlag, MajorityShareholderLink } from "./succession";
export { computePaymentGap } from "./liquidity";
export type { HeritagePaymentGapResult } from "./liquidity";
export { resolveHeritageInputsBulk } from "./resolveBulk";
export type { HeritageBulkResolveParams, HeritageBulkResolveResult } from "./resolveBulk";
export { eok } from "./format";

import { assessHeritageDemand } from "./demand";
import { assessHeritageUrgency } from "./urgency";
import { estimateInheritanceTaxRange } from "./tax";
import type { HeritageAssessment, HeritageAssessmentInput } from "./types";

/** 수요 판정 + 긴급도 계산 + 개략 세액 구간을 한 번에. 법인 고객은 taxRange가 null.
 *  hasSpouse/childrenCount가 null(미상)이면 demand/tax 양쪽이 각자 보수적으로 가정하고,
 *  dataAssumptionsUsed에 그 사실을 모아서 표시한다(화면 배지용 단일 플래그). */
export function assessHeritage(input: HeritageAssessmentInput): HeritageAssessment {
  const demand = assessHeritageDemand(input);
  const urgency = assessHeritageUrgency(input, demand);
  const taxRange =
    input.clientType === "individual"
      ? estimateInheritanceTaxRange({
          assetSizeWon: input.assetSizeWon,
          debtWon: input.debtWon,
          hasSpouse: input.hasSpouse,
          childrenCount: input.childrenCount,
          givenGiftEvents: input.givenGiftEvents,
          asOf: input.asOf,
        })
      : null;
  const dataAssumptionsUsed =
    demand.hasSpouseAssumed ||
    demand.childrenCountAssumed ||
    (taxRange?.hasSpouseAssumed ?? false) ||
    (taxRange?.childrenCountAssumed ?? false);
  return { demand, urgency, taxRange, dataAssumptionsUsed };
}
