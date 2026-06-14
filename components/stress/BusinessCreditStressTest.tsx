"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CREDIT_RATINGS,
  calculateMicroStress,
  normalizeCreditRating,
  type CreditRating,
  type MicroRiskLevel,
  type MicroStressInput,
  type MicroStressScenario,
} from "@/lib/stress/microStress";
import {
  microStressPresetScenarios,
  microStressScenarios,
  microStressSliderMeta,
  type MicroStressPresetId,
} from "@/lib/stress/microStressScenarios";
import type { Portfolio, ScenarioShock } from "@/lib/types";

type ScenarioKey = keyof typeof microStressScenarios;
type PortfolioProfileKey = "stable" | "balanced" | "growth";

type PortfolioStressProfile = {
  key: PortfolioProfileKey;
  label: string;
  badge: string;
  shockMultiplier: number;
  fundingMultiplier: number;
  cashBufferMultiplier: number;
  description: string;
};

type Props = {
  portfolios?: Portfolio[];
  macroShock?: ScenarioShock;
  macroPresetId?: string;
};

const demoInput: MicroStressInput = {
  annualRevenue: 120,
  ebitdaMargin: 15,
  operatingLeverage: 1.2,
  annualRentalIncomeCurrent: 3,
  currentVacancyRate: 5,
  totalDebt: 60,
  floatingDebt: 20,
  maturingDebtWithinYear: 12,
  averageFundingRate: 4.8,
  currentRating: "A",
  cashBuffer: 8,
  eventLiquidityNeed: 5,
  currentRatio: 1.35,
  debtToEquityRatio: 120,
  interestCoverageRatio: 4.5,
  receivablesDays: 45,
  inventoryDays: 35,
  forcedRefinancing: false,
};

const scenarioEntries = Object.entries(microStressScenarios) as Array<
  [
    ScenarioKey,
    MicroStressScenario & {
      name: string;
      message: string;
    },
  ]
>;

const portfolioProfiles: Record<PortfolioProfileKey, PortfolioStressProfile> = {
  stable: {
    key: "stable",
    label: "안정형 연계",
    badge: "Stable",
    shockMultiplier: 0.85,
    fundingMultiplier: 0.9,
    cashBufferMultiplier: 1.12,
    description:
      "안정형은 현금성·채권성 비중이 높다는 전제로 동일 충격의 유동성 압박을 낮게 반영합니다.",
  },
  balanced: {
    key: "balanced",
    label: "균형형 연계",
    badge: "Balanced",
    shockMultiplier: 1,
    fundingMultiplier: 1,
    cashBufferMultiplier: 1,
    description:
      "균형형은 포트폴리오 선택에 따른 추가 민감도 보정 없이 법인 펀더멘털 충격을 기준값으로 봅니다.",
  },
  growth: {
    key: "growth",
    label: "수익추구형 연계",
    badge: "Growth",
    shockMultiplier: 1.18,
    fundingMultiplier: 1.15,
    cashBufferMultiplier: 0.88,
    description:
      "수익추구형은 위험자산 현금화 할인과 차환 압박을 더 크게 보아 동일 충격의 민감도를 높입니다.",
  },
};

const riskStyles: Record<
  MicroRiskLevel,
  { label: string; badge: string; border: string; text: string; panel: string }
> = {
  safe: {
    label: "Safe",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800/60",
    text: "text-emerald-700 dark:text-emerald-300",
    panel: "bg-emerald-50/70 dark:bg-emerald-900/10",
  },
  watch: {
    label: "Watch",
    badge: "bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200",
    border: "border-gold-300/70 dark:border-gold-700/50",
    text: "text-gold-700 dark:text-gold-300",
    panel: "bg-gold-50/70 dark:bg-gold-900/10",
  },
  danger: {
    label: "Danger",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    border: "border-red-200 dark:border-red-800/60",
    text: "text-red-600 dark:text-red-300",
    panel: "bg-red-50/70 dark:bg-red-900/10",
  },
};

const sliderPercentKeys = new Set<keyof MicroStressScenario>([
  "revenueShock",
  "rentShock",
]);

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

