export type RiskScore = 1 | 3 | 5;
export type RiskLevel = "Safe" | "Watch" | "Danger" | "Severe Danger";
export type CriterionStatus = "Safe" | "Watch" | "Danger";
export type BusinessCreditIndustry =
  | "manufacturing"
  | "wholesale"
  | "construction"
  | "it"
  | "real_estate"
  | "other";

export type RiskCriterionKey =
  | "liquidityGap"
  | "runway"
  | "interestCoverage"
  | "currentRatio"
  | "debtToEquity"
  | "debtDependency"
  | "fundingRateShock"
  | "ratingDowngrade"
  | "fundingSpread"
  | "shortTermDebtConcentration"
  | "workingCapitalBurden";

export type BusinessCreditRiskInput = {
  cashBuffer: number;
  liquidityGap: number;
  stressUseOfCash: number;
  survivalMonths: number;
  interestCoverage: number;
  stressedEbitda: number;
  currentRatio: number;
  debtToEquityRatio: number;
  totalDebt: number;
  totalAssets: number;
  industry: BusinessCreditIndustry;
  fundingRateShockPct: number;
  ratingDowngradeNotches: number;
  fundingSpreadShockBp: number;
  shortTermDebtConcentrationPct: number;
  workingCapitalBurdenIncrease: number;
  refinancingBurdenIncrease: number;
  additionalInterestCost: number;
  operatingCashflowLoss: number;
  portfolioLabel: string;
  companySizeLabel: string;
  presetName: string;
};

export type RiskCriterionDefinition = {
  key: RiskCriterionKey;
  label: string;
  safeText: string;
  watchText: string;
  dangerText: string;
  clientExplanation: string;
};

export type RiskCriterionResult = {
  key: RiskCriterionKey;
  label: string;
  score: RiskScore;
  status: CriterionStatus;
  valueLabel: string;
  reason: string;
  clientExplanation: string;
};

export type KoreaBusinessCreditRiskResult = {
  level: RiskLevel;
  criteria: RiskCriterionResult[];
  watchFlags: RiskCriterionResult[];
  dangerFlags: RiskCriterionResult[];
  topDrivers: RiskCriterionResult[];
  severeTriggers: string[];
  watchCount: number;
  dangerCount: number;
  explanation: string;
  pbCommentary: string;
};

type ConsultationGuideRow = {
  situation: string;
  indicators: string;
  guidance: string;
};

const industryAverageDebtDependency: Record<BusinessCreditIndustry, number> = {
  manufacturing: 35,
  wholesale: 32,
  construction: 45,
  it: 28,
  real_estate: 50,
  other: 35,
};

const driverPriority: Record<RiskCriterionKey, number> = {
  liquidityGap: 110,
  runway: 105,
  interestCoverage: 100,
  fundingRateShock: 95,
  workingCapitalBurden: 90,
  shortTermDebtConcentration: 85,
  ratingDowngrade: 80,
  fundingSpread: 75,
  debtDependency: 70,
  currentRatio: 65,
  debtToEquity: 60,
};

const criticalWatchKeys = new Set<RiskCriterionKey>([
  "liquidityGap",
  "runway",
  "interestCoverage",
  "fundingRateShock",
  "workingCapitalBurden",
]);

