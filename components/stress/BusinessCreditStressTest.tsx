"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CREDIT_RATINGS,
  calculateMicroStress,
  normalizeCreditRating,
  type CompanySize,
  type CreditRating,
  type MicroRiskLevel,
  type MicroStressInput,
  type MicroStressScenario,
} from "@/lib/stress/microStress";
import {
  KOREA_BUSINESS_CREDIT_CRITERIA,
  KOREA_BUSINESS_CREDIT_GUIDE,
  KOREA_BUSINESS_CREDIT_SOURCES,
  classifyKoreaBusinessCreditRisk,
  type RiskLevel,
  type RiskScore,
} from "@/lib/stress/koreaBusinessCreditRisk";
import {
  microStressPresetScenarios,
  microStressScenarios,
  microStressSliderMeta,
  type MicroStressPresetId,
} from "@/lib/stress/microStressScenarios";
import type { Portfolio, ScenarioShock } from "@/lib/types";

type PortfolioProfileKey = "stable" | "balanced" | "growth";
type IndustryKey = "manufacturing" | "wholesale" | "construction" | "it" | "real_estate" | "other";

type Props = {
  portfolios?: Portfolio[];
  macroShock?: ScenarioShock;
  macroPresetId?: string;
};

type PortfolioStressProfile = {
  key: PortfolioProfileKey;
  label: string;
  labelEn: string;
  sensitivity: number;
  description: string;
};

type CompanyProfile = {
  key: CompanySize;
  label: string;
  fundingSensitivity: number;
  description: string;
};

type CompanyClassificationInput = {
  selectedSize: CompanySize;
  industry: IndustryKey;
  averageRevenue3y: number;
  totalAssets: number;
  isDisclosureGroup: boolean;
  isCrossShareholdingGroup: boolean;
  hasLargeCompanyOwner30: boolean;
  isPublicInstitution: boolean;
};

const portfolioProfiles: Record<PortfolioProfileKey, PortfolioStressProfile> = {
  stable: {
    key: "stable",
    label: "안정형",
    labelEn: "Stable",
    sensitivity: 0.75,
    description:
      "현금성·안정형 자산 비중이 높아 동일한 법인 충격에서도 유동성 방어 흡수력이 상대적으로 큽니다.",
  },
  balanced: {
    key: "balanced",
    label: "균형형",
    labelEn: "Balanced",
    sensitivity: 1,
    description:
      "기준 포트폴리오로 보아 법인 스트레스가 유동성 방어력에 전이되는 정도를 표준값으로 반영합니다.",
  },
  growth: {
    key: "growth",
    label: "수익추구형",
    labelEn: "Growth",
    sensitivity: 1.25,
    description:
      "위험자산 현금화 할인과 변동성 부담을 감안해 동일한 법인 충격에도 유동성 부족액을 더 민감하게 봅니다.",
  },
};

const companyProfiles: Record<CompanySize, CompanyProfile> = {
  sme: {
    key: "sme",
    label: "중소기업",
    fundingSensitivity: 1.2,
    description:
      "외부 충격 시 자금조달 접근성이 상대적으로 낮다고 보고 스프레드·등급 하락 민감도를 높게 적용합니다.",
  },
  middle: {
    key: "middle",
    label: "중견기업",
    fundingSensitivity: 1,
    description: "중견기업은 기준 조달 민감도를 적용합니다.",
  },
  large: {
    key: "large",
    label: "대기업/대규모기업집단",
    fundingSensitivity: 0.85,
    description:
      "조달 접근성은 상대적으로 높게 보되, 차입금 규모가 크면 금액 효과는 그대로 크게 나타납니다.",
  },
};

const industryMeta: Record<IndustryKey, { label: string; smeRevenueThreshold: number }> = {
  manufacturing: { label: "제조업", smeRevenueThreshold: 1500 },
  wholesale: { label: "도소매업", smeRevenueThreshold: 1000 },
  construction: { label: "건설업", smeRevenueThreshold: 1000 },
  it: { label: "정보통신업", smeRevenueThreshold: 800 },
  real_estate: { label: "부동산업", smeRevenueThreshold: 400 },
  other: { label: "기타", smeRevenueThreshold: 600 },
};

const demoInput: MicroStressInput = {
  annualRevenue: 120,
  ebitdaMargin: 15,
  annualRentalIncomeCurrent: 3,
  currentVacancyRate: 5,
  cashBuffer: 8,
  totalDebt: 60,
  floatingDebt: 20,
  refinancingDebtWithinYear: 12,
  averageBorrowingRate: 4.8,
  currentRating: "A",
  currentRatio: 1.35,
  debtToEquityRatio: 120,
  interestCoverageRatio: 4.5,
  receivablesDays: 45,
  inventoryDays: 35,
  eventLiquidityNeed: 5,
};

const demoCompany: CompanyClassificationInput = {
  selectedSize: "middle",
  industry: "manufacturing",
  averageRevenue3y: 120,
  totalAssets: 850,
  isDisclosureGroup: false,
  isCrossShareholdingGroup: false,
  hasLargeCompanyOwner30: false,
  isPublicInstitution: false,
};

type RiskTone = MicroRiskLevel | "severe";

const riskStyles: Record<
  RiskTone,
  { label: string; badge: string; border: string; text: string; panel: string }
> = {
  safe: {
    label: "Safe",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800/60",
    text: "text-emerald-700 dark:text-emerald-300",
    panel: "bg-emerald-50/80 dark:bg-emerald-900/10",
  },
  watch: {
    label: "Watch",
    badge: "bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200",
    border: "border-gold-300/70 dark:border-gold-700/50",
    text: "text-gold-700 dark:text-gold-300",
    panel: "bg-gold-50/80 dark:bg-gold-900/10",
  },
  danger: {
    label: "Danger",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    border: "border-red-200 dark:border-red-800/60",
    text: "text-red-600 dark:text-red-300",
    panel: "bg-red-50/80 dark:bg-red-900/10",
  },
  severe: {
    label: "Severe Danger",
    badge: "bg-rose-700 text-white dark:bg-rose-800 dark:text-rose-50",
    border: "border-rose-400 dark:border-rose-700/80",
    text: "text-rose-700 dark:text-rose-300",
    panel: "bg-rose-50/90 dark:bg-rose-950/20",
  },
};

