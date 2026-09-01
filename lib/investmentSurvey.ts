import type { Client, IPS, IPSFactor } from "./types";
import { emptyFactor } from "./types";

export interface SurveyOption {
  id: string;
  label: string;
  score: number;
}

export interface SurveyQuestion {
  id: keyof InvestmentSurveyAnswers;
  number: number;
  title: string;
  referenceOnly?: boolean;
  multiple?: boolean;
  options: SurveyOption[];
}

export interface InvestmentSurveyAnswers {
  age: string;
  investmentPeriod: string;
  investmentExperience: string[];
  derivativeExperience: string;
  lossTolerance: string;
  investableAssetRatio: string;
  monthlyIncome: string;
  investmentPurpose: string;
  financialKnowledge: string;
  uniqueSituation: string;
}

export interface InvestmentSurveyResult {
  answers: InvestmentSurveyAnswers;
  rawScore: number;
  convertedScore: number;
  tendencyBeforeCap: string;
  finalTendency: string;
  capReason: string | null;
  submittedAt: string;
}

export const SURVEY_MAX_SCORE = 72;

export const TENDENCY_LABELS = [
  "안정형",
  "안정추구형",
  "위험중립형",
  "적극투자형",
  "공격투자형",
] as const;

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "age",
    number: 1,
    title: "고객님의 연령대",
    options: [
      { id: "under19", label: "만 19세 이하", score: 6 },
      { id: "20to40", label: "만 20세~40세", score: 8 },
      { id: "41to50", label: "만 41세~50세", score: 6 },
      { id: "51to60", label: "만 51세~60세", score: 4 },
      { id: "61plus", label: "만 61세 이상", score: 2 },
    ],
  },
  {
    id: "investmentPeriod",
    number: 2,
    title: "투자예정기간",
    options: [
      { id: "3y_plus", label: "3년 이상", score: 10 },
      { id: "2y_to_3y", label: "2년 이상 ~ 3년 미만", score: 8 },
      { id: "1y_to_2y", label: "1년 이상 ~ 2년 미만", score: 6 },
      { id: "6m_to_1y", label: "6개월 이상 ~ 1년 미만", score: 4 },
      { id: "under6m", label: "6개월 미만", score: 2 },
    ],
  },
  {
    id: "investmentExperience",
    number: 3,
    title: "투자경험",
    multiple: true,
    options: [
      { id: "aggressive", label: "공격투자형 상품", score: 10 },
      { id: "active", label: "적극투자형 상품", score: 8 },
      { id: "neutral", label: "위험중립형 상품", score: 6 },
      { id: "stable_seek", label: "안정추구형 상품", score: 4 },
      { id: "stable", label: "안정형 상품", score: 2 },
    ],
  },
  {
    id: "derivativeExperience",
    number: 4,
    title: "파생상품 등 투자경험",
    referenceOnly: true,
    options: [
      { id: "under1y", label: "1년 미만", score: 0 },
      { id: "1y_to_3y", label: "1년 이상 ~ 3년 미만", score: 0 },
      { id: "3y_plus", label: "3년 이상", score: 0 },
    ],
  },
  {
    id: "lossTolerance",
    number: 5,
    title: "감내할 수 있는 손실수준",
    options: [
      { id: "high_risk_ok", label: "기대수익이 높다면 위험이 높아도 상관하지 않음", score: 8 },
      { id: "partial_loss", label: "투자원금 중 일부의 손실을 감수할 수 있음", score: 6 },
      { id: "minimal_loss", label: "투자원금에서 최소한의 손실만을 감수할 수 있음", score: 4 },
      { id: "principal_preserve", label: "무슨 일이 있어도 투자원금은 보전되어야 함", score: 2 },
    ],
  },
  {
    id: "investableAssetRatio",
    number: 6,
    title: "총자산 대비 투자성자산 비중",
    options: [
      { id: "10pct", label: "10% 이하", score: 2 },
      { id: "30pct", label: "30% 이하", score: 4 },
      { id: "50pct", label: "50% 이하", score: 6 },
      { id: "70pct", label: "70% 이하", score: 8 },
      { id: "over70", label: "70% 초과", score: 10 },
    ],
  },
  {
    id: "monthlyIncome",
    number: 7,
    title: "월소득 현황",
    options: [
      { id: "over5m", label: "500만원 초과", score: 6 },
      { id: "5m", label: "500만원 이하", score: 5 },
      { id: "3m", label: "300만원 이하", score: 4 },
      { id: "2m", label: "200만원 이하", score: 3 },
      { id: "1m", label: "100만원 이하", score: 2 },
    ],
  },
  {
    id: "investmentPurpose",
    number: 8,
    title: "투자목적",
    options: [
      { id: "living_short", label: "생계(단기)자금 운용", score: 2 },
      { id: "deposit_like", label: "예적금수준 수익률 기대", score: 4 },
      { id: "market_avg", label: "시장평균 이상 수익률 기대", score: 6 },
      { id: "wealth_growth", label: "적극적인 재산(자산)증식", score: 8 },
    ],
  },
  {
    id: "financialKnowledge",
    number: 9,
    title: "금융지식 수준/이해도",
    options: [
      { id: "none", label: "금융투자상품에 투자해 본 경험이 없음", score: 0 },
      { id: "basic", label: "널리 알려진 금융투자상품(주식, 채권 및 펀드 등)의 구조 및 위험을 일정 부분 이해하고 있음", score: 4 },
      { id: "deep", label: "널리 알려진 금융투자상품(주식, 채권 및 펀드 등)의 구조 및 위험을 깊이 있게 이해하고 있음", score: 8 },
      { id: "advanced", label: "파생상품을 포함한 대부분의 금융투자상품의 구조 및 위험을 이해하고 있음", score: 12 },
    ],
  },
];

