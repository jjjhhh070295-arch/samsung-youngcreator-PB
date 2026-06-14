"use client";

import { useMemo, useState } from "react";
import {
  calculateMicroStress,
  type MicroStressInput,
  type MicroStressScenario,
} from "@/lib/stress/microStress";
import { microStressScenarios } from "@/lib/stress/microStressScenarios";

type ScenarioKey = keyof typeof microStressScenarios;
type RiskLevel = "safe" | "watch" | "danger";

const demoInput: Omit<MicroStressInput, "forcedSale"> = {
  annualRevenue: 120,
  ebitdaMargin: 15,
  operatingLeverage: 1.2,
  annualRentalIncomeCurrent: 3,
  currentVacancyRate: 5,
  floatingDebt: 20,
  creditBondAmount: 10,
  creditDuration: 2.5,
  cashBuffer: 8,
  eventLiquidityNeed: 5,
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

const riskStyles: Record<
  RiskLevel,
  { label: string; badge: string; border: string; text: string }
> = {
  safe: {
    label: "Safe",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800/60",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  watch: {
    label: "Watch",
    badge: "bg-gold-100 text-gold-800 dark:bg-gold-900/40 dark:text-gold-200",
    border: "border-gold-300/70 dark:border-gold-700/50",
    text: "text-gold-700 dark:text-gold-300",
  },
  danger: {
    label: "Danger",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    border: "border-red-200 dark:border-red-800/60",
    text: "text-red-600 dark:text-red-300",
  },
};

const formatEok = (value: number) => {
  const abs = Math.abs(value);
  const formatted = abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${value < 0 ? "-" : ""}${formatted}억`;
};

const formatPercent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(0)}%`;
const formatPp = (value: number) => `+${value.toFixed(0)}%p`;
const formatBp = (value: number) => `+${value.toFixed(0)}bp`;

function riskCopy(level: RiskLevel) {
  if (level === "safe") return "현금 버퍼로 12개월 이벤트를 흡수할 수 있습니다.";
  if (level === "watch") return "현금흐름 방어는 가능하지만 유동성 버킷 보강이 필요합니다.";
  return "단기 현금화 또는 포트폴리오 방어 조정이 필요한 구간입니다.";
}

export default function BusinessCreditStressTest() {
  const [forcedSale, setForcedSale] = useState(false);

  const scenarioResults = useMemo(() => {
    const input: MicroStressInput = { ...demoInput, forcedSale };

    return scenarioEntries.map(([key, scenario]) => {
      const result = calculateMicroStress(input, scenario);
      return { key, scenario, result };
    });
  }, [forcedSale]);

  const base = scenarioResults.find((item) => item.key === "base") ?? scenarioResults[1];
  const baseRisk = riskStyles[base.result.riskLevel as RiskLevel];

  const pbMessage = forcedSale
    ? `Base 시나리오에서는 강제 매각까지 감안할 경우 12개월 유동성 부족액이 ${formatEok(
        base.result.liquidityGap,
      )}까지 확대되므로, 만기매칭 현금성 버킷을 먼저 확보해야 합니다.`
    : `Base 시나리오에서는 크레딧 평가손실을 즉시 현금유출로 보지 않아도 12개월 유동성 부족액이 ${formatEok(
        base.result.liquidityGap,
      )} 발생하므로, 법인 현금흐름과 임대수입 방어를 우선 점검해야 합니다.`;

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
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-fg-muted">
            법인 매출 감소, 공실률 상승, 차입 스프레드 확대, 회사채·여전채 평가손실이
            12개월 유동성 방어력에 미치는 영향을 상담용 숫자로 압축합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${baseRisk.badge}`}>
            Base Risk · {baseRisk.label}
          </span>
          <label className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg">
            <input
              type="checkbox"
              className="h-4 w-4 accent-gold-500"
              checked={forcedSale}
              onChange={(event) => setForcedSale(event.target.checked)}
            />
            강제 매각 가정
          </label>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {scenarioResults.map(({ key, scenario, result }) => {
          const risk = riskStyles[result.riskLevel as RiskLevel];
          return (
            <article key={key} className={`rounded-xl border bg-surface p-4 ${risk.border}`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-fg">{scenario.name}</h4>
                  <p className="mt-0.5 text-[11px] text-fg-muted">{scenario.message} 시나리오</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${risk.badge}`}>
                  {risk.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-surface-2 p-2 text-[11px] text-fg-muted">
                <span>{formatPercent(scenario.revenueShock * 100)} 매출</span>
                <span>{formatPp(scenario.vacancyShockPp)} 공실</span>
                <span>{formatBp(scenario.spreadShockBp)} 스프레드</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="영업현금흐름 감소액" value={formatEok(result.operatingCashflowLoss)} />
                <Metric label="임대수입 감소액" value={formatEok(result.rentalIncomeLoss)} />
                <Metric label="추가 이자비용" value={formatEok(result.additionalInterestCost)} />
                <Metric label="크레딧 평가손실" value={formatEok(result.creditAssetLoss)} muted />
                <div className="col-span-2 rounded-lg border border-border/70 p-3">
                  <p className="text-[11px] text-fg-muted">12개월 유동성 부족액</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums ${risk.text}`}>
                    {result.liquidityGap <= 0 ? "부족 없음" : formatEok(result.liquidityGap)}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    {riskCopy(result.riskLevel as RiskLevel)}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-xl border border-border/70 bg-surface-2 p-4">
          <h4 className="text-sm font-semibold text-fg">PB 설명문</h4>
          <p className="mt-2 text-sm leading-relaxed text-fg">{pbMessage}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
            크레딧 평가손실은 기본적으로 장부상 평가손실로 분리하고, 강제 매각 토글이 켜질
            때만 유동성 부족액에 포함합니다.
          </p>
        </div>
        <div className="rounded-xl border border-border/70 p-4">
          <h4 className="text-sm font-semibold text-fg">데모 입력값</h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <Data label="연매출" value={formatEok(demoInput.annualRevenue)} />
            <Data label="EBITDA margin" value={`${demoInput.ebitdaMargin}%`} />
            <Data label="연 임대수입" value={formatEok(demoInput.annualRentalIncomeCurrent)} />
            <Data label="현금 버퍼" value={formatEok(demoInput.cashBuffer)} />
            <Data label="변동/차환 차입금" value={formatEok(demoInput.floatingDebt)} />
            <Data label="크레딧 듀레이션" value={`${demoInput.creditDuration}년`} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 p-3">
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${muted ? "text-fg-muted" : "text-fg"}`}>
        {value}
      </p>
    </div>
  );
}

function Data({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-medium tabular-nums text-fg">{value}</dd>
    </>
  );
}