function riskCopy(level: MicroRiskLevel) {
  if (level === "safe") return "현금 버퍼와 이자보상력이 12개월 충격을 흡수하는 구간입니다.";
  if (level === "watch") return "영업현금흐름과 차환 조건을 점검하며 유동성 버킷 보강이 필요합니다.";
  return "단기 현금화, 차입 만기 재조정, 위험자산 방어 조정이 필요한 구간입니다.";
}

function inferPortfolioProfile(portfolio?: Portfolio): PortfolioProfileKey {
  const text = `${portfolio?.id ?? ""} ${portfolio?.label ?? ""}`.toLowerCase();
  if (text.includes("stable") || text.includes("안정")) return "stable";
  if (text.includes("growth") || text.includes("수익") || text.includes("성장")) {
    return "growth";
  }
  if ((portfolio?.expectedRisk ?? 0) <= 4) return "stable";
  if ((portfolio?.expectedRisk ?? 0) >= 8) return "growth";
  return "balanced";
}

function valueForSlider(scenario: MicroStressScenario, key: keyof MicroStressScenario) {
  const value = scenario[key];
  return sliderPercentKeys.has(key) ? value * 100 : value;
}

function valueFromSlider(key: keyof MicroStressScenario, value: number) {
  return sliderPercentKeys.has(key) ? value / 100 : value;
}

function sliderValueLabel(key: keyof MicroStressScenario, value: number) {
  if (key === "revenueShock" || key === "rentShock") return formatPercent(value, 0);
  if (key === "marginShockPp" || key === "vacancyShockPp") return formatPp(value, 1);
  if (key === "fundingSpreadShockBp") return formatBp(value);
  if (key === "ratingDowngradeNotches") return `${value.toFixed(0)} notch`;
  if (key === "workingCapitalShockPct") return `${value.toFixed(1)}%`;
  return `${value.toFixed(0)}일`;
}

function buildMacroOverlay(macroShock?: ScenarioShock): MicroStressScenario {
  const fed = Math.max(0, macroShock?.d_fed ?? 0);
  const ust = Math.max(0, macroShock?.d_ust ?? 0);
  const inflation = Math.max(0, macroShock?.infl ?? 0);
  const krw = Math.max(0, macroShock?.ret_krw ?? 0);
  const commodity = Math.max(0, macroShock?.ret_cmd ?? 0);
  const ratePressure = fed + ust;

  return {
    revenueShock: -(krw * 0.001 + commodity * 0.0005),
    marginShockPp: -(inflation * 0.35 + krw * 0.03 + commodity * 0.03),
    vacancyShockPp: ust * 1.5,
    rentShock: 0,
    fundingSpreadShockBp: fed * 40 + ust * 55,
    ratingDowngradeNotches: ratePressure >= 2 ? 1 : ratePressure >= 1.2 ? 0.5 : 0,
    workingCapitalShockPct: krw * 0.04 + commodity * 0.025,
    collectionDelayDays: ratePressure * 2,
  };
}

function hasOverlay(overlay: MicroStressScenario) {
  return Object.values(overlay).some((value) => Math.abs(value) > 0.001);
}

function applyScenarioAdjustments(
  scenario: MicroStressScenario,
  profile: PortfolioStressProfile,
  macroOverlay: MicroStressScenario,
  macroLinked: boolean,
): MicroStressScenario {
  const overlay = macroLinked ? macroOverlay : null;
  return {
    revenueShock: scenario.revenueShock * profile.shockMultiplier + (overlay?.revenueShock ?? 0),
    marginShockPp: scenario.marginShockPp * profile.shockMultiplier + (overlay?.marginShockPp ?? 0),
    vacancyShockPp:
      scenario.vacancyShockPp * profile.shockMultiplier + (overlay?.vacancyShockPp ?? 0),
    rentShock: scenario.rentShock * profile.shockMultiplier + (overlay?.rentShock ?? 0),
    fundingSpreadShockBp:
      scenario.fundingSpreadShockBp * profile.fundingMultiplier +
      (overlay?.fundingSpreadShockBp ?? 0),
    ratingDowngradeNotches: Math.min(
      4,
      Math.max(
        0,
        scenario.ratingDowngradeNotches * profile.shockMultiplier +
          (overlay?.ratingDowngradeNotches ?? 0),
      ),
    ),
    workingCapitalShockPct:
      scenario.workingCapitalShockPct * profile.shockMultiplier +
      (overlay?.workingCapitalShockPct ?? 0),
    collectionDelayDays:
      scenario.collectionDelayDays * profile.shockMultiplier +
      (overlay?.collectionDelayDays ?? 0),
  };
}