export const KOREA_BUSINESS_CREDIT_CRITERIA: RiskCriterionDefinition[] = [
  {
    key: "liquidityGap",
    label: "12개월 유동성 부족액",
    safeText: "부족액 없음",
    watchText: "부족액 발생, 단 현금버퍼의 25% 미만",
    dangerText: "현금버퍼의 25% 이상 또는 12개월 필요현금의 20% 이상 부족",
    clientExplanation:
      "앞으로 1년 동안 예상되는 현금유출을 현재 현금으로 감당하고도 부족한 금액입니다.",
  },
  {
    key: "runway",
    label: "유동성 Runway",
    safeText: "12개월 이상",
    watchText: "6개월 이상 12개월 미만",
    dangerText: "6개월 미만",
    clientExplanation: "현재 현금으로 몇 개월 버틸 수 있는지 보여줍니다.",
  },
  {
    key: "interestCoverage",
    label: "이자보상배율",
    safeText: "3.0배 이상",
    watchText: "1.0배 이상 3.0배 미만",
    dangerText: "1.0배 미만",
    clientExplanation: "영업으로 번 돈으로 이자를 몇 배 감당할 수 있는지 보여줍니다.",
  },
  {
    key: "currentRatio",
    label: "유동비율",
    safeText: "100% 이상",
    watchText: "70% 이상 100% 미만",
    dangerText: "70% 미만",
    clientExplanation:
      "1년 안에 현금화할 수 있는 자산으로 1년 안에 갚을 부채를 감당할 수 있는지 봅니다.",
  },
  {
    key: "debtToEquity",
    label: "부채비율",
    safeText: "200% 이하",
    watchText: "200% 초과 300% 이하",
    dangerText: "300% 초과 또는 자본잠식 우려",
    clientExplanation: "자기자본 대비 부채가 얼마나 많은지 보여줍니다.",
  },
  {
    key: "debtDependency",
    label: "차입금의존도",
    safeText: "업종 평균 이하 또는 30% 이하",
    watchText: "30% 초과 50% 이하",
    dangerText: "50% 초과 또는 단기차환 집중 동반",
    clientExplanation: "자산을 얼마나 차입금으로 조달하고 있는지 보여줍니다.",
  },
  {
    key: "fundingRateShock",
    label: "조달금리 상승폭",
    safeText: "+0.5%p 미만",
    watchText: "+0.5%p 이상 +1.5%p 미만",
    dangerText: "+1.5%p 이상",
    clientExplanation: "금리와 스프레드가 올라 법인의 차입금리가 얼마나 높아졌는지 보여줍니다.",
  },
  {
    key: "ratingDowngrade",
    label: "신용등급 하락 폭",
    safeText: "0 notch",
    watchText: "1 notch 하락",
    dangerText: "2 notch 이상 하락",
    clientExplanation: "법인의 신용도 악화가 차입 여건에 미치는 영향을 봅니다.",
  },
  {
    key: "fundingSpread",
    label: "회사채·여전채 스프레드 확대",
    safeText: "+50bp 미만",
    watchText: "+50bp 이상 +200bp 미만",
    dangerText: "+200bp 이상",
    clientExplanation:
      "시장 전체가 기업에게 요구하는 위험 프리미엄이 얼마나 커졌는지 봅니다.",
  },
  {
    key: "shortTermDebtConcentration",
    label: "단기차입금 만기집중도",
    safeText: "40% 미만",
    watchText: "40% 이상 70% 미만",
    dangerText: "70% 이상",
    clientExplanation: "1년 안에 갚거나 갈아타야 하는 차입금이 얼마나 몰려 있는지 봅니다.",
  },
  {
    key: "workingCapitalBurden",
    label: "운전자본 부담 증가액",
    safeText: "현금버퍼의 10% 미만",
    watchText: "현금버퍼의 10% 이상 25% 미만",
    dangerText: "현금버퍼의 25% 이상",
    clientExplanation: "매출채권 회수 지연이나 재고 증가로 현금이 묶이는 금액입니다.",
  },
];

