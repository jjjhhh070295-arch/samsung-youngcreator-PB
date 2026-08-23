// 헤리티지 판정에 쓰는 문턱값 — 전부 "상담이 필요한 규모인지" 개략 판단용이며 정밀 세무
// 계산이 아니다. 실제 상속세법의 배우자공제(최소 5억~최대 30억, 실제 상속·법정지분 연동)나
// 자녀공제(성년/미성년 구분, 기초공제와의 관계 등)는 훨씬 복잡하지만, 이 시스템은 세무사를
// 대체하지 않으므로 사용자가 지정한 단순화 값만 쓴다.

export const HERITAGE_EXEMPTION = {
  baseWon: 500_000_000, // 일괄공제
  spouseWon: 500_000_000, // 배우자공제(단순화)
  perChildWon: 50_000_000, // 자녀 1인당 공제(단순화)
} as const;

export const HERITAGE_DEMAND = {
  /** 총자산이 이 미만이면 기본공제(일괄+배우자=10억)만으로 과세 가능성이 낮다고 보고
   *  점수 상한을 낮게 건다("우선순위를 낮춰라"). */
  lowPriorityAssetCeilingWon: 1_000_000_000,
  lowPriorityScoreCap: 20,
  /** 과세초과액이 이 값에 도달하면 구조 점수가 만점에 도달한다. */
  excessScoreFullWon: 3_000_000_000,
  excessScoreMax: 60,
  needThresholdScore: 30,
  realEstateHighWeightPct: 70,
  realEstateBonus: 10,
  giftHistoryWithinYears: 10,
  giftHistoryBonus: 15,
  tagBonusPerHit: 5,
  tagBonusCap: 15,
  /** RRTTLLU 태그 매칭 결과 중 헤리티지와 관련 있다고 보는 태그 id만 보조 신호로 센다. */
  heritageRelevantTagIds: ["inheritance", "gift", "corporate", "trust", "family_gov", "philanthropy"],
} as const;

export const HERITAGE_URGENCY = {
  // 위에서부터 순서대로 검사 — 나이가 minAge 이상인 첫 구간을 base level로 쓴다.
  ageBands: [
    { minAge: 75, level: "즉시" as const },
    { minAge: 65, level: "3개월 내" as const },
    { minAge: 55, level: "6개월 내" as const },
    { minAge: 0, level: "1년 내" as const },
  ],
  /** 55세 미만이라도 과세초과액이 이 이상이면 한 단계 상향한다("자산 규모가 크면 등급 상향"). */
  largeExcessUpgradeWon: 10_000_000_000,
  /** 대한민국 성년 기준(19세 미만 = 미성년). */
  minorAgeUnder: 19,
} as const;