const scenarioEntries = Object.entries(microStressScenarios) as Array<
  [
    keyof typeof microStressScenarios,
    MicroStressScenario & { name: string; message: string },
  ]
>;

const sliderPercentKeys = new Set<keyof MicroStressScenario>(["revenueShock"]);

const formatEok = (value: number) => {
  const abs = Math.abs(value);
  const formatted = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${value < 0 ? "-" : ""}${formatted}억`;
};

const formatPercent = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;

const formatPp = (value: number, digits = 1) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}%p`;

const formatBp = (value: number) => `+${Math.round(value)}bp`;

const levelToneMap: Record<RiskLevel, RiskTone> = {
  Safe: "safe",
  Watch: "watch",
  Danger: "danger",
  "Severe Danger": "severe",
};

const scoreBadgeMap: Record<RiskScore, { tone: RiskTone; label: string }> = {
  1: { tone: "safe", label: "1점 Safe" },
  3: { tone: "watch", label: "3점 Watch" },
  5: { tone: "danger", label: "5점 Danger" },
};

const metricHelpMap: Record<string, string> = {
  liquidityGap:
    "앞으로 1년 동안 예상되는 현금유출을 현재 현금으로 감당하고도 부족한 금액입니다.",
  runway: "현재 현금으로 몇 개월 버틸 수 있는지 보여줍니다.",
  interestCoverage: "영업으로 번 돈으로 이자를 몇 배 감당할 수 있는지 보여줍니다.",
  currentRatio:
    "1년 안에 현금화할 수 있는 자산으로 1년 안에 갚을 부채를 감당할 수 있는지 봅니다.",
  debtToEquity: "자기자본 대비 부채가 얼마나 많은지 보여줍니다.",
  debtDependency: "자산을 얼마나 차입금으로 조달하고 있는지 보여줍니다.",
  fundingRateShock:
    "금리와 스프레드가 올라 법인의 차입금리가 얼마나 높아졌는지 보여줍니다.",
  ratingDowngrade: "법인의 신용도 악화가 차입 여건에 미치는 영향을 봅니다.",
  fundingSpread:
    "시장 전체가 기업에게 요구하는 위험 프리미엄이 얼마나 커졌는지 봅니다.",
  shortTermDebtConcentration:
    "1년 안에 갚거나 갈아타야 하는 차입금이 얼마나 몰려 있는지 봅니다.",
  workingCapitalBurden:
    "매출채권 회수 지연이나 재고 증가로 현금이 묶이는 금액입니다.",
  additionalInterestCost:
    "변동금리 차입금에 조달금리 상승폭이 반영되면서 늘어나는 연간 추가 이자비용입니다.",
  refinancingBurden:
    "12개월 안에 만기가 돌아오는 차입금을 다시 조달할 때 추가로 부담할 수 있는 비용입니다.",
  operatingCashflowLoss:
    "매출 감소와 수익성 악화로 줄어드는 영업 현금창출력을 뜻합니다.",
  rentalIncomeLoss:
    "공실률 상승으로 줄어드는 임대수입 금액입니다.",
  finalRisk:
    "한국 기준 중심 PB 상담용 조기경보 룰로 계산한 최종 위험등급입니다.",
};

function inferPortfolioProfile(portfolio?: Portfolio): PortfolioProfileKey {
  const text = `${portfolio?.id ?? ""} ${portfolio?.label ?? ""}`.toLowerCase();
  if (text.includes("stable") || text.includes("안정")) return "stable";
  if (text.includes("growth") || text.includes("수익") || text.includes("성장")) return "growth";
  if ((portfolio?.expectedRisk ?? 0) <= 4) return "stable";
  if ((portfolio?.expectedRisk ?? 0) >= 8) return "growth";
  return "balanced";
}

function buildMacroLinkedScenario(macroShock?: ScenarioShock): MicroStressScenario {
  if (!macroShock) {
    return (
      microStressPresetScenarios.find((preset) => preset.id === "macro_linked")?.scenario ??
      microStressScenarios.base
    );
  }

  const fed = Math.max(0, macroShock.d_fed);
  const ust = Math.max(0, macroShock.d_ust);
  const inflation = Math.max(0, macroShock.infl);
  const krw = Math.max(0, macroShock.ret_krw);
  const commodity = Math.max(0, macroShock.ret_cmd);
  const spreadShock = Math.min(500, fed * 55 + ust * 70 + inflation * 20);

  return {
    revenueShock: -Math.min(0.35, krw * 0.001 + commodity * 0.0008 + inflation * 0.01),
    marginShockPp: -Math.min(7, inflation * 0.8 + krw * 0.04 + commodity * 0.04),
    vacancyShockPp: Math.min(15, ust * 2 + fed),
    fundingSpreadShockBp: spreadShock,
    ratingDowngradeNotches: spreadShock >= 260 ? 2 : spreadShock >= 140 ? 1 : 0,
    receivablesDelayDays: Math.min(60, (fed + ust) * 5 + krw * 0.35),
    inventoryDelayDays: Math.min(45, commodity * 0.45 + inflation * 3),
    shortTermDebtConcentrationPct: Math.min(80, 35 + fed * 12 + ust * 8),
  };
}

function valueForSlider(scenario: MicroStressScenario, key: keyof MicroStressScenario) {
  const value = scenario[key];
  return sliderPercentKeys.has(key) ? value * 100 : value;
}

function valueFromSlider(key: keyof MicroStressScenario, value: number) {
  return sliderPercentKeys.has(key) ? value / 100 : value;
}

function sliderValueLabel(key: keyof MicroStressScenario, value: number) {
  if (key === "revenueShock") return formatPercent(value, 0);
  if (key === "marginShockPp" || key === "vacancyShockPp") return formatPp(value, 1);
  if (key === "fundingSpreadShockBp") return formatBp(value);
  if (key === "ratingDowngradeNotches") return `${value.toFixed(0)} notch`;
  if (key === "shortTermDebtConcentrationPct") return `${value.toFixed(0)}%`;
  return `${value.toFixed(0)}일`;
}

function classifyCompany(input: CompanyClassificationInput): CompanySize {
  if (input.isDisclosureGroup || input.isCrossShareholdingGroup) return "large";
  if (input.isPublicInstitution || input.hasLargeCompanyOwner30) return "large";

  const threshold = industryMeta[input.industry].smeRevenueThreshold;
  const qualifiesAsSme =
    input.averageRevenue3y <= threshold &&
    input.totalAssets < 5000 &&
    !input.isDisclosureGroup &&
    !input.hasLargeCompanyOwner30;

  if (qualifiesAsSme) return "sme";
  return "middle";
}

function classificationReason(input: CompanyClassificationInput, inferred: CompanySize) {
  if (input.isDisclosureGroup || input.isCrossShareholdingGroup) {
    return "공시대상기업집단 또는 상호출자제한기업집단 소속으로 입력되어 대기업/대규모기업집단으로 간이 판정했습니다.";
  }
  if (input.isPublicInstitution) return "공공기관·지방공기업 여부가 예로 입력되어 중견기업 간이 판정에서 제외했습니다.";
  if (input.hasLargeCompanyOwner30) {
    return "자산총액 5,000억 원 이상 법인의 30% 이상 지분 보유 및 최다출자 가능성이 있어 독립성 기준 미충족으로 봤습니다.";
  }
  if (inferred === "sme") {
    return `${industryMeta[input.industry].label} 3년 평균 매출액과 자산총액 5,000억 원 미만 조건을 함께 충족하는 것으로 간이 판정했습니다.`;
  }
  return "중소기업 매출·자산·독립성 조건을 충족하지 않으나 대규모기업집단 입력은 없어 중견기업으로 간이 판정했습니다.";
}

export default function BusinessCreditStressTest({
  portfolios = [],
  macroShock,
  macroPresetId,
}: Props) {
  const inferredPortfolioKey = inferPortfolioProfile(portfolios[0]);
  const [selectedPortfolioKey, setSelectedPortfolioKey] =
    useState<PortfolioProfileKey>(inferredPortfolioKey);
  const [input, setInput] = useState<MicroStressInput>(demoInput);
  const [companyInput, setCompanyInput] =
    useState<CompanyClassificationInput>(demoCompany);
  const [presetId, setPresetId] = useState<MicroStressPresetId>("spread_rise");
  const [scenario, setScenario] = useState<MicroStressScenario>(
    microStressPresetScenarios.find((preset) => preset.id === "spread_rise")?.scenario ??
      microStressScenarios.base,
  );

  // 향후 기존 포트폴리오 추천 화면의 선택 상태가 전역/스토어로 노출되면 이 내부 드롭다운 대신 직접 연결 가능.
  useEffect(() => {
    setSelectedPortfolioKey(inferredPortfolioKey);
  }, [inferredPortfolioKey]);

  useEffect(() => {
    if (presetId === "macro_linked") {
      setScenario(buildMacroLinkedScenario(macroShock));
    }
  }, [macroShock, presetId]);

  const selectedPortfolio = portfolioProfiles[selectedPortfolioKey];
  const selectedCompany = companyProfiles[companyInput.selectedSize];
  const inferredCompanySize = classifyCompany(companyInput);
  const inferredCompany = companyProfiles[inferredCompanySize];
  const classificationMismatch = inferredCompanySize !== companyInput.selectedSize;
  const presetName =
    presetId === "custom"
      ? "사용자 설정"
      : microStressPresetScenarios.find((preset) => preset.id === presetId)?.name ?? "사용자 설정";

  const result = useMemo(
    () =>
      calculateMicroStress(input, scenario, {
        portfolioSensitivity: selectedPortfolio.sensitivity,
        fundingSensitivity: selectedCompany.fundingSensitivity,
        companySize: companyInput.selectedSize,
      }),
    [companyInput.selectedSize, input, scenario, selectedCompany.fundingSensitivity, selectedPortfolio.sensitivity],
  );

  const koreaRisk = useMemo(
    () =>
      classifyKoreaBusinessCreditRisk({
        cashBuffer: input.cashBuffer,
        liquidityGap: result.liquidityGap,
        stressUseOfCash: result.stressUseOfCash,
        survivalMonths: result.survivalMonths,
        interestCoverage: result.stressedInterestCoverage,
        stressedEbitda: result.stressedEbitda,
        currentRatio: result.stressedCurrentRatio,
        debtToEquityRatio: input.debtToEquityRatio,
        totalDebt: input.totalDebt,
        totalAssets: companyInput.totalAssets,
        industry: companyInput.industry,
        fundingRateShockPct: result.fundingRateShockPct,
        ratingDowngradeNotches: scenario.ratingDowngradeNotches,
        fundingSpreadShockBp: scenario.fundingSpreadShockBp,
        shortTermDebtConcentrationPct: scenario.shortTermDebtConcentrationPct,
        workingCapitalBurdenIncrease: result.workingCapitalBurdenIncrease,
        refinancingBurdenIncrease: result.refinancingBurdenIncrease,
        additionalInterestCost: result.additionalInterestCost,
        operatingCashflowLoss: result.operatingCashflowLoss,
        portfolioLabel: selectedPortfolio.label,
        companySizeLabel: selectedCompany.label,
        presetName,
      }),
    [companyInput.industry, companyInput.totalAssets, input, presetName, result, scenario, selectedCompany.label, selectedPortfolio.label],
  );

  const comparisonResults = useMemo(
    () =>
      scenarioEntries.map(([key, item]) => {
        const scenarioResult = calculateMicroStress(input, item, {
          portfolioSensitivity: selectedPortfolio.sensitivity,
          fundingSensitivity: selectedCompany.fundingSensitivity,
          companySize: companyInput.selectedSize,
        });

        return {
          key,
          scenario: item,
          result: scenarioResult,
          risk: classifyKoreaBusinessCreditRisk({
            cashBuffer: input.cashBuffer,
            liquidityGap: scenarioResult.liquidityGap,
            stressUseOfCash: scenarioResult.stressUseOfCash,
            survivalMonths: scenarioResult.survivalMonths,
            interestCoverage: scenarioResult.stressedInterestCoverage,
            stressedEbitda: scenarioResult.stressedEbitda,
            currentRatio: scenarioResult.stressedCurrentRatio,
            debtToEquityRatio: input.debtToEquityRatio,
            totalDebt: input.totalDebt,
            totalAssets: companyInput.totalAssets,
            industry: companyInput.industry,
            fundingRateShockPct: scenarioResult.fundingRateShockPct,
            ratingDowngradeNotches: item.ratingDowngradeNotches,
            fundingSpreadShockBp: item.fundingSpreadShockBp,
            shortTermDebtConcentrationPct: item.shortTermDebtConcentrationPct,
            workingCapitalBurdenIncrease: scenarioResult.workingCapitalBurdenIncrease,
            refinancingBurdenIncrease: scenarioResult.refinancingBurdenIncrease,
            additionalInterestCost: scenarioResult.additionalInterestCost,
            operatingCashflowLoss: scenarioResult.operatingCashflowLoss,
            portfolioLabel: selectedPortfolio.label,
            companySizeLabel: selectedCompany.label,
            presetName: item.name,
          }),
        };
      }),
    [companyInput.industry, companyInput.selectedSize, companyInput.totalAssets, input, selectedCompany.fundingSensitivity, selectedCompany.label, selectedPortfolio.label, selectedPortfolio.sensitivity],
  );

  const risk = riskStyles[levelToneMap[koreaRisk.level]];
  const creditRisk = riskStyles[result.creditWarningLevel];
  const pbMessage = koreaRisk.pbCommentary;

  const contributionItems = useMemo(() => {
    const rawItems = [
      { label: "매출 감소", value: result.revenueCashflowLoss },
      { label: "EBITDA margin 악화", value: result.marginCashflowLoss },
      { label: "임대수입 감소", value: result.rentalIncomeLoss },
      { label: "추가 이자비용", value: result.additionalInterestCost },
      { label: "차환 부담", value: result.refinancingBurdenIncrease },
      { label: "운전자본 부담", value: result.workingCapitalBurdenIncrease },
    ];
    const maxValue = Math.max(...rawItems.map((item) => item.value), 0.01);
    return rawItems.map((item) => ({
      ...item,
      width: Math.max(2, (item.value / maxValue) * 100),
    }));
  }, [result]);

  const defenseTarget = useMemo(() => {
    const monthlyStress = Math.max(result.liquidityStressAfterPortfolio / 12, 0.01);
    const gapBuffer = Math.max(0, result.liquidityGap);
    return {
      cashBuffer: input.cashBuffer + gapBuffer + monthlyStress * 3,
      shortBondBucket: Math.max(10, gapBuffer + monthlyStress * 6),
      floatingDebt: input.floatingDebt * 0.7,
      refinancingDebt: input.refinancingDebtWithinYear * 0.6,
      workingCapitalBurden: result.workingCapitalBurdenIncrease * 0.7,
    };
  }, [input.cashBuffer, input.floatingDebt, input.refinancingDebtWithinYear, result]);

  const defenseActions = [
    `현금버퍼를 ${formatEok(input.cashBuffer)}에서 ${formatEok(defenseTarget.cashBuffer)} 수준까지 확대합니다.`,
    `단기채·예금·MMF/RP 등 12개월 방어 버킷을 최소 ${formatEok(defenseTarget.shortBondBucket)}로 분리합니다.`,
    `변동금리 차입금은 ${formatEok(input.floatingDebt)} 중 약 30%의 고정금리 전환 또는 금리캡을 검토합니다.`,
    `12개월 내 차환 필요 차입금은 만기 분산으로 ${formatEok(input.refinancingDebtWithinYear)}에서 ${formatEok(defenseTarget.refinancingDebt)} 수준의 집중도로 낮춥니다.`,
    `매출채권 회수관리와 재고 회전 개선으로 운전자본 부담을 ${formatEok(result.workingCapitalBurdenIncrease)}에서 ${formatEok(defenseTarget.workingCapitalBurden)} 수준으로 낮추는 것을 목표로 합니다.`,
  ];
  const activeCriteria = koreaRisk.criteria.filter((criterion) => criterion.score > 1);

  const applyPreset = (id: MicroStressPresetId) => {
    setPresetId(id);
    if (id === "custom") return;
    if (id === "macro_linked") {
      setScenario(buildMacroLinkedScenario(macroShock));
      return;
    }
    const preset = microStressPresetScenarios.find((item) => item.id === id);
    if (preset) setScenario({ ...preset.scenario });
  };

  const updateScenario = (key: keyof MicroStressScenario, sliderValue: number) => {
    setPresetId("custom");
    setScenario((prev) => ({
      ...prev,
      [key]: valueFromSlider(key, sliderValue),
    }));
  };

  const updateInput = <K extends keyof MicroStressInput>(key: K, value: MicroStressInput[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  const updateCompany = <K extends keyof CompanyClassificationInput>(
    key: K,
    value: CompanyClassificationInput[K],
  ) => {
    setCompanyInput((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section
      className="card border-gold-300/70 p-4 dark:border-gold-700/50"
      data-testid="business-credit-stress-test"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">
            Business & Credit Stress Test
          </p>
          <h3 className="mt-1 text-base font-bold text-fg">
            법인오너·부동산 보유 VVIP 미시 스트레스
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-fg-muted">
            법인 신용도 악화와 회사채·여전채 스프레드 확대가 추가 이자비용, 차환 부담,
            운전자본 부담, 12개월 유동성 부족액으로 전이되는 경로를 점검합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
            Risk · {risk.label}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${creditRisk.badge}`}>
            Credit · {creditRisk.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <ControlSelect
          label="선택 포트폴리오"
          value={selectedPortfolioKey}
          onChange={(value) => setSelectedPortfolioKey(value as PortfolioProfileKey)}
          options={Object.values(portfolioProfiles).map((profile) => ({
            value: profile.key,
            label: `${profile.label} (${profile.labelEn})`,
          }))}
          badge={`민감도 계수 ${selectedPortfolio.sensitivity.toFixed(2)}x`}
          description={selectedPortfolio.description}
        />
        <ControlSelect
          label="법인 규모 선택"
          value={companyInput.selectedSize}
          onChange={(value) => updateCompany("selectedSize", value as CompanySize)}
          options={Object.values(companyProfiles).map((profile) => ({
            value: profile.key,
            label: profile.label,
          }))}
          badge={`조달 민감도 ${selectedCompany.fundingSensitivity.toFixed(2)}x`}
          description={selectedCompany.description}
        />
        <ControlSelect
          label="시나리오 프리셋"
          value={presetId}
          onChange={(value) => applyPreset(value as MicroStressPresetId)}
          options={[
            ...(presetId === "custom" ? [{ value: "custom", label: "사용자 설정" }] : []),
            ...microStressPresetScenarios.map((preset) => ({
              value: preset.id,
              label: preset.name,
            })),
          ]}
          badge={macroPresetId ? `매크로: ${macroPresetId}` : "매크로: none"}
          description={
            presetId === "macro_linked"
              ? "기존 매크로 스트레스의 금리·환율·물가·원자재 충격을 보수적으로 반영합니다."
              : "프리셋 선택 후 슬라이더를 조정하면 사용자 설정으로 전환됩니다."
          }
        />
      </div>

      <div className="mt-3 rounded-xl border border-border/70 bg-surface-2 p-4">
        <h4 className="text-sm font-semibold text-fg">요인별 슬라이더</h4>
        <div className="mt-3 grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
          {microStressSliderMeta.map((meta) => {
            const sliderValue = valueForSlider(scenario, meta.key);
            return (
              <div key={meta.key}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <label className="text-xs font-medium text-fg">{meta.label}</label>
                  <span className="text-sm font-semibold tabular-nums text-gold-700 dark:text-gold-300">
                    {sliderValueLabel(meta.key, sliderValue)}
                  </span>
                </div>
                <input
                  type="range"
                  min={meta.min}
                  max={meta.max}
                  step={meta.step}
                  value={sliderValue}
                  onChange={(event) => updateScenario(meta.key, Number(event.target.value))}
                  className="w-full accent-gold-500"
                />
                <p className="mt-1 text-[11px] leading-tight text-fg-muted">{meta.hint}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <div className={`rounded-xl border p-4 ${risk.border} ${risk.panel}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">결과 카드</h4>
              <p className="mt-1 text-[11px] text-fg-muted">
                {presetName} · {selectedPortfolio.label} · {selectedCompany.label}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
              최종 위험등급 {koreaRisk.level}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Metric
              label="영업현금흐름 감소액"
              help={metricHelpMap.operatingCashflowLoss}
              value={formatEok(result.operatingCashflowLoss)}
            />
            <Metric
              label="임대수입 감소액"
              help={metricHelpMap.rentalIncomeLoss}
              value={formatEok(result.rentalIncomeLoss)}
            />
            <Metric
              label="추가 이자비용"
              help={metricHelpMap.additionalInterestCost}
              value={formatEok(result.additionalInterestCost)}
            />
            <Metric
              label="차환 부담 증가액"
              help={metricHelpMap.refinancingBurden}
              value={formatEok(result.refinancingBurdenIncrease)}
            />
            <Metric
              label="운전자본 부담 증가액"
              help={metricHelpMap.workingCapitalBurden}
              value={formatEok(result.workingCapitalBurdenIncrease)}
            />
            <Metric
              label="12개월 유동성 부족액"
              help={metricHelpMap.liquidityGap}
              value={result.liquidityGap <= 0 ? "부족 없음" : formatEok(result.liquidityGap)}
              tone={
                koreaRisk.criteria.find((item) => item.key === "liquidityGap")?.score === 5
                  ? "danger"
                  : result.liquidityGap <= 0
                    ? "safe"
                    : "watch"
              }
            />
            <Metric
              label="유동성 Runway"
              help={metricHelpMap.runway}
              value={`${result.survivalMonths.toFixed(1)}개월`}
              tone={
                koreaRisk.criteria.find((item) => item.key === "runway")?.score === 5
                  ? "danger"
                  : result.survivalMonths >= 12
                    ? "safe"
                    : "watch"
              }
            />
            <Metric
              label="이자보상배율"
              help={metricHelpMap.interestCoverage}
              value={`${result.stressedInterestCoverage.toFixed(1)}배`}
              tone={
                koreaRisk.criteria.find((item) => item.key === "interestCoverage")?.score === 5
                  ? "danger"
                  : result.stressedInterestCoverage >= 3
                    ? "safe"
                    : "watch"
              }
            />
            <Metric
              label="추정 조달금리 상승폭"
              help={metricHelpMap.fundingRateShock}
              value={`${result.fundingRateShockPct.toFixed(2)}%p`}
            />
            <Metric label="신용위험 경고 등급" value={creditRisk.label} tone={result.creditWarningLevel} />
            <Metric
              label="최종 위험등급"
              help={metricHelpMap.finalRisk}
              value={koreaRisk.level}
              tone={levelToneMap[koreaRisk.level]}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">현재 등급 산출 근거</h4>
              <p className="mt-1 text-[11px] text-fg-muted">
                {selectedPortfolio.label} · {selectedCompany.label} · {presetName}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
              {koreaRisk.level}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniStat label="5점 Danger 항목" value={`${koreaRisk.dangerCount}개`} />
            <MiniStat label="3점 Watch 항목" value={`${koreaRisk.watchCount}개`} />
            <MiniStat label="Stress 유동비율" value={`${result.stressedCurrentRatio.toFixed(2)}배`} />
            <MiniStat label="Stress ICR" value={`${result.stressedInterestCoverage.toFixed(1)}배`} />
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-surface-2 p-3">
            <p className="text-[11px] font-medium text-fg-muted">주요 원인 Top 3</p>
            <div className="mt-2 space-y-2">
              {koreaRisk.topDrivers.length > 0 ? (
                koreaRisk.topDrivers.map((driver) => {
                  const scoreMeta = scoreBadgeMap[driver.score];
                  return (
                    <div
                      key={driver.key}
                      className="rounded-lg border border-border/70 bg-surface px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-fg">{driver.label}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">
                            {driver.reason}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-semibold tabular-nums text-fg">
                            {driver.valueLabel}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskStyles[scoreMeta.tone].badge}`}
                          >
                            {scoreMeta.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-fg-muted">
                  현재는 3점 또는 5점 구간에 들어간 핵심 경보 항목이 없습니다.
                </p>
              )}
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-fg">{pbMessage}</p>
          {koreaRisk.severeTriggers.length > 0 && (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-xs leading-relaxed text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/20 dark:text-rose-200">
              <p className="font-semibold">Severe Danger 트리거</p>
              <ul className="mt-1 space-y-1">
                {koreaRisk.severeTriggers.map((trigger) => (
                  <li key={trigger}>{trigger}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {activeCriteria.map((criterion) => {
              const scoreMeta = scoreBadgeMap[criterion.score];
              return (
                <span
                  key={criterion.key}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${riskStyles[scoreMeta.tone].badge}`}
                  title={criterion.clientExplanation}
                >
                  {criterion.label} · {criterion.valueLabel}
                </span>
              );
            })}
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-surface-2 p-3">
            <p className="text-[11px] font-medium text-fg-muted">등급 판정 요약</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-muted">{koreaRisk.explanation}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-xl border border-border/70 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">리스크 요인별 유동성 부족 기여도</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                각 요인이 12개월 현금소요를 얼마나 키우는지 보여줍니다. 금액은 포트폴리오 민감도 적용 전 원인별 부담입니다.
              </p>
            </div>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
              VaR/CVaR 대신 현금흐름 기준
            </span>
          </div>
          <div className="space-y-3">
            {contributionItems.map((item) => (
              <FactorBar key={item.label} label={item.label} value={item.value} width={item.width} />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gold-300/60 p-4 dark:border-gold-700/40">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">유동성 방어 조정안</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                매크로 스트레스의 리밸런싱 제안을 법인오너 현금흐름 방어 조치로 변형했습니다.
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
              {risk.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="현금버퍼 목표" value={formatEok(defenseTarget.cashBuffer)} />
            <MiniStat label="단기 방어 버킷" value={formatEok(defenseTarget.shortBondBucket)} />
            <MiniStat label="변동금리 축소 후" value={formatEok(defenseTarget.floatingDebt)} />
            <MiniStat label="차환 집중도 완화 후" value={formatEok(defenseTarget.refinancingDebt)} />
          </div>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-fg-muted">
            {defenseActions.map((action) => (
              <li key={action} className="rounded-lg border border-border/70 bg-surface-2 px-3 py-2">
                {action}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
        <details className="rounded-xl border border-border/70 bg-surface p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            데모 입력값 직접 수정
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <NumberInput label="연매출" unit="억원" value={input.annualRevenue} onChange={(value) => updateInput("annualRevenue", value)} />
            <NumberInput label="EBITDA margin" unit="%" value={input.ebitdaMargin} step={0.1} onChange={(value) => updateInput("ebitdaMargin", value)} />
            <NumberInput label="연 임대수입" unit="억원" value={input.annualRentalIncomeCurrent} step={0.1} onChange={(value) => updateInput("annualRentalIncomeCurrent", value)} />
            <NumberInput label="현재 공실률" unit="%" value={input.currentVacancyRate} step={0.1} onChange={(value) => updateInput("currentVacancyRate", value)} />
            <NumberInput label="현금 버퍼" unit="억원" value={input.cashBuffer} step={0.1} onChange={(value) => updateInput("cashBuffer", value)} />
            <NumberInput label="총 차입금" unit="억원" value={input.totalDebt} onChange={(value) => updateInput("totalDebt", value)} />
            <NumberInput label="변동금리 차입금" unit="억원" value={input.floatingDebt} onChange={(value) => updateInput("floatingDebt", value)} />
            <NumberInput label="12개월 내 차환 필요 차입금" unit="억원" value={input.refinancingDebtWithinYear} onChange={(value) => updateInput("refinancingDebtWithinYear", value)} />
            <NumberInput label="평균 차입금리" unit="%" value={input.averageBorrowingRate} step={0.1} onChange={(value) => updateInput("averageBorrowingRate", value)} />
            <label className="block">
              <span className="text-[11px] font-medium text-fg-muted">현재 법인 신용등급</span>
              <select
                className="input mt-1 h-9 w-full"
                value={input.currentRating}
                onChange={(event) => updateInput("currentRating", normalizeCreditRating(event.target.value) as CreditRating)}
              >
                {CREDIT_RATINGS.map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}
                  </option>
                ))}
              </select>
            </label>
            <NumberInput label="유동비율" unit="배" value={input.currentRatio} step={0.01} onChange={(value) => updateInput("currentRatio", value)} />
            <NumberInput label="부채비율" unit="%" value={input.debtToEquityRatio} onChange={(value) => updateInput("debtToEquityRatio", value)} />
            <NumberInput label="이자보상배율" unit="배" value={input.interestCoverageRatio} step={0.1} onChange={(value) => updateInput("interestCoverageRatio", value)} />
            <NumberInput label="매출채권 회전일수" unit="일" value={input.receivablesDays} onChange={(value) => updateInput("receivablesDays", value)} />
            <NumberInput label="재고자산 회전일수" unit="일" value={input.inventoryDays} onChange={(value) => updateInput("inventoryDays", value)} />
          </div>
        </details>

        <details className="rounded-xl border border-border/70 bg-surface p-4" open>
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            법인 규모 분류
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-medium text-fg-muted">주된 업종</span>
              <select
                className="input mt-1 h-9 w-full"
                value={companyInput.industry}
                onChange={(event) => updateCompany("industry", event.target.value as IndustryKey)}
              >
                {Object.entries(industryMeta).map(([key, meta]) => (
                  <option key={key} value={key}>
                    {meta.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberInput label="최근 3년 평균 매출액" unit="억원" value={companyInput.averageRevenue3y} onChange={(value) => updateCompany("averageRevenue3y", value)} />
            <NumberInput label="자산총액" unit="억원" value={companyInput.totalAssets} onChange={(value) => updateCompany("totalAssets", value)} />
            <BooleanSelect label="공시대상기업집단 소속" value={companyInput.isDisclosureGroup} onChange={(value) => updateCompany("isDisclosureGroup", value)} />
            <BooleanSelect label="상호출자제한기업집단 소속" value={companyInput.isCrossShareholdingGroup} onChange={(value) => updateCompany("isCrossShareholdingGroup", value)} />
            <BooleanSelect label="대기업 30% 이상 최다출자" value={companyInput.hasLargeCompanyOwner30} onChange={(value) => updateCompany("hasLargeCompanyOwner30", value)} />
            <BooleanSelect label="공공기관·지방공기업" value={companyInput.isPublicInstitution} onChange={(value) => updateCompany("isPublicInstitution", value)} />
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-fg">간이 판정 결과</p>
              <span className="rounded-full bg-gold-100 px-2.5 py-1 text-xs font-semibold text-gold-800 dark:bg-gold-900/40 dark:text-gold-200">
                {inferredCompany.label}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              {classificationReason(companyInput, inferredCompanySize)}
            </p>
            {classificationMismatch && (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
                선택값과 간이 판정이 다릅니다. 현재 계산에는 사용자가 선택한 {selectedCompany.label}
                기준을 적용하고 있습니다.
              </p>
            )}
          </div>
        </details>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-xl border border-border/70 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-fg">현재 기준별 판정 상세</h4>
            <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
              1점 / 3점 / 5점 룰 기반
            </span>
          </div>
          <div className="space-y-2">
            {koreaRisk.criteria.map((criterion) => {
              const scoreMeta = scoreBadgeMap[criterion.score];
              return (
                <div
                  key={criterion.key}
                  className="rounded-lg border border-border/70 bg-surface-2 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-1 text-sm font-semibold text-fg">
                        {criterion.label}
                        <HelpHint text={criterion.clientExplanation} />
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                        {criterion.reason}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${riskStyles[scoreMeta.tone].badge}`}
                      >
                        {scoreMeta.label}
                      </span>
                      <p className="mt-1 text-xs font-semibold tabular-nums text-fg">
                        {criterion.valueLabel}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border/70 p-4">
          <h4 className="text-sm font-semibold text-fg">법인 규모 간이 판정 기준</h4>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-fg-muted">
            <p>
              중소기업은 업종별 3년 평균 매출액 기준, 자산총액 5,000억 원 미만, 공시대상기업집단 제외,
              독립성 기준을 함께 봅니다.
            </p>
            <p>
              중견기업은 중소기업이 아니면서 공공기관·지방공기업, 상호출자제한기업집단,
              독립성 기준 미충족 기업을 제외하는 방식으로 간이 판정합니다.
            </p>
            <p>
              대기업/대규모기업집단은 공시대상기업집단 또는 상호출자제한기업집단 소속 여부를
              우선 신호로 봅니다. 공시대상기업집단은 자산총액 5조 원 이상 기업집단,
              상호출자제한기업집단은 자산총액이 명목 GDP의 0.5% 이상인 기업집단 기준을 표시합니다.
            </p>
            <p className="rounded-lg border border-border/70 bg-surface-2 p-2 text-[11px]">
              본 분류는 PB 상담용 간이 판정입니다. 실제 법적 분류는 중소기업 확인서,
              중견기업 확인서, 공정거래위원회 기업집단 지정 현황 등 공식 확인이 필요합니다.
            </p>
          </div>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-border/70 bg-surface p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-fg">
          위험등급 산출 기준 보기
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          발표용 표에는 1점 Safe, 3점 Watch, 5점 Danger만 표시합니다. 2점과 4점은 쓰지 않고
          한국 기준 중심 PB 상담용 조기경보 룰로 단순화했습니다.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">지표</th>
                <th className="px-3 py-2 text-left">1점 Safe</th>
                <th className="px-3 py-2 text-left">3점 Watch</th>
                <th className="px-3 py-2 text-left">5점 Danger</th>
              </tr>
            </thead>
            <tbody>
              {KOREA_BUSINESS_CREDIT_CRITERIA.map((criterion) => (
                <tr key={criterion.key} className="border-b border-border/60 align-top">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1 text-sm font-semibold text-fg">
                      {criterion.label}
                      <HelpHint text={criterion.clientExplanation} />
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                      {criterion.clientExplanation}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs leading-relaxed text-fg">{criterion.safeText}</td>
                  <td className="px-3 py-3 text-xs leading-relaxed text-fg">{criterion.watchText}</td>
                  <td className="px-3 py-3 text-xs leading-relaxed text-fg">{criterion.dangerText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-border/70 bg-surface-2 p-3">
            <p className="text-xs font-semibold text-fg">종합 Safe / Watch / Danger 룰</p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              Safe는 5점 항목 0개, 3점 항목 1개 이하, 12개월 유동성 부족액 없음입니다.
              Watch는 5점 항목 없이 3점 항목 2개 이상이거나 부족액이 일부 발생한 경우입니다.
              Danger는 5점 항목 1개 이상이거나, 3점 항목이 3개 이상 누적되고 핵심 유동성 신호가
              동반될 때입니다.
            </p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/20 dark:text-rose-200">
            <p className="text-xs font-semibold">Severe Danger 룰</p>
            <p className="mt-1 text-[11px] leading-relaxed">
              유동성 Runway 3개월 미만, 이자보상배율 0배 미만 또는 영업손실,
              신용등급 3 notch 하락과 스프레드 300bp 이상 동시 발생 시 Severe Danger로 분류합니다.
            </p>
          </div>
        </div>
      </details>

      <div className="mt-3 rounded-xl border border-border/70 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg">PB 상담 활용 가이드</h4>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
            고객 상황별 설명 포인트
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">고객 상황</th>
                <th className="px-3 py-2 text-left">함께 볼 지표</th>
                <th className="px-3 py-2 text-left">PB 설명 포인트</th>
              </tr>
            </thead>
            <tbody>
              {KOREA_BUSINESS_CREDIT_GUIDE.map((row) => (
                <tr key={row.situation} className="border-b border-border/60 align-top">
                  <td className="px-3 py-3 text-sm font-semibold text-fg">{row.situation}</td>
                  <td className="px-3 py-3 text-xs leading-relaxed text-fg">{row.indicators}</td>
                  <td className="px-3 py-3 text-xs leading-relaxed text-fg">{row.guidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-border/70 bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-fg">출처 및 한계</summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-fg-muted">
          {KOREA_BUSINESS_CREDIT_SOURCES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </details>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg">Mild / Base / Severe 3단계 비교</h4>
          <span className="text-[11px] text-fg-muted">
            포트폴리오·법인 규모 민감도 동일 적용
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {comparisonResults.map(({ key, scenario: comparisonScenario, result: comparison, risk: comparisonRiskResult }) => {
            const comparisonRisk = riskStyles[levelToneMap[comparisonRiskResult.level]];
            return (
              <article key={key} className={`rounded-xl border bg-surface p-4 ${comparisonRisk.border}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-semibold text-fg">{comparisonScenario.name}</h5>
                    <p className="mt-0.5 text-[11px] text-fg-muted">{comparisonScenario.message} 시나리오</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${comparisonRisk.badge}`}>
                    {comparisonRiskResult.level}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-surface-2 p-2 text-[11px] text-fg-muted">
                  <span>{formatPercent(comparisonScenario.revenueShock * 100)} 매출</span>
                  <span>{formatBp(comparisonScenario.fundingSpreadShockBp)}</span>
                  <span>{comparisonScenario.ratingDowngradeNotches.toFixed(0)} notch</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="추가 이자비용" value={formatEok(comparison.additionalInterestCost)} compact />
                  <Metric label="차환 부담" value={formatEok(comparison.refinancingBurdenIncrease)} compact />
                  <Metric
                    label="최종 등급"
                    value={comparisonRiskResult.level}
                    compact
                    tone={levelToneMap[comparisonRiskResult.level]}
                  />
                  <Metric
                    label="Runway"
                    value={`${comparison.survivalMonths.toFixed(1)}개월`}
                    compact
                    tone={
                      comparisonRiskResult.level === "Severe Danger"
                        ? "severe"
                        : levelToneMap[comparisonRiskResult.level]
                    }
                  />
                  <div className="col-span-2 rounded-lg border border-border/70 p-3">
                    <p className="text-[11px] text-fg-muted">12개월 유동성 부족액</p>
                    <p className={`mt-1 text-xl font-bold tabular-nums ${comparisonRisk.text}`}>
                      {comparison.liquidityGap <= 0 ? "부족 없음" : formatEok(comparison.liquidityGap)}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
  badge,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  badge: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-surface-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-semibold text-fg">{label}</label>
        <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-fg-muted">
          {badge}
        </span>
      </div>
      <select className="input mt-2 h-9 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{description}</p>
    </div>
  );
}

function NumberInput({
  label,
  unit,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2">
        <input
          type="number"
          min={0}
          step={step}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums text-fg outline-none"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        />
        <span className="shrink-0 text-[11px] text-fg-muted">{unit}</span>
      </div>
    </label>
  );
}

function BooleanSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-fg-muted">{label}</span>
      <select
        className="input mt-1 h-9 w-full"
        value={value ? "yes" : "no"}
        onChange={(event) => onChange(event.target.value === "yes")}
      >
        <option value="no">아니오</option>
        <option value="yes">예</option>
      </select>
    </label>
  );
}

function Metric({
  label,
  help,
  value,
  compact = false,
  tone,
}: {
  label: string;
  help?: string;
  value: string;
  compact?: boolean;
  tone?: RiskTone;
}) {
  const toneClass = tone ? riskStyles[tone].text : "text-fg";
  return (
    <div className="rounded-lg border border-border/70 bg-surface p-3">
      <p className="flex items-center gap-1 text-[11px] text-fg-muted">
        <span>{label}</span>
        {help && <HelpHint text={help} />}
      </p>
      <p className={`mt-1 font-semibold tabular-nums ${compact ? "text-sm" : "text-base"} ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface p-2.5">
      <p className="text-[10px] text-fg-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-fg">{value}</p>
    </div>
  );
}

function FactorBar({
  label,
  value,
  width,
}: {
  label: string;
  value: number;
  width: number;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-fg">{label}</span>
        <span className="tabular-nums text-fg-muted">{formatEok(value)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-navy-700 dark:bg-gold-500"
          style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
        />
      </div>
    </div>
  );
}

function HelpHint({ text }: { text: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-semibold text-fg-muted"
      title={text}
      aria-label={text}
    >
      i
    </span>
  );
}