export const KOREA_BUSINESS_CREDIT_GUIDE: ConsultationGuideRow[] = [
  {
    situation: "법인 매출 둔화",
    indicators: "영업현금흐름 감소액 + EBITDA margin + 이자보상배율",
    guidance: "비용 구조 점검, 현금버퍼 확대",
  },
  {
    situation: "부동산 보유 법인",
    indicators: "임대수입 감소액 + 공실률 + 유동성 Runway",
    guidance: "임대수입 스트레스, 필요 유동성 확보",
  },
  {
    situation: "차입금 많은 법인",
    indicators: "조달금리 상승폭 + 변동금리 차입금 + 이자보상배율",
    guidance: "고정금리 전환, 만기 분산",
  },
  {
    situation: "1년 내 만기 많음",
    indicators: "단기차입금 만기집중도 + 차환 부담 증가액 + 스프레드 확대",
    guidance: "차환 일정 분산, 선제 조달",
  },
  {
    situation: "회수 지연·재고 증가",
    indicators: "운전자본 부담 증가액 + DSO + DIO + 현금버퍼",
    guidance: "매출채권 회수관리, 재고 효율화",
  },
  {
    situation: "신용등급 하락 우려",
    indicators: "신용등급 하락 폭 + 스프레드 확대 + 조달금리 상승폭",
    guidance: "신용도 방어, 차입구조 재점검",
  },
  {
    situation: "포트폴리오 수익추구형",
    indicators: "유동성 부족액 + 포트폴리오 민감도 + 현금 비중",
    guidance: "안정자산·유동성 버킷 확대",
  },
];

export const KOREA_BUSINESS_CREDIT_SOURCES = [
  "본 등급은 공식 신용등급이 아니라 PB 상담용 조기경보 프로토타입 기준입니다. K-IFRS 제1001호의 12개월 유동성 관점, 한국은행 기업경영분석의 이자보상비율 구간, 국내 신용평가사의 재무위험·유동성 분석 요소, 금융투자협회 채권정보센터의 국내 회사채·여전채 금리 체계를 참고해 단순화했습니다.",
  "K-IFRS 제1001호 재무제표 표시",
  "한국은행 기업경영분석",
  "한국신용평가 신용평가 일반론",
  "금융투자협회 채권정보센터 / KOFIA",
  "KRX 관리종목·상장폐지 관련 투자유의사항은 상장 법인 고객 보조 경고 기준으로만 사용",
] as const;

const criteriaMetaMap = new Map(
  KOREA_BUSINESS_CREDIT_CRITERIA.map((item) => [item.key, item]),
);

const clampPositive = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);
const criterionStatus = (score: RiskScore): CriterionStatus =>
  score === 5 ? "Danger" : score === 3 ? "Watch" : "Safe";

const formatEok = (value: number) => {
  const abs = Math.abs(value);
  const digits = abs >= 10 ? 1 : 2;
  return `${value < 0 ? "-" : ""}${abs.toFixed(digits)}억`;
};

const formatPct = (value: number, digits = 1) => `${value.toFixed(digits)}%`;
const formatPp = (value: number, digits = 2) => `${value.toFixed(digits)}%p`;
const formatMonths = (value: number) => `${value.toFixed(1)}개월`;
const formatTurns = (value: number, digits = 1) => `${value.toFixed(digits)}배`;
const formatBp = (value: number) => `${Math.round(value)}bp`;

function buildCriterion(
  key: RiskCriterionKey,
  score: RiskScore,
  valueLabel: string,
  reason: string,
): RiskCriterionResult {
  const meta = criteriaMetaMap.get(key);
  if (!meta) {
    throw new Error(`Unknown criterion key: ${key}`);
  }
  return {
    key,
    label: meta.label,
    score,
    status: criterionStatus(score),
    valueLabel,
    reason,
    clientExplanation: meta.clientExplanation,
  };
}

function recommendationFromDrivers(drivers: RiskCriterionResult[]) {
  const keys = new Set(drivers.map((item) => item.key));
  const recommendations: string[] = [];

  if (keys.has("liquidityGap") || keys.has("runway")) {
    recommendations.push("현금버퍼 확대와 12개월 유동성 버킷 보강");
  }
  if (
    keys.has("interestCoverage") ||
    keys.has("fundingRateShock") ||
    keys.has("ratingDowngrade") ||
    keys.has("fundingSpread")
  ) {
    recommendations.push("차입구조 재점검과 고정금리 전환·만기 분산");
  }
  if (keys.has("workingCapitalBurden")) {
    recommendations.push("매출채권 회수관리와 재고 효율화");
  }
  if (keys.has("shortTermDebtConcentration")) {
    recommendations.push("단기차입금 차환 일정의 선제 분산");
  }
  if (keys.has("debtDependency") || keys.has("debtToEquity")) {
    recommendations.push("부채 구조 조정과 자본완충력 점검");
  }

  return recommendations.slice(0, 2).join(", ");
}

