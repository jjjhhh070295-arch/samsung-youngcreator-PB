export * from "./types";
export * from "./constants";
export { assessHeritageDemand, estimateExemptionWon } from "./demand";
export { assessHeritageUrgency } from "./urgency";

import { assessHeritageDemand } from "./demand";
import { assessHeritageUrgency } from "./urgency";
import type { HeritageAssessment, HeritageAssessmentInput } from "./types";

/** 수요 판정 + 긴급도 계산을 한 번에. */
export function assessHeritage(input: HeritageAssessmentInput): HeritageAssessment {
  const demand = assessHeritageDemand(input);
  const urgency = assessHeritageUrgency(input, demand);
  return { demand, urgency };
}
