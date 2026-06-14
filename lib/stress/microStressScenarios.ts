import type { MicroStressScenario } from "./microStress";

export type MicroStressScenarioPreset = MicroStressScenario & {
  name: string;
  message: string;
};

export const zeroMicroStressScenario: MicroStressScenario = {
  revenueShock: 0,
  marginShockPp: 0,
  vacancyShockPp: 0,
  rentShock: 0,
  fundingSpreadShockBp: 0,
  ratingDowngradeNotches: 0,
  workingCapitalShockPct: 0,
  collectionDelayDays: 0,
};

export const microStressScenarios = {
  mild: {
    name: "Mild",
    revenueShock: -0.08,
    marginShockPp: -0.8,
    vacancyShockPp: 3,
    rentShock: -0.02,
    fundingSpreadShockBp: 40,
    ratingDowngradeNotches: 0,
    workingCapitalShockPct: 0.5,
    collectionDelayDays: 5,
    message: "관찰",
  },
  base: {
    name: "Base",
    revenueShock: -0.18,
    marginShockPp: -1.8,
    vacancyShockPp: 7,
    rentShock: -0.05,
    fundingSpreadShockBp: 120,
    ratingDowngradeNotches: 1,
    workingCapitalShockPct: 1.5,
    collectionDelayDays: 12,
    message: "주의",
  },
  severe: {
    name: "Severe",
    revenueShock: -0.35,
    marginShockPp: -3.5,
    vacancyShockPp: 12,
    rentShock: -0.1,
    fundingSpreadShockBp: 250,
    ratingDowngradeNotches: 2,
    workingCapitalShockPct: 3,
    collectionDelayDays: 25,
    message: "위험",
  },
} satisfies Record<string, MicroStressScenarioPreset>;

export const microStressPresetScenarios = [
  {
    id: "none",
    name: "충격 없음",
    scenario: zeroMicroStressScenario,
  },
  {
    id: "base",
    name: "기본 복합 충격",
    scenario: microStressScenarios.base,
  },
  {
    id: "revenue",
    name: "법인 매출 급락",
    scenario: {
      ...zeroMicroStressScenario,
      revenueShock: -0.28,
      marginShockPp: -2.5,
      workingCapitalShockPct: 1.2,
      collectionDelayDays: 10,
    },
  },
  {
    id: "real_estate",
    name: "공실률 상승·임대료 하락",
    scenario: {
      ...zeroMicroStressScenario,
      vacancyShockPp: 13,
      rentShock: -0.12,
      collectionDelayDays: 8,
    },
  },
  {
    id: "refinancing",
    name: "회사채·여전채 스프레드 확대",
    scenario: {
      ...zeroMicroStressScenario,
      fundingSpreadShockBp: 220,
      ratingDowngradeNotches: 1,
      workingCapitalShockPct: 0.8,
    },
  },
  {
    id: "downgrade",
    name: "법인 신용등급 하락",
    scenario: {
      ...zeroMicroStressScenario,
      revenueShock: -0.12,
      marginShockPp: -1,
      fundingSpreadShockBp: 150,
      ratingDowngradeNotches: 2,
      workingCapitalShockPct: 1.5,
      collectionDelayDays: 15,
    },
  },
  {
    id: "severe",
    name: "복합 위기",
    scenario: microStressScenarios.severe,
  },
] as const;

export type MicroStressPresetId =
  | "custom"
  | (typeof microStressPresetScenarios)[number]["id"];

export const microStressSliderMeta = [
  {
    key: "revenueShock",
    label: "법인 매출 감소",
    unit: "%",
    min: -50,
    max: 0,
    step: 1,
    hint: "영업현금흐름 감소의 핵심 입력값입니다.",
  },
  {
    key: "marginShockPp",
    label: "EBITDA 마진 압박",
    unit: "%p",
    min: -8,
    max: 0,
    step: 0.1,
    hint: "원가·인건비·환율 부담이 수익성에 주는 영향을 반영합니다.",
  },
  {
    key: "vacancyShockPp",
    label: "공실률 상승",
    unit: "%p",
    min: 0,
    max: 30,
    step: 1,
    hint: "보유 부동산 임대수입 방어력을 점검합니다.",
  },
  {
    key: "rentShock",
    label: "임대료 하락",
    unit: "%",
    min: -30,
    max: 0,
    step: 1,
    hint: "공실 외에 임대료 재협상 리스크를 반영합니다.",
  },
  {
    key: "fundingSpreadShockBp",
    label: "차입 스프레드 확대",
    unit: "bp",
    min: 0,
    max: 500,
    step: 10,
    hint: "회사채·여전채·대출 스프레드 상승에 따른 이자비용입니다.",
  },
  {
    key: "ratingDowngradeNotches",
    label: "신용등급 하락",
    unit: "notch",
    min: 0,
    max: 4,
    step: 1,
    hint: "등급 하락이 차환 가산금리와 약정 리스크에 미치는 영향을 봅니다.",
  },
  {
    key: "workingCapitalShockPct",
    label: "운전자본 추가 필요",
    unit: "% of sales",
    min: 0,
    max: 8,
    step: 0.1,
    hint: "재고·매입조건 악화로 묶이는 현금입니다.",
  },
  {
    key: "collectionDelayDays",
    label: "매출채권 회수 지연",
    unit: "일",
    min: 0,
    max: 60,
    step: 1,
    hint: "거래처 회수 지연이 단기 유동성에 주는 영향을 봅니다.",
  },
] as const satisfies ReadonlyArray<{
  key: keyof MicroStressScenario;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}>;
