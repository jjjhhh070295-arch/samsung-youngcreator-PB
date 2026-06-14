import type { MicroStressScenario } from "./microStress";

export type MicroStressScenarioPreset = MicroStressScenario & {
  name: string;
  message: string;
};

export const zeroMicroStressScenario: MicroStressScenario = {
  revenueShock: 0,
  marginShockPp: 0,
  vacancyShockPp: 0,
  fundingSpreadShockBp: 0,
  ratingDowngradeNotches: 0,
  receivablesDelayDays: 0,
  inventoryDelayDays: 0,
  shortTermDebtConcentrationPct: 0,
};

export const microStressScenarios = {
  mild: {
    name: "Mild",
    revenueShock: -0.1,
    marginShockPp: -1,
    vacancyShockPp: 3,
    fundingSpreadShockBp: 50,
    ratingDowngradeNotches: 0,
    receivablesDelayDays: 10,
    inventoryDelayDays: 5,
    shortTermDebtConcentrationPct: 25,
    message: "관찰",
  },
  base: {
    name: "Base",
    revenueShock: -0.2,
    marginShockPp: -3,
    vacancyShockPp: 7,
    fundingSpreadShockBp: 150,
    ratingDowngradeNotches: 1,
    receivablesDelayDays: 20,
    inventoryDelayDays: 15,
    shortTermDebtConcentrationPct: 50,
    message: "주의",
  },
  severe: {
    name: "Severe",
    revenueShock: -0.35,
    marginShockPp: -7,
    vacancyShockPp: 15,
    fundingSpreadShockBp: 300,
    ratingDowngradeNotches: 3,
    receivablesDelayDays: 60,
    inventoryDelayDays: 45,
    shortTermDebtConcentrationPct: 80,
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
    id: "revenue_slowdown",
    name: "매출 둔화",
    scenario: {
      revenueShock: -0.2,
      marginShockPp: -3,
      vacancyShockPp: 2,
      fundingSpreadShockBp: 50,
      ratingDowngradeNotches: 0,
      receivablesDelayDays: 15,
      inventoryDelayDays: 10,
      shortTermDebtConcentrationPct: 30,
    },
  },
  {
    id: "vacancy_rise",
    name: "공실률 상승",
    scenario: {
      revenueShock: -0.05,
      marginShockPp: -1,
      vacancyShockPp: 12,
      fundingSpreadShockBp: 50,
      ratingDowngradeNotches: 0,
      receivablesDelayDays: 10,
      inventoryDelayDays: 0,
      shortTermDebtConcentrationPct: 20,
    },
  },
  {
    id: "spread_rise",
    name: "금리·스프레드 확대",
    scenario: {
      revenueShock: -0.1,
      marginShockPp: -2,
      vacancyShockPp: 3,
      fundingSpreadShockBp: 150,
      ratingDowngradeNotches: 1,
      receivablesDelayDays: 20,
      inventoryDelayDays: 15,
      shortTermDebtConcentrationPct: 50,
    },
  },
  {
    id: "rating_downgrade",
    name: "신용등급 하락",
    scenario: {
      revenueShock: -0.15,
      marginShockPp: -3,
      vacancyShockPp: 5,
      fundingSpreadShockBp: 200,
      ratingDowngradeNotches: 2,
      receivablesDelayDays: 30,
      inventoryDelayDays: 20,
      shortTermDebtConcentrationPct: 60,
    },
  },
  {
    id: "combined_crisis",
    name: "복합 위기",
    scenario: microStressScenarios.severe,
  },
  {
    id: "macro_linked",
    name: "매크로 연동형",
    scenario: {
      revenueShock: -0.18,
      marginShockPp: -3,
      vacancyShockPp: 6,
      fundingSpreadShockBp: 180,
      ratingDowngradeNotches: 1,
      receivablesDelayDays: 25,
      inventoryDelayDays: 20,
      shortTermDebtConcentrationPct: 60,
    },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  scenario: MicroStressScenario;
}>;

export type MicroStressPresetId =
  | "custom"
  | (typeof microStressPresetScenarios)[number]["id"];

export const microStressSliderMeta = [
  {
    key: "revenueShock",
    label: "법인 매출 감소율",
    unit: "%",
    min: -50,
    max: 0,
    step: 1,
    hint: "법인 자체 매출 충격입니다. 포트폴리오 민감도는 이 값을 직접 바꾸지 않습니다.",
  },
  {
    key: "marginShockPp",
    label: "EBITDA margin 악화폭",
    unit: "%p",
    min: -15,
    max: 0,
    step: 0.5,
    hint: "원가·인건비·환율 부담이 수익성을 얼마나 훼손하는지 반영합니다.",
  },
  {
    key: "vacancyShockPp",
    label: "공실률 상승폭",
    unit: "%p",
    min: 0,
    max: 30,
    step: 1,
    hint: "보유 부동산 임대수입 방어력을 점검합니다.",
  },
  {
    key: "fundingSpreadShockBp",
    label: "회사채·여전채 스프레드 확대폭",
    unit: "bp",
    min: 0,
    max: 500,
    step: 10,
    hint: "회사채·여전채·대출 스프레드 상승에 따른 조달금리 상승입니다.",
  },
  {
    key: "ratingDowngradeNotches",
    label: "신용등급 하락 폭",
    unit: "notch",
    min: 0,
    max: 3,
    step: 1,
    hint: "1 notch당 50bp 가산 스프레드를 기본값으로 적용합니다.",
  },
  {
    key: "receivablesDelayDays",
    label: "매출채권 회수기간 증가",
    unit: "일",
    min: 0,
    max: 90,
    step: 1,
    hint: "거래처 회수 지연이 단기 유동성에 주는 영향을 봅니다.",
  },
  {
    key: "inventoryDelayDays",
    label: "재고자산 회전일수 증가",
    unit: "일",
    min: 0,
    max: 90,
    step: 1,
    hint: "재고가 현금으로 전환되는 속도가 늦어지는 부담을 반영합니다.",
  },
  {
    key: "shortTermDebtConcentrationPct",
    label: "단기차입금 만기집중도",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
    hint: "12개월 내 차환 필요 차입금 중 실제 차환 압박으로 보는 비율입니다.",
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