function buildCommentary(
  level: RiskLevel,
  drivers: RiskCriterionResult[],
  input: BusinessCreditRiskInput,
  severeTriggers: string[],
  watchCount: number,
  dangerCount: number,
) {
  const driverLabels = drivers.length
    ? drivers.map((item) => item.label).join(", ")
    : "핵심 위험 신호";
  const recommendation =
    recommendationFromDrivers(drivers) || "현금흐름 방어 계획 점검";

  if (level === "Severe Danger") {
    return [
      `현재 법인은 ${severeTriggers[0] ?? "중대한 조기경보"} 기준에 걸려 Severe Danger로 분류됩니다.`,
      `주요 원인은 ${driverLabels}입니다.`,
      `${recommendation}을 최우선 과제로 두고 즉시 대응안을 검토할 필요가 있습니다.`,
    ].join(" ");
  }

  if (level === "Danger") {
    if (dangerCount > 0) {
      return [
        `현재 법인은 ${dangerCount}개 항목이 5점 Danger 구간에 들어 최종 등급을 Danger로 분류합니다.`,
        `특히 ${driverLabels}이 핵심 원인입니다.`,
        `${recommendation}을 우선 검토해야 합니다.`,
      ].join(" ");
    }

    return [
      `현재 법인은 5점 항목은 없지만 3점 Watch 항목이 ${watchCount}개 누적되고 핵심 유동성 신호가 동반돼 Danger로 승격됐습니다.`,
      `주요 원인은 ${driverLabels}입니다.`,
      `${recommendation}이 필요합니다.`,
    ].join(" ");
  }

  if (level === "Watch") {
    if (input.liquidityGap > 0 && input.survivalMonths >= 12) {
      return [
        "현재 법인은 12개월 유동성 부족액이 발생해 Safe로 보기는 어렵습니다.",
        `다만 유동성 Runway가 ${formatMonths(input.survivalMonths)}로 충분하고 5점 Danger 항목은 없어 Watch로 분류됩니다.`,
        `${recommendation}을 중심으로 현금흐름 방어 방안을 검토할 필요가 있습니다.`,
      ].join(" ");
    }

    return [
      `현재 법인은 5점 Danger 항목은 없지만 ${watchCount}개 항목이 3점 Watch 구간에 들어 Watch로 분류됩니다.`,
      `주요 원인은 ${driverLabels}입니다.`,
      `${recommendation}을 중심으로 보완이 필요합니다.`,
    ].join(" ");
  }

  return [
    "현재 법인은 12개월 유동성 부족액이 없고 5점 Danger 항목도 없어 Safe로 분류됩니다.",
    `포트폴리오 ${input.portfolioLabel}, ${input.companySizeLabel}, ${input.presetName} 시나리오 기준에서도 핵심 재무지표가 상담용 기준 범위 안에 있습니다.`,
    "정기 점검과 선제적 유동성 관리 수준으로 설명하면 됩니다.",
  ].join(" ");
}

