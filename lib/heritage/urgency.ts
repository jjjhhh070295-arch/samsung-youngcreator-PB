// 헤리티지 상담 긴급도 계산 — 핵심 논리는 사전증여 10년 합산과세다.
// 증여 후 10년이 지나야 상속재산에서 제외되므로, 나이가 많을수록 활용할 수 있는 시간이 없다.
// 수요(assessHeritageDemand)가 없으면 긴급도 자체가 무의미하므로 "해당없음"으로 둔다.
//
// 문장 구조: 사실 → 그래서 무엇이 문제인지, 를 요인별로 하나씩 말하고, 마지막에 "그래서
// 언제까지"를 한 문장으로만 덧붙인다. "긴급도를 한 단계 올렸습니다" 같은 시스템 내부 표현은
// 쓰지 않는다 — PB가 고객에게 그대로 읽을 수 있는 문장이어야 한다.

import { HERITAGE_URGENCY } from "./constants";
import { eok } from "./format";
import type {
  HeritageAssessmentInput,
  HeritageDemandResult,
  HeritageReason,
  HeritageUrgencyLevel,
  HeritageUrgencyResult,
} from "./types";

const LEVEL_ORDER: HeritageUrgencyLevel[] = ["1년 내", "6개월 내", "3개월 내", "즉시"];

const RECOMMENDATION_TEXT: Record<Exclude<HeritageUrgencyLevel, "해당없음">, string> = {
  "즉시": "따라서 지금 즉시 상담을 진행하시길 권합니다.",
  "3개월 내": "따라서 상담을 3개월 안에 진행하시길 권합니다.",
  "6개월 내": "따라서 상담을 6개월 안에 진행하시길 권합니다.",
  "1년 내": "따라서 상담을 1년 안에 진행하시길 권합니다.",
};

function calcAge(birthDate: string, asOf: Date): number | null {
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < d.getMonth() || (asOf.getMonth() === d.getMonth() && asOf.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function ageFactText(age: number, level: HeritageUrgencyLevel): string {
  if (level === "즉시") {
    return `만 ${age}세로 75세 이상입니다 — 사전증여 후 상속재산에서 제외되려면 10년이 지나야 하는데, 남은 시간이 부족합니다.`;
  }
  if (level === "3개월 내") {
    return `만 ${age}세로 65~74세 구간입니다 — 10년 룰을 활용할 수 있는 사실상 마지막 적기입니다.`;
  }
  if (level === "6개월 내") {
    return `만 ${age}세로 55~64세 구간입니다 — 사전증여 계획을 세우기 좋은 시기입니다.`;
  }
  return `만 ${age}세로 아직 시간 여유가 있는 구간입니다.`;
}

function baseLevelForAge(age: number): HeritageUrgencyLevel {
  const band = HERITAGE_URGENCY.ageBands.find((b) => age >= b.minAge);
  return band?.level ?? "1년 내";
}

function escalate(level: HeritageUrgencyLevel): HeritageUrgencyLevel {
  const idx = LEVEL_ORDER.indexOf(level);
  return LEVEL_ORDER[Math.min(LEVEL_ORDER.length - 1, idx + 1)];
}

export function assessHeritageUrgency(
  input: HeritageAssessmentInput,
  demand: HeritageDemandResult,
): HeritageUrgencyResult {
  const asOf = input.asOf ?? new Date();

  if (!demand.hasNeed || input.clientType !== "individual" || !input.birthDate) {
    return { level: "해당없음", reasons: [], ageAtAssessment: null };
  }

  const age = calcAge(input.birthDate, asOf);
  if (age == null) {
    return {
      level: "해당없음",
      reasons: [{ code: "no_birthdate", text: "생년월일 정보가 없어 긴급도를 산정할 수 없습니다." }],
      ageAtAssessment: null,
    };
  }

  // 1) 먼저 최종 등급을 전부 계산한다(문장은 나중에 최종 등급 기준으로 만든다).
  let level = baseLevelForAge(age);

  const realEstateHeavy = input.realEstateWeightPct != null && input.realEstateWeightPct >= 70;
  if (realEstateHeavy) level = escalate(level);

  const recentGifts = input.givenGiftEvents.filter((e) => {
    if (e.eventType !== "gift") return false;
    const d = new Date(e.eventDate);
    if (isNaN(d.getTime())) return false;
    const cutoff = new Date(asOf);
    cutoff.setFullYear(cutoff.getFullYear() - 10);
    return d >= cutoff;
  });
  const hasRecentGifts = recentGifts.length > 0;
  if (hasRecentGifts) level = escalate(level);

  const largeEstateYoung = age < 55 && demand.taxableExcessWon >= HERITAGE_URGENCY.largeExcessUpgradeWon;
  if (largeEstateYoung) level = escalate(level);

  // 2) 이제 최종 등급을 반영해 문장을 만든다 — 요인별로 사실만 말하고, 마지막에
  //    "그래서 언제까지"를 한 번만 덧붙인다.
  const reasons: HeritageReason[] = [];

  reasons.push({ code: "age_band", text: ageFactText(age, level) });

  if (realEstateHeavy) {
    reasons.push({
      code: "real_estate_heavy",
      text: `부동산 비중이 ${input.realEstateWeightPct}%로 높아 상속세 납부재원(현금) 확보가 어렵고 매각에도 시간이 걸립니다.`,
    });
  }

  if (hasRecentGifts) {
    reasons.push({
      code: "recent_gift_history",
      text: "최근 10년 내 증여 이력이 있어 상속재산에 합산되는 합산과세 대상입니다 — 기존 증여 계획을 다시 점검해야 합니다.",
    });
  }

  if (largeEstateYoung) {
    reasons.push({
      code: "large_estate_young",
      text: `만 ${age}세로 아직 젊지만 과세 예상 초과액이 ${eok(HERITAGE_URGENCY.largeExcessUpgradeWon)} 이상으로 매우 큽니다 — 사전증여는 10년 단위로 계획해야 하므로 지금 시작하는 편이 유리합니다.`,
    });
  }

  reasons.push({ code: "recommendation", text: RECOMMENDATION_TEXT[level] });

  return { level, reasons, ageAtAssessment: age };
}
