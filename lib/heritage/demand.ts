// 헤리티지(신탁·상속·증여) 상담 수요 판정.
// 구조적 데이터(총자산·공제·부동산 비중·증여이력)를 주 신호로 쓰고, RRTTLLU 키워드 매칭
// 결과는 보조 신호로만 가중치를 더한다 — 키워드만으로 판정하지 않는다.

import { HERITAGE_DEMAND, HERITAGE_EXEMPTION } from "./constants";
import { eok } from "./format";
import type { HeritageAssessmentInput, HeritageDemandResult, HeritageReason } from "./types";

function isWithinYears(dateStr: string, years: number, asOf: Date): boolean {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date(asOf);
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return d >= cutoff;
}

/** 일괄공제 + 배우자공제 + 자녀공제(1인당) — 단순화된 개략 공제 추정. */
export function estimateExemptionWon(input: Pick<HeritageAssessmentInput, "hasSpouse" | "children">): number {
  return (
    HERITAGE_EXEMPTION.baseWon +
    (input.hasSpouse ? HERITAGE_EXEMPTION.spouseWon : 0) +
    input.children.length * HERITAGE_EXEMPTION.perChildWon
  );
}

export function assessHeritageDemand(input: HeritageAssessmentInput): HeritageDemandResult {
  const asOf = input.asOf ?? new Date();
  const reasons: HeritageReason[] = [];

  const exemptionWon = estimateExemptionWon(input);
  const taxableExcessWon = Math.max(0, input.assetSizeWon - exemptionWon);

  let score = 0;

  // ── 구조 신호 1: 예상 공제 대비 초과 자산 (주 신호, 최대 60점) ──
  const excessRatio = Math.min(1, taxableExcessWon / HERITAGE_DEMAND.excessScoreFullWon);
  score += Math.round(excessRatio * HERITAGE_DEMAND.excessScoreMax);

  if (taxableExcessWon > 0) {
    reasons.push({
      code: "taxable_excess",
      text:
        `총자산 ${eok(input.assetSizeWon)}이 예상 공제 ${eok(exemptionWon)}` +
        `(일괄공제 5억원 + 배우자공제 ${input.hasSpouse ? "5억원" : "0원(배우자 없음)"} + ` +
        `자녀공제 ${input.children.length}인×5천만원)을 ${eok(taxableExcessWon)} 초과합니다 — 과세 가능성이 있습니다.`,
    });
  } else {
    reasons.push({
      code: "within_exemption",
      text: `총자산 ${eok(input.assetSizeWon)}이 예상 공제 ${eok(exemptionWon)} 이내입니다 — 현재 구조로는 과세 가능성이 낮습니다.`,
    });
  }

  // ── 구조 신호 2: 부동산 비중 (주 신호, +10점) ──
  if (input.realEstateWeightPct != null && input.realEstateWeightPct >= HERITAGE_DEMAND.realEstateHighWeightPct) {
    score += HERITAGE_DEMAND.realEstateBonus;
    reasons.push({
      code: "real_estate_heavy",
      text: `자산 중 부동산 비중이 ${input.realEstateWeightPct}%로 높습니다 — 상속·증여 재원 마련 관점에서 상담이 유용합니다.`,
    });
  }

  // ── 구조 신호 3: 최근 10년 내 증여 이력 (주 신호, +15점) ──
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

  // ── 보조 신호: RRTTLLU 태그 매칭 (최대 15점) ──
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

  // ── 저자산 우선순위 하향 ──
  if (input.assetSizeWon < HERITAGE_DEMAND.lowPriorityAssetCeilingWon) {
    score = Math.min(score, HERITAGE_DEMAND.lowPriorityScoreCap);
    reasons.push({
      code: "low_priority_small_estate",
      text: "총자산이 10억원 미만으로, 일괄공제(5억)와 배우자공제(5억)만으로도 과세 가능성이 낮아 우선순위를 낮췄습니다.",
    });
  }

  score = Math.max(0, Math.min(100, score));

  return {
    hasNeed: score >= HERITAGE_DEMAND.needThresholdScore,
    score,
    reasons,
    estimatedExemptionWon: exemptionWon,
    taxableExcessWon,
  };
}