export function emptySurveyAnswers(): InvestmentSurveyAnswers {
  return {
    age: "",
    investmentPeriod: "",
    investmentExperience: [],
    derivativeExperience: "",
    lossTolerance: "",
    investableAssetRatio: "",
    monthlyIncome: "",
    investmentPurpose: "",
    financialKnowledge: "",
    uniqueSituation: "",
  };
}

function optionScore(question: SurveyQuestion, answer: string | string[]): number {
  if (question.referenceOnly) return 0;
  if (question.multiple && Array.isArray(answer)) {
    if (answer.length === 0) return 0;
    return Math.max(
      ...answer.map((id) => question.options.find((o) => o.id === id)?.score ?? 0),
    );
  }
  if (typeof answer === "string") {
    return question.options.find((o) => o.id === answer)?.score ?? 0;
  }
  return 0;
}

function optionLabel(question: SurveyQuestion, answerId: string): string {
  return question.options.find((o) => o.id === answerId)?.label ?? "";
}

export function calculateSurveyScore(answers: InvestmentSurveyAnswers): {
  rawScore: number;
  convertedScore: number;
  tendencyBeforeCap: string;
  finalTendency: string;
  capReason: string | null;
} {
  let rawScore = 0;
  for (const q of SURVEY_QUESTIONS) {
    const value = answers[q.id];
    rawScore += optionScore(q, value as string & string[]);
  }

  const convertedScore = Math.round((rawScore * 1000) / SURVEY_MAX_SCORE) / 10;
  const tendencyBeforeCap = tendencyFromConvertedScore(convertedScore);
  const { finalTendency, capReason } = applySuitabilityCap(tendencyBeforeCap, answers.lossTolerance);

  return { rawScore, convertedScore, tendencyBeforeCap, finalTendency, capReason };
}

export function tendencyFromConvertedScore(convertedScore: number): string {
  if (convertedScore <= 20) return "안정형";
  if (convertedScore <= 40) return "안정추구형";
  if (convertedScore <= 60) return "위험중립형";
  if (convertedScore <= 80) return "적극투자형";
  return "공격투자형";
}

function tendencyIndex(label: string): number {
  return TENDENCY_LABELS.indexOf(label as (typeof TENDENCY_LABELS)[number]);
}

