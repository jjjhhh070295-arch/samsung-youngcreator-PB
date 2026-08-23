// 헤리티지 판정에 쓰는 문턱값 — 전부 "상담이 필요한 규모인지" 개략 판단용이며 정밀 세무
// 계산이 아니다. 실제 상속세법의 배우자공제(최소 5억~법정상속분 한도, 실제 상속·법정지분
// 연동)나 자녀공제(성년/미성년 구분, 기초공제와의 관계 등)는 훨씬 복잡하지만, 이 시스템은
// 세무사를 대체하지 않으므로 사용자가 지정한 단순화 값만 쓴다.

export const HERITAGE_EXEMPTION = {
  baseWon: 500_000_000, // 일괄공제
  spouseMinWon: 500_000_000, // 배우자공제 최소(법정 하한)
  spouseMaxWon: 3_000_000_000, // 배우자공제 법정상속분 한도(단순화 — 실제는 상속인 구성에 따라 달라짐)
  perChildWon: 50_000_000, // 자녀 1인당 공제(단순화)
} as const;

export const HERITAGE_DEMAND = {
  lowPriorityScoreCap: 20,

  // ── 구조 점수(주 신호) ──
  // 과세초과액이 이 값(30억)에 도달하면 "기본" 구조 점수가 만점(60점)에 도달한다.
  excessScoreFullWon: 3_000_000_000,
  excessScoreMax: 60,
  // 30억을 넘는 초과분에는 억원당 이만큼을 추가로 준다(초고액자산가가 상향요인 가산점에
  // 밀리지 않도록 자산 규모 자체에 더 큰 가중치를 준다). 최대 +30점, 총점은 100점에서 clamp.
  extraLargeExcessPerEokWon: 0.3,
  extraLargeExcessMaxBonus: 30,

  needThresholdScore: 30,

  // ── 보조 가산(상향 요인) — 구조 점수를 압도하지 않도록 기존보다 낮춘 값 ──
  realEstateHighWeightPct: 70,
  realEstateBonus: 6,
  giftHistoryWithinYears: 10,
  giftHistoryBonus: 9,
  tagBonusPerHit: 3,
  tagBonusCap: 6,
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
} as const;

// 상속세 개략 추정용 누진세율표(단순화) — 1억 이하 10% / 1억~5억 20% / 5억~10억 30% /
// 10억~30억 40% / 30억 초과 50%.
export const INHERITANCE_TAX_BRACKETS = [
  { upToWon: 100_000_000, rate: 0.1 },
  { upToWon: 500_000_000, rate: 0.2 },
  { upToWon: 1_000_000_000, rate: 0.3 },
  { upToWon: 3_000_000_000, rate: 0.4 },
  { upToWon: Infinity, rate: 0.5 },
] as const;

export const HERITAGE_TAX_DISCLAIMER =
  "배우자공제 적용 범위(최소 5억원~법정상속분 한도)에 따라 달라지는 개략 추정치이며, 정확한 세액은 세무사 상담이 필요합니다.";