export function classifyKoreaBusinessCreditRisk(
  input: BusinessCreditRiskInput,
): KoreaBusinessCreditRiskResult {
  const cashBuffer = clampPositive(input.cashBuffer);
  const liquidityGap = clampPositive(input.liquidityGap);
  const stressUseOfCash = clampPositive(input.stressUseOfCash);
  const survivalMonths = Number.isFinite(input.survivalMonths) ? input.survivalMonths : 0;
  const interestCoverage = Number.isFinite(input.interestCoverage) ? input.interestCoverage : 0;
  const stressedEbitda = Number.isFinite(input.stressedEbitda) ? input.stressedEbitda : 0;
  const currentRatio = clampPositive(input.currentRatio);
  const debtToEquityRatio = clampPositive(input.debtToEquityRatio);
  const totalDebt = clampPositive(input.totalDebt);
  const totalAssets = clampPositive(input.totalAssets);
  const debtDependencyPct = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : totalDebt > 0 ? 100 : 0;
  const debtDependencyBenchmark = Math.max(30, industryAverageDebtDependency[input.industry] ?? 30);
  const fundingRateShockPct = clampPositive(input.fundingRateShockPct);
  const ratingDowngradeNotches = clampPositive(input.ratingDowngradeNotches);
  const fundingSpreadShockBp = clampPositive(input.fundingSpreadShockBp);
  const shortTermDebtConcentrationPct = clampPositive(input.shortTermDebtConcentrationPct);
  const workingCapitalBurdenIncrease = clampPositive(input.workingCapitalBurdenIncrease);
  const refinancingBurdenIncrease = clampPositive(input.refinancingBurdenIncrease);
  const workingCapitalBufferBase = cashBuffer > 0 ? cashBuffer : workingCapitalBurdenIncrease > 0 ? 0.01 : 1;

  const criteria: RiskCriterionResult[] = [];

  if (liquidityGap <= 0) {
    criteria.push(
      buildCriterion("liquidityGap", 1, "부족 없음", "앞으로 12개월 필요현금을 현재 현금버퍼로 감당할 수 있습니다."),
    );
  } else if (
    liquidityGap >= cashBuffer * 0.25 ||
    (stressUseOfCash > 0 && liquidityGap >= stressUseOfCash * 0.2)
  ) {
    criteria.push(
      buildCriterion(
        "liquidityGap",
        5,
        formatEok(liquidityGap),
        "부족액이 현금버퍼의 25% 이상이거나 12개월 필요현금의 20% 이상 부족해 Danger 구간입니다.",
      ),
    );
  } else {
    criteria.push(
      buildCriterion(
        "liquidityGap",
        3,
        formatEok(liquidityGap),
        "부족액은 발생했지만 아직 현금버퍼의 25% 미만이라 Watch 구간입니다.",
      ),
    );
  }

  if (survivalMonths >= 12) {
    criteria.push(
      buildCriterion("runway", 1, formatMonths(survivalMonths), "현재 현금버퍼로 12개월 이상 버틸 수 있습니다."),
    );
  } else if (survivalMonths >= 6) {
    criteria.push(
      buildCriterion("runway", 3, formatMonths(survivalMonths), "현금버퍼가 6개월 이상 12개월 미만만 버텨 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("runway", 5, formatMonths(survivalMonths), "현금버퍼가 6개월 미만만 버텨 Danger 구간입니다."),
    );
  }

  if (interestCoverage >= 3) {
    criteria.push(
      buildCriterion(
        "interestCoverage",
        1,
        formatTurns(interestCoverage),
        "영업으로 번 돈으로 이자를 3배 이상 감당할 수 있습니다.",
      ),
    );
  } else if (interestCoverage >= 1) {
    criteria.push(
      buildCriterion(
        "interestCoverage",
        3,
        formatTurns(interestCoverage),
        "이자 감당력은 남아 있지만 3배 미만으로 내려와 Watch 구간입니다.",
      ),
    );
  } else {
    criteria.push(
      buildCriterion(
        "interestCoverage",
        5,
        formatTurns(interestCoverage),
        "영업으로 벌어들이는 현금흐름만으로 이자를 충분히 감당하지 못해 Danger 구간입니다.",
      ),
    );
  }

  if (currentRatio >= 1) {
    criteria.push(
      buildCriterion("currentRatio", 1, formatTurns(currentRatio, 2), "유동비율이 100% 이상으로 1년 내 지급 부담을 감당할 여력이 있습니다."),
    );
  } else if (currentRatio >= 0.7) {
    criteria.push(
      buildCriterion("currentRatio", 3, formatTurns(currentRatio, 2), "유동비율이 70% 이상 100% 미만으로 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("currentRatio", 5, formatTurns(currentRatio, 2), "유동비율이 70% 미만으로 단기 상환 여력이 부족해 Danger 구간입니다."),
    );
  }

  if (debtToEquityRatio <= 200) {
    criteria.push(
      buildCriterion("debtToEquity", 1, formatPct(debtToEquityRatio, 0), "부채비율이 200% 이하로 상담용 안정 기준 안에 있습니다."),
    );
  } else if (debtToEquityRatio <= 300) {
    criteria.push(
      buildCriterion("debtToEquity", 3, formatPct(debtToEquityRatio, 0), "부채비율이 200%를 넘어 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("debtToEquity", 5, formatPct(debtToEquityRatio, 0), "부채비율이 300%를 넘어 Danger 구간입니다."),
    );
  }

  if (debtDependencyPct <= debtDependencyBenchmark) {
    criteria.push(
      buildCriterion(
        "debtDependency",
        1,
        `${formatPct(debtDependencyPct, 1)} / 업종기준 ${formatPct(debtDependencyBenchmark, 0)}`,
        "차입금의존도가 업종 평균 가정 또는 30% 이하 기준 안에 있습니다.",
      ),
    );
  } else if (
    debtDependencyPct > 50 ||
    (debtDependencyPct > 40 && shortTermDebtConcentrationPct >= 70)
  ) {
    criteria.push(
      buildCriterion(
        "debtDependency",
        5,
        `${formatPct(debtDependencyPct, 1)} / 업종기준 ${formatPct(debtDependencyBenchmark, 0)}`,
        "차입금의존도가 50%를 넘거나 단기 차환 집중이 동반돼 Danger 구간입니다.",
      ),
    );
  } else {
    criteria.push(
      buildCriterion(
        "debtDependency",
        3,
        `${formatPct(debtDependencyPct, 1)} / 업종기준 ${formatPct(debtDependencyBenchmark, 0)}`,
        "차입금의존도가 30%를 넘었지만 50% 이하로 Watch 구간입니다.",
      ),
    );
  }

  if (fundingRateShockPct < 0.5) {
    criteria.push(
      buildCriterion("fundingRateShock", 1, formatPp(fundingRateShockPct), "조달금리 상승폭이 0.5%p 미만으로 제한적입니다."),
    );
  } else if (fundingRateShockPct < 1.5) {
    criteria.push(
      buildCriterion("fundingRateShock", 3, formatPp(fundingRateShockPct), "조달금리 상승폭이 0.5%p 이상으로 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("fundingRateShock", 5, formatPp(fundingRateShockPct), "조달금리 상승폭이 1.5%p 이상으로 Danger 구간입니다."),
    );
  }

  if (ratingDowngradeNotches === 0) {
    criteria.push(
      buildCriterion("ratingDowngrade", 1, "0 notch", "신용등급 하락이 없어 조달 경색 신호가 제한적입니다."),
    );
  } else if (ratingDowngradeNotches === 1) {
    criteria.push(
      buildCriterion("ratingDowngrade", 3, "1 notch", "신용등급이 1 notch 하락해 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("ratingDowngrade", 5, `${ratingDowngradeNotches.toFixed(0)} notch`, "신용등급이 2 notch 이상 하락해 Danger 구간입니다."),
    );
  }

  if (fundingSpreadShockBp < 50) {
    criteria.push(
      buildCriterion("fundingSpread", 1, formatBp(fundingSpreadShockBp), "회사채·여전채 스프레드 확대폭이 50bp 미만입니다."),
    );
  } else if (fundingSpreadShockBp < 200) {
    criteria.push(
      buildCriterion("fundingSpread", 3, formatBp(fundingSpreadShockBp), "스프레드 확대폭이 50bp 이상으로 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("fundingSpread", 5, formatBp(fundingSpreadShockBp), "스프레드 확대폭이 200bp 이상으로 Danger 구간입니다."),
    );
  }

  if (shortTermDebtConcentrationPct < 40) {
    criteria.push(
      buildCriterion("shortTermDebtConcentration", 1, formatPct(shortTermDebtConcentrationPct, 0), "단기차입금 만기집중도가 40% 미만입니다."),
    );
  } else if (shortTermDebtConcentrationPct < 70) {
    criteria.push(
      buildCriterion("shortTermDebtConcentration", 3, formatPct(shortTermDebtConcentrationPct, 0), "단기차입금 만기집중도가 40% 이상으로 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("shortTermDebtConcentration", 5, formatPct(shortTermDebtConcentrationPct, 0), "단기차입금 만기집중도가 70% 이상으로 Danger 구간입니다."),
    );
  }

  if (workingCapitalBurdenIncrease < workingCapitalBufferBase * 0.1) {
    criteria.push(
      buildCriterion("workingCapitalBurden", 1, formatEok(workingCapitalBurdenIncrease), "운전자본 부담 증가액이 현금버퍼의 10% 미만입니다."),
    );
  } else if (workingCapitalBurdenIncrease < workingCapitalBufferBase * 0.25) {
    criteria.push(
      buildCriterion("workingCapitalBurden", 3, formatEok(workingCapitalBurdenIncrease), "운전자본 부담 증가액이 현금버퍼의 10% 이상으로 Watch 구간입니다."),
    );
  } else {
    criteria.push(
      buildCriterion("workingCapitalBurden", 5, formatEok(workingCapitalBurdenIncrease), "운전자본 부담 증가액이 현금버퍼의 25% 이상으로 Danger 구간입니다."),
    );
  }

  const dangerFlags = criteria.filter((item) => item.score === 5);
  const watchFlags = criteria.filter((item) => item.score === 3);
  const severeTriggers: string[] = [];

  if (survivalMonths < 3) {
    severeTriggers.push("유동성 Runway가 3개월 미만입니다");
  }
  if (interestCoverage < 0 || stressedEbitda < 0) {
    severeTriggers.push("이자보상배율이 0배 미만이거나 영업손실 구간입니다");
  }
  if (ratingDowngradeNotches >= 3 && fundingSpreadShockBp >= 300) {
    severeTriggers.push("신용등급 3 notch 하락과 스프레드 300bp 이상 확대가 동시에 발생했습니다");
  }

  const coreWatchTriggered =
    watchFlags.some((item) => criticalWatchKeys.has(item.key)) ||
    refinancingBurdenIncrease >= Math.max(cashBuffer * 0.1, 1);

  let level: RiskLevel = "Safe";
  if (severeTriggers.length > 0) {
    level = "Severe Danger";
  } else if (dangerFlags.length > 0) {
    level = "Danger";
  } else if (watchFlags.length >= 3 && coreWatchTriggered) {
    level = "Danger";
  } else if (watchFlags.length >= 2 || liquidityGap > 0) {
    level = "Watch";
  } else if (watchFlags.length <= 1 && liquidityGap <= 0) {
    level = "Safe";
  }

  const topDrivers = [...criteria]
    .filter((item) => item.score > 1)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return driverPriority[b.key] - driverPriority[a.key];
    })
    .slice(0, 3);

  const explanation =
    level === "Severe Danger"
      ? severeTriggers.join(", ")
      : level === "Danger" && dangerFlags.length > 0
        ? `${dangerFlags.length}개 항목이 5점 Danger 기준에 해당합니다.`
        : level === "Danger"
          ? "3점 Watch 항목이 누적되고 핵심 유동성 신호가 동반되어 Danger로 승격됐습니다."
          : level === "Watch"
            ? "5점 Danger 항목은 없지만 일부 지표가 Watch 구간에 들어 있습니다."
            : "핵심 지표가 상담용 Safe 기준 안에 있습니다.";

  return {
    level,
    criteria,
    watchFlags,
    dangerFlags,
    topDrivers,
    severeTriggers,
    watchCount: watchFlags.length,
    dangerCount: dangerFlags.length,
    explanation,
    pbCommentary: buildCommentary(
      level,
      topDrivers,
      input,
      severeTriggers,
      watchFlags.length,
      dangerFlags.length,
    ),
  };
}