export function applySuitabilityCap(
  tendency: string,
  lossTolerance: string,
): { finalTendency: string; capReason: string | null } {
  const idx = tendencyIndex(tendency);
  if (lossTolerance === "principal_preserve" && idx > 0) {
    return {
      finalTendency: "안정형",
      capReason: "손실수준 응답(원금 보전)에 따라 최종 투자성향을 안정형으로 제한했습니다.",
    };
  }
  if (lossTolerance === "minimal_loss" && idx > 2) {
    return {
      finalTendency: "위험중립형",
      capReason: "손실수준 응답(최소 손실)에 따라 최종 투자성향을 위험중립형 이하로 제한했습니다.",
    };
  }
  return { finalTendency: tendency, capReason: null };
}

function clampFactorScore(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score)));
}

function weightedFactorScore(weights: { score: number; weight: number }[]): number {
  const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return 3;
  const value = weights.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight;
  return clampFactorScore(value);
}

function mapOptionToFactor5(score: number, max: number): number {
  const ratio = score / max;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.6) return 3;
  if (ratio <= 0.8) return 4;
  return 5;
}

function resolveTaxFactor(client: Client, currentTax: IPSFactor): IPSFactor {
  if (currentTax.status === "explicit" && currentTax.score != null && currentTax.value) {
    return { ...currentTax };
  }

  const notes = client.consultationNotes ?? "";
  const hasTaxNotes = /세금|증여|상속|양도|과세|절세|세율|금융소득|종합과세/i.test(notes);
  const hasTaxCashflow = (client.cashFlows ?? []).some((flow) =>
    /세|tax|증여|상속|양도|과세/i.test(
      `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""}`,
    ),
  );

  if (hasTaxCashflow || hasTaxNotes) {
    return {
      value: hasTaxCashflow
        ? "현금흐름·상담 메모 기반 세금 이벤트 확인"
        : "상담 메모 기반 세금 요인 확인 필요",
      score: hasTaxCashflow ? 4 : 3,
      notes: "설문 외 기존 세금·현금흐름·상담 데이터 반영",
      source: "manual",
      status: "explicit",
      evidence: "",
      inferenceHint: "",
      reviewed: true,
    };
  }

  return {
    ...emptyFactor("manual"),
    value: "미확정/추가 확인 필요",
    notes: "세금·현금흐름 입력 또는 상담 확인 후 점수 산출",
    reviewed: false,
  };
}

function buildFactor(
  value: string,
  score: number,
  notes: string,
  evidence: string,
): IPSFactor {
  return {
    value,
    score,
    notes,
    source: "manual",
    status: "explicit",
    evidence,
    inferenceHint: "",
    reviewed: true,
  };
}

