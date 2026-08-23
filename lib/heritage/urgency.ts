// 헤리티지 상담 긴급도 계산 — 핵심 논리는 사전증여 10년 합산과세다.
// 증여 후 10년이 지나야 상속재산에서 제외되므로, 나이가 많을수록 활용할 수 있는 시간이 없다.
// 수요(assessHeritageDemand)가 없으면 긴급도 자체가 무의미하므로 "해당없음"으로 둔다.

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

function calcAge(birthDate: string, asOf: Date): number | null {
  const d = new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < d.getMonth() || (asOf.getMonth() === d.getMonth() && asOf.getDate() < d.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function baseLevelForAge(age: number): { level: HeritageUrgencyLevel; reason: HeritageReason } {
  const band = HERITAGE_URGENCY.ageBands.find((b) => age >= b.minAge) ?? HERITAGE_URGENCY.ageBands[HERITAGE_URGENCY.ageBands.length - 1];

  const text =
    band.level === "즉시"
      ? `만 ${age}세로 75세 이상입니다 — 사전증여 후 상속재산에서 제외되려면 10년이 지나야 하는데, 남은 시간이 부족합니다. 즉시 상담이 필요합니다.`
      : band.level === "3개월 내"
        ? `만 ${age}세로 65~74세 구간입니다 — 10년 룰을 활용할 수 있는 사실상 마지막 적기입니다.`
        : band.level === "6개월 내"
          ? `만 ${age}세로 55~64세 구간입니다 — 사전증여 계획을 세우기 좋은 시기입니다.`
          : `만 ${age}세로 아직 시간 여유가 있는 구간입니다.`;

  return { level: band.level, reason: { code: "age_band", text } };
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

  const reasons: HeritageReason[] = [];
  const { level: baseLevel, reason: ageReason } = baseLevelForAge(age);
  reasons.push(ageReason);
  let level = baseLevel;

  // ── 상향 요인 1: 부동산 비중 70% 이상 (납부재원 부족·매각 소요기간) ──
  if (input.realEstateWeightPct != null && input.realEstateWeightPct >= 70) {
    level = escalate(level);
    reasons.push({
      code: "real_estate_heavy",
      text: `부동산 비중이 ${input.realEstateWeightPct}%로 높아 상속세 납부재원(현금) 확보가 어렵고 매각에도 시간이 걸립니다 — 긴급도를 한 단계 올렸습니다.`,
    });
  }

  // ── 상향 요인 2: 최근 10년 내 증여 이력 (합산 대상, 재설계 필요) ──
  const recentGifts = input.givenGiftEvents.filter((e) => {
    if (e.eventType !== "gift") return false;
    const d = new Date(e.eventDate);
    if (isNaN(d.getTime())) return false;
    const cutoff = new Date(asOf);
    cutoff.setFullYear(cutoff.getFullYear() - 10);
    return d >= cutoff;
  });
  if (recentGifts.length > 0) {
    level = escalate(level);
    reasons.push({
      code: "recent_gift_history",
      text: "최근 10년 내 증여 이력이 있어 합산과세 대상입니다 — 기존 증여 계획을 다시 짜야 할 시점이라 긴급도를 한 단계 올렸습니다.",
    });
  }

  // ── 상향 요인 3: 미성년 자녀 존재 (성년 도달 시점이 증여 적기) ──
  const minorChildren = input.children.filter((c) => {
    if (!c.birthDate) return false;
    const a = calcAge(c.birthDate, asOf);
    return a != null && a < HERITAGE_URGENCY.minorAgeUnder;
  });
  if (minorChildren.length > 0) {
    level = escalate(level);
    reasons.push({
      code: "minor_children",
      text: `미성년 자녀가 ${minorChildren.length}명 있습니다 — 자녀가 성년이 되는 시점 전후가 증여 공제를 활용하기 좋은 시기라 긴급도를 한 단계 올렸습니다.`,
    });
  }

  // ── 상향 요인 4: 55세 미만이라도 자산 규모가 매우 크면 상향 ──
  if (age < 55 && demand.taxableExcessWon >= HERITAGE_URGENCY.largeExcessUpgradeWon) {
    level = escalate(level);
    reasons.push({
      code: "large_estate_young",
      text: `아직 젊지만(만 ${age}세) 과세 예상 초과액이 ${eok(HERITAGE_URGENCY.largeExcessUpgradeWon)} 이상으로 매우 커서, 사전증여 계획을 서둘러 시작하는 것이 유리합니다 — 긴급도를 한 단계 올렸습니다.`,
    });
  }

  return { level, reasons, ageAtAssessment: age };
}
