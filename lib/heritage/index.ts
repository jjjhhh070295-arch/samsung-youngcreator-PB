export * from "./types";
export * from "./constants";
export { assessHeritageDemand, estimateExemptionWon } from "./demand";
export { assessHeritageUrgency } from "./urgency";
export { estimateInheritanceTaxRange } from "./tax";
export { compareHeritagePriority, URGENCY_RANK } from "./priority";
export type { HeritagePriorityInput } from "./priority";
export { flagBusinessSuccessionReview } from "./succession";
export type { BusinessSuccessionSignal, BusinessSuccessionFlag } from "./succession";

import { assessHeritageDemand } from "./demand";
import { assessHeritageUrgency } from "./urgency";
import { estimateInheritanceTaxRange } from "./tax";
import type { HeritageAssessment, HeritageAssessmentInput } from "./types";

/** 수요 판정 + 긴급도 계산 + 개략 세액 구간을 한 번에. 법인 고객은 taxRange가 null. */
export function assessHeritage(input: HeritageAssessmentInput): HeritageAssessment {
  const demand = assessHeritageDemand(input);
  const urgency = assessHeritageUrgency(input, demand);
  const taxRange =
    input.clientType === "individual"
      ? estimateInheritanceTaxRange({
          assetSizeWon: input.assetSizeWon,
          hasSpouse: input.hasSpouse,
          // HeritageAssessmentInput.childrenCount는 호출부가 이미 확인해 넘긴 값이므로 "known"으로 다룬다.
          childrenCount: input.childrenCount,
          givenGiftEvents: input.givenGiftEvents,
          asOf: input.asOf,
        })
      : null;
  return { demand, urgency, taxRange };
}