export function mapSurveyToIPS(
  answers: InvestmentSurveyAnswers,
  result: Pick<
    InvestmentSurveyResult,
    "rawScore" | "convertedScore" | "finalTendency" | "capReason"
  >,
  client: Client,
): IPS {
  const q = (id: keyof InvestmentSurveyAnswers) =>
    SURVEY_QUESTIONS.find((item) => item.id === id)!;

  const purposeScore = optionScore(q("investmentPurpose"), answers.investmentPurpose);
  const experienceScore = optionScore(q("investmentExperience"), answers.investmentExperience);
  const knowledgeScore = optionScore(q("financialKnowledge"), answers.financialKnowledge);
  const lossScore = optionScore(q("lossTolerance"), answers.lossTolerance);
  const ratioScore = optionScore(q("investableAssetRatio"), answers.investableAssetRatio);
  const periodScore = optionScore(q("investmentPeriod"), answers.investmentPeriod);
  const incomeScore = optionScore(q("monthlyIncome"), answers.monthlyIncome);
  const ageScore = optionScore(q("age"), answers.age);

  const returnScore = weightedFactorScore([
    { score: mapOptionToFactor5(purposeScore, 8), weight: 0.4 },
    { score: mapOptionToFactor5(experienceScore, 10), weight: 0.35 },
    { score: mapOptionToFactor5(knowledgeScore, 12), weight: 0.25 },
  ]);

  const riskScore = weightedFactorScore([
    { score: mapOptionToFactor5(lossScore, 8), weight: 0.4 },
    { score: mapOptionToFactor5(experienceScore, 10), weight: 0.35 },
    { score: mapOptionToFactor5(ratioScore, 10), weight: 0.25 },
  ]);

  const timeScore = mapOptionToFactor5(periodScore, 10);

  let liquidityScore = weightedFactorScore([
    { score: mapOptionToFactor5(6 - incomeScore + 2, 6), weight: 0.35 },
    { score: mapOptionToFactor5(12 - periodScore, 10), weight: 0.35 },
    {
      score: answers.investmentPurpose === "living_short" ? 5 : 2,
      weight: 0.3,
    },
  ]);

  if (answers.investmentPurpose === "living_short") {
    liquidityScore = Math.max(liquidityScore, 4);
  }

  let legalScore = weightedFactorScore([
    { score: mapOptionToFactor5(8 - ageScore + 2, 8), weight: 0.45 },
    {
      score:
        answers.derivativeExperience === "under1y"
          ? 4
          : answers.derivativeExperience === "1y_to_3y"
            ? 3
            : answers.derivativeExperience === "3y_plus"
              ? 2
              : 3,
      weight: 0.35,
    },
    {
      score: result.capReason ? 4 : 2,
      weight: 0.2,
    },
  ]);

  if (answers.age === "61plus" || answers.age === "under19") {
    legalScore = Math.max(legalScore, 3);
  }

  const uniqueText = answers.uniqueSituation.trim();
  const uniqueScore = uniqueText
    ? /ipo|보호예수|m&a|증여|매각|대출|세금|부동산/i.test(uniqueText)
      ? 4
      : 3
    : 1;

  const evidence = `투자성향 설문 (${result.rawScore}/${SURVEY_MAX_SCORE}점, 환산 ${result.convertedScore}점, ${result.finalTendency})`;

  return {
    return: buildFactor(
      optionLabel(q("investmentPurpose"), answers.investmentPurpose),
      returnScore,
      "투자목적·투자경험·금융지식 기반",
      evidence,
    ),
    risk: buildFactor(
      result.finalTendency,
      riskScore,
      result.capReason ?? "손실수준·투자경험·투자성자산 비중 기반",
      evidence,
    ),
    timeHorizon: buildFactor(
      optionLabel(q("investmentPeriod"), answers.investmentPeriod),
      timeScore,
      "투자예정기간 기반",
      evidence,
    ),
    tax: resolveTaxFactor(client, client.ips.tax),
    liquidity: buildFactor(
      answers.investmentPurpose === "living_short"
        ? "단기 생계자금·소득 수준 고려"
        : "소득·투자기간·목적 기반 유동성",
      liquidityScore,
      "월소득·투자예정기간·생계자금 목적 반영",
      evidence,
    ),
    legal: buildFactor(
      answers.derivativeExperience
        ? `연령·파생상품 경험(${optionLabel(q("derivativeExperience"), answers.derivativeExperience)})`
        : "연령·적합성 제한 반영",
      legalScore,
      "연령대·파생상품 경험·적합성 제한 반영",
      evidence,
    ),
    unique: buildFactor(
      uniqueText || "특이사항 없음",
      uniqueScore,
      "설문 고유상황 직접 입력",
      uniqueText || evidence,
    ),
  };
}

export function isSurveyComplete(answers: InvestmentSurveyAnswers): boolean {
  return (
    !!answers.age &&
    !!answers.investmentPeriod &&
    answers.investmentExperience.length > 0 &&
    !!answers.derivativeExperience &&
    !!answers.lossTolerance &&
    !!answers.investableAssetRatio &&
    !!answers.monthlyIncome &&
    !!answers.investmentPurpose &&
    !!answers.financialKnowledge
  );
}

export const SURVEY_FACTOR_MAPPING = [
  { factor: "목표 수익률", source: "투자목적 + 투자경험 + 금융지식" },
  { factor: "위험 허용도", source: "손실수준 + 투자경험 + 투자성자산 비중" },
  { factor: "투자 기간", source: "투자예정기간" },
  { factor: "유동성", source: "월소득 + 투자예정기간 + 생계자금 목적" },
  { factor: "법적/규제", source: "연령대 + 파생상품 경험 + 적합성 제한" },
  { factor: "고유 상황", source: "고유상황 직접 입력" },
  { factor: "세금 요인", source: "기존 세금·현금흐름·상담메모 유지, 없으면 미확정" },
] as const;