function inputWithPortfolioBuffer(input: MicroStressInput, profile: PortfolioStressProfile) {
  return {
    ...input,
    cashBuffer: input.cashBuffer * profile.cashBufferMultiplier,
  };
}

export default function BusinessCreditStressTest({
  portfolios = [],
  macroShock,
  macroPresetId,
}: Props) {
  const [input, setInput] = useState<MicroStressInput>(demoInput);
  const [presetId, setPresetId] = useState<MicroStressPresetId>("base");
  const [scenario, setScenario] = useState<MicroStressScenario>(microStressScenarios.base);
  const [macroLinked, setMacroLinked] = useState(true);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(
    portfolios[0]?.id ?? "demo",
  );

  useEffect(() => {
    if (portfolios.length === 0) {
      setSelectedPortfolioId("demo");
      return;
    }
    if (!portfolios.some((portfolio) => portfolio.id === selectedPortfolioId)) {
      setSelectedPortfolioId(portfolios[0].id);
    }
  }, [portfolios, selectedPortfolioId]);

  const activePortfolio =
    portfolios.find((portfolio) => portfolio.id === selectedPortfolioId) ?? portfolios[0];
  const portfolioProfile = portfolioProfiles[inferPortfolioProfile(activePortfolio)];
  const macroOverlay = useMemo(() => buildMacroOverlay(macroShock), [macroShock]);
  const macroIsActive = hasOverlay(macroOverlay);
  const adjustedInput = useMemo(
    () => inputWithPortfolioBuffer(input, portfolioProfile),
    [input, portfolioProfile],
  );
  const adjustedScenario = useMemo(
    () => applyScenarioAdjustments(scenario, portfolioProfile, macroOverlay, macroLinked),
    [macroLinked, macroOverlay, portfolioProfile, scenario],
  );
  const currentResult = useMemo(
    () => calculateMicroStress(adjustedInput, adjustedScenario),
    [adjustedInput, adjustedScenario],
  );
  const comparisonResults = useMemo(
    () =>
      scenarioEntries.map(([key, entry]) => {
        const adjusted = applyScenarioAdjustments(
          entry,
          portfolioProfile,
          macroOverlay,
          macroLinked,
        );
        return {
          key,
          scenario: entry,
          adjustedScenario: adjusted,
          result: calculateMicroStress(adjustedInput, adjusted),
        };
      }),
    [adjustedInput, macroLinked, macroOverlay, portfolioProfile],
  );

  const currentRisk = riskStyles[currentResult.riskLevel];
  const selectedPresetName =
    presetId === "custom"
      ? "사용자 설정"
      : microStressPresetScenarios.find((preset) => preset.id === presetId)?.name ?? "사용자 설정";
  const baseComparison =
    comparisonResults.find((item) => item.key === "base") ?? comparisonResults[1];

  const pbMessage =
    currentResult.liquidityGap <= 0
      ? `${portfolioProfile.badge} 포트폴리오 연계 기준 ${selectedPresetName}에서도 12개월 유동성 부족은 발생하지 않지만, 신용등급 하락 시 추가 차입비용 ${formatEok(
          currentResult.ratingDowngradeInterestCost,
        )}과 이자보상배율 ${currentResult.stressedInterestCoverage.toFixed(1)}배를 고객에게 함께 설명해야 합니다.`
      : `${portfolioProfile.badge} 포트폴리오 연계 기준 ${selectedPresetName}에서는 12개월 유동성 부족액이 ${formatEok(
          currentResult.liquidityGap,
        )}로 추정되므로, 세금·상환 이벤트 전에 현금성 버킷과 차입 만기 재조정을 먼저 확보해야 합니다.`;

  const applyPreset = (id: MicroStressPresetId) => {
    setPresetId(id);
    if (id === "custom") return;
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

  const updateInput = <K extends keyof MicroStressInput>(
    key: K,
    value: MicroStressInput[K],
  ) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section className="card border-gold-300/70 p-4 dark:border-gold-700/50">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-300">
            Business & Credit Stress Test
          </p>
          <h3 className="mt-1 text-base font-bold text-fg">
            법인오너·부동산 보유 VVIP 미시 스트레스
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-fg-muted">
            법인 매출 감소, 공실률 상승, 회사채·여전채 스프레드 확대, 신용등급 하락,
            운전자본 악화가 12개월 유동성 방어력에 미치는 영향을 포트폴리오 선택과 함께
            연결합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentRisk.badge}`}>
            Current Risk · {currentRisk.label}
          </span>
          <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-muted">
            {portfolioProfile.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-border/70 bg-surface-2 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">시나리오 프리셋·요인 강도</h4>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                프리셋을 고른 뒤 슬라이더를 조정하면 사용자 설정으로 즉시 전환됩니다.
              </p>
            </div>
            <select
              className="input h-9 min-w-[210px]"
              value={presetId}
              onChange={(event) => applyPreset(event.target.value as MicroStressPresetId)}
            >
              {presetId === "custom" && <option value="custom">사용자 설정</option>}
              {microStressPresetScenarios.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
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

        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-fg">포트폴리오 연계</h4>
              {portfolios.length > 1 && (
                <select
                  className="input h-8 w-auto text-xs"
                  value={selectedPortfolioId}
                  onChange={(event) => setSelectedPortfolioId(event.target.value)}
                >
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-fg-muted">
              {activePortfolio?.label ?? "확정 포트폴리오 없음"} · {portfolioProfile.description}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <MiniStat
                label="충격 강도"
                value={`${Math.round(portfolioProfile.shockMultiplier * 100)}%`}
              />
              <MiniStat
                label="스프레드 민감도"
                value={`${Math.round(portfolioProfile.fundingMultiplier * 100)}%`}
              />
              <MiniStat
                label="현금버퍼 보정"
                value={`${Math.round(portfolioProfile.cashBufferMultiplier * 100)}%`}
              />
            </div>
          </div>

          <div className="rounded-xl border border-border/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-fg">매크로 스트레스 연동</h4>
                <p className="mt-1 text-[11px] text-fg-muted">
                  금리·물가·환율·원자재 충격을 차입 스프레드와 마진 압박으로 전이합니다.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-gold-500"
                  checked={macroLinked}
                  onChange={(event) => setMacroLinked(event.target.checked)}
                />
                연동
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full bg-surface-2 px-2 py-1 text-fg-muted">
                매크로 프리셋 {macroPresetId ?? "none"}
              </span>
              {macroIsActive ? (
                <>
                  <span className="rounded-full bg-surface-2 px-2 py-1 text-fg-muted">
                    스프레드 {formatBp(macroOverlay.fundingSpreadShockBp)}
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 py-1 text-fg-muted">
                    마진 {formatPp(macroOverlay.marginShockPp, 1)}
                  </span>
                  <span className="rounded-full bg-surface-2 px-2 py-1 text-fg-muted">
                    운전자본 +{macroOverlay.workingCapitalShockPct.toFixed(1)}%
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-surface-2 px-2 py-1 text-fg-muted">
                  현재 매크로 충격 없음
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <details className="mt-3 rounded-xl border border-border/70 bg-surface p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-fg">
          법인 입력값 직접 수정
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <NumberInput
            label="연매출"
            unit="억원"
            value={input.annualRevenue}
            onChange={(value) => updateInput("annualRevenue", value)}
          />
          <NumberInput
            label="EBITDA margin"
            unit="%"
            value={input.ebitdaMargin}
            step={0.1}
            onChange={(value) => updateInput("ebitdaMargin", value)}
          />
          <NumberInput
            label="영업 레버리지"
            unit="배"
            value={input.operatingLeverage}
            step={0.1}
            onChange={(value) => updateInput("operatingLeverage", value)}
          />
          <NumberInput
            label="연 임대수입"
            unit="억원"
            value={input.annualRentalIncomeCurrent}
            step={0.1}
            onChange={(value) => updateInput("annualRentalIncomeCurrent", value)}
          />
          <NumberInput
            label="현재 공실률"
            unit="%"
            value={input.currentVacancyRate}
            step={0.1}
            onChange={(value) => updateInput("currentVacancyRate", value)}
          />
          <NumberInput
            label="총 차입금"
            unit="억원"
            value={input.totalDebt}
            onChange={(value) => updateInput("totalDebt", value)}
          />
          <NumberInput
            label="변동/차환 차입금"
            unit="억원"
            value={input.floatingDebt}
            onChange={(value) => updateInput("floatingDebt", value)}
          />
          <NumberInput
            label="12개월 만기도래"
            unit="억원"
            value={input.maturingDebtWithinYear}
            onChange={(value) => updateInput("maturingDebtWithinYear", value)}
          />
          <NumberInput
            label="평균 조달금리"
            unit="%"
            value={input.averageFundingRate}
            step={0.1}
            onChange={(value) => updateInput("averageFundingRate", value)}
          />
          <label className="block">
            <span className="text-[11px] font-medium text-fg-muted">현재 신용등급</span>
            <select
              className="input mt-1 h-9 w-full"
              value={input.currentRating}
              onChange={(event) =>
                updateInput("currentRating", normalizeCreditRating(event.target.value) as CreditRating)
              }
            >
              {CREDIT_RATINGS.map((rating) => (
                <option key={rating} value={rating}>
                  {rating}
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="현금 버퍼"
            unit="억원"
            value={input.cashBuffer}
            step={0.1}
            onChange={(value) => updateInput("cashBuffer", value)}
          />
          <NumberInput
            label="이벤트성 유동성 필요"
            unit="억원"
            value={input.eventLiquidityNeed}
            step={0.1}
            onChange={(value) => updateInput("eventLiquidityNeed", value)}
          />
          <NumberInput
            label="유동비율"
            unit="배"
            value={input.currentRatio}
            step={0.01}
            onChange={(value) => updateInput("currentRatio", value)}
          />
          <NumberInput
            label="부채/자기자본"
            unit="%"
            value={input.debtToEquityRatio}
            onChange={(value) => updateInput("debtToEquityRatio", value)}
          />
          <NumberInput
            label="이자보상배율"
            unit="배"
            value={input.interestCoverageRatio}
            step={0.1}
            onChange={(value) => updateInput("interestCoverageRatio", value)}
          />
          <NumberInput
            label="매출채권 회수일"
            unit="일"
            value={input.receivablesDays}
            onChange={(value) => updateInput("receivablesDays", value)}
          />
          <NumberInput
            label="재고 회전일"
            unit="일"
            value={input.inventoryDays}
            onChange={(value) => updateInput("inventoryDays", value)}
          />
          <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-2 px-3 py-2 text-xs font-medium text-fg">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              checked={input.forcedRefinancing}
              onChange={(event) => updateInput("forcedRefinancing", event.target.checked)}
            />
            등급 하락 시 총차입금 즉시 차환 압박
          </label>
        </div>
      </details>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[0.95fr_1.05fr]">
        <div className={`rounded-xl border p-4 ${currentRisk.border} ${currentRisk.panel}`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-fg">현재 설정 결과</h4>
              <p className="mt-1 text-[11px] text-fg-muted">
                {selectedPresetName} · {portfolioProfile.badge}
                {macroLinked && macroIsActive ? " · Macro-linked" : ""}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${currentRisk.badge}`}>
              {currentRisk.label}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="영업현금흐름 감소액" value={formatEok(currentResult.operatingCashflowLoss)} />
            <Metric label="임대수입 감소액" value={formatEok(currentResult.rentalIncomeLoss)} />
            <Metric
              label="시장 스프레드 이자비용"
              value={formatEok(currentResult.marketSpreadInterestCost)}
            />
            <Metric
              label="신용등급 하락 추가 차입비용"
              value={formatEok(currentResult.ratingDowngradeInterestCost)}
            />
            <Metric label="운전자본·회수지연 부담" value={formatEok(currentResult.workingCapitalNeed)} />
            <Metric
              label="12개월 유동성 부족액"
              value={currentResult.liquidityGap <= 0 ? "부족 없음" : formatEok(currentResult.liquidityGap)}
              strong
              tone={currentResult.liquidityGap <= 0 ? "safe" : currentResult.riskLevel}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">
            {riskCopy(currentResult.riskLevel)}
          </p>
        </div>

        <div className="rounded-xl border border-border/70 p-4">
          <h4 className="text-sm font-semibold text-fg">재무비율 체크</h4>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MiniStat
              label="유동성"
              value={`${currentResult.stressedCurrentRatio.toFixed(2)}배`}
              hint="Stress 유동비율"
            />
            <MiniStat
              label="안정성"
              value={`${currentResult.stressedDebtToEbitda.toFixed(1)}배`}
              hint="Debt / EBITDA"
            />
            <MiniStat
              label="수익성"
              value={`${((currentResult.stressedEbitda / Math.max(1, input.annualRevenue)) * 100).toFixed(1)}%`}
              hint="Stress EBITDA margin"
            />
            <MiniStat
              label="활동성"
              value={`${Math.round(input.receivablesDays + adjustedScenario.collectionDelayDays)}일`}
              hint="회수일 + 지연"
            />
          </div>
          <div className="mt-3 rounded-lg border border-border/70 bg-surface-2 p-3">
            <h5 className="text-xs font-semibold text-fg">PB 설명문</h5>
            <p className="mt-2 text-sm leading-relaxed text-fg">{pbMessage}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
              이 모델은 보유 채권의 평가손실이 아니라 법인 자체의 신용등급 하락과 시장
              스프레드 확대가 차입비용·차환압박·운전자본 부담으로 전이되는 경로를 봅니다.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-fg">Mild / Base / Severe 3단계 비교</h4>
          <span className="text-[11px] text-fg-muted">
            Base 기준 부족액 {baseComparison.result.liquidityGap <= 0
              ? "없음"
              : formatEok(baseComparison.result.liquidityGap)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {comparisonResults.map(({ key, scenario: entry, adjustedScenario: scenarioForCalc, result }) => {
            const risk = riskStyles[result.riskLevel];
            return (
              <article key={key} className={`rounded-xl border bg-surface p-4 ${risk.border}`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-semibold text-fg">{entry.name}</h5>
                    <p className="mt-0.5 text-[11px] text-fg-muted">{entry.message} 시나리오</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
                    {risk.label}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-surface-2 p-2 text-[11px] text-fg-muted">
                  <span>{formatPercent(scenarioForCalc.revenueShock * 100)} 매출</span>
                  <span>{formatPp(scenarioForCalc.vacancyShockPp, 1)} 공실</span>
                  <span>{formatBp(scenarioForCalc.fundingSpreadShockBp)}</span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="영업현금흐름 감소" value={formatEok(result.operatingCashflowLoss)} compact />
                  <Metric label="임대수입 감소" value={formatEok(result.rentalIncomeLoss)} compact />
                  <Metric label="스프레드 비용" value={formatEok(result.marketSpreadInterestCost)} compact />
                  <Metric label="등급하락 비용" value={formatEok(result.ratingDowngradeInterestCost)} compact />
                  <div className="col-span-2 rounded-lg border border-border/70 p-3">
                    <p className="text-[11px] text-fg-muted">12개월 유동성 부족액</p>
                    <p className={`mt-1 text-xl font-bold tabular-nums ${risk.text}`}>
                      {result.liquidityGap <= 0 ? "부족 없음" : formatEok(result.liquidityGap)}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                      생존개월 {result.survivalMonths.toFixed(1)}개월 · ICR{" "}
                      {result.stressedInterestCoverage.toFixed(1)}배
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
          className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums text-fg outline-none"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="shrink-0 text-[11px] text-fg-muted">{unit}</span>
      </div>
    </label>
  );
}

function Metric({
  label,
  value,
  compact = false,
  strong = false,
  tone,
}: {
  label: string;
  value: string;
  compact?: boolean;
  strong?: boolean;
  tone?: MicroRiskLevel;
}) {
  const toneClass = tone ? riskStyles[tone].text : "text-fg";
  return (
    <div className="rounded-lg border border-border/70 bg-surface p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums ${compact ? "text-sm" : "text-base"} ${
          strong ? toneClass : "text-fg"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface p-2.5">
      <p className="text-[10px] text-fg-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-fg-muted">{hint}</p>}
    </div>
  );
}
