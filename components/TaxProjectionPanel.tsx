"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client } from "@/lib/types";
import { calculateSimulatedMetrics, type PortfolioOption } from "@/lib/portfolio";
import { formatKRW } from "@/lib/format";
import {
  compareTaxProjections,
  inferTaxProfile,
  projectTax,
  taxProfileQuestions,
  type TaxProfile,
  type TaxProjectionResult,
} from "@/lib/taxProjection";

type WeightKey = keyof PortfolioOption["weights"];

interface Props {
  client: Client;
  baseWeights: PortfolioOption["weights"];
  principalWon: number;
  assetBaseEstimated?: boolean;
}

const ZERO_WEIGHTS: PortfolioOption["weights"] = {
  etf: 0,
  bond: 0,
  els: 0,
  mmf: 100,
  gold: 0,
  dollar: 0,
  raw: 0,
};

const CONTROL_ASSETS: Array<{ key: WeightKey; label: string; taxHint: string; max: number }> = [
  { key: "mmf", label: "MMF/RP", taxHint: "이자소득세 민감", max: 80 },
  { key: "etf", label: "주식/ETF", taxHint: "배당세·양도세 민감", max: 90 },
  { key: "bond", label: "채권", taxHint: "이자소득세 민감", max: 90 },
  { key: "gold", label: "금", taxHint: "양도차익 민감", max: 40 },
  { key: "dollar", label: "달러", taxHint: "환차익/양도차익 민감", max: 40 },
  { key: "raw", label: "원자재", taxHint: "양도차익 민감", max: 30 },
];

const ASSET_TONE: Record<WeightKey, string> = {
  etf: "bg-blue-600",
  bond: "bg-sky-500",
  els: "bg-sky-500",
  mmf: "bg-indigo-600",
  gold: "bg-amber-500",
  dollar: "bg-slate-500",
  raw: "bg-stone-500",
};

function cleanWeights(weights?: PortfolioOption["weights"]): PortfolioOption["weights"] {
  const source = weights ?? ZERO_WEIGHTS;
  const next = {
    etf: Math.max(0, Math.round(source.etf)),
    bond: Math.max(0, Math.round(source.bond + source.els * 0.7)),
    els: 0,
    mmf: Math.max(0, Math.round(source.mmf + source.els * 0.3)),
    gold: Math.max(0, Math.round(source.gold)),
    dollar: Math.max(0, Math.round(source.dollar)),
    raw: Math.max(0, Math.round(source.raw)),
  };
  const total = Object.values(next).reduce((sum, value) => sum + value, 0) || 1;
  const normalized = Object.fromEntries(
    Object.entries(next).map(([key, value]) => [key, Math.round((value / total) * 100)]),
  ) as PortfolioOption["weights"];
  normalized.els = 0;
  normalized.mmf += 100 - Object.values(normalized).reduce((sum, value) => sum + value, 0);
  return normalized;
}

function adjustWeight(
  previous: PortfolioOption["weights"],
  asset: WeightKey,
  rawValue: number,
): PortfolioOption["weights"] {
  const next = { ...previous, els: 0 };
  const current = next[asset] ?? 0;
  let requested = Math.max(0, Math.min(100, Math.round(Number.isNaN(rawValue) ? current : rawValue)));
  let delta = requested - current;
  next[asset] = requested;

  if (delta > 0) {
    const donors: WeightKey[] =
      asset === "mmf"
        ? ["bond", "etf", "gold", "dollar", "raw"]
        : ["mmf", "bond", "etf", "gold", "dollar", "raw"].filter((key) => key !== asset) as WeightKey[];
    for (const donor of donors) {
      if (delta <= 0) break;
      const take = Math.min(next[donor], delta);
      next[donor] -= take;
      delta -= take;
    }
    if (delta > 0) {
      next[asset] -= delta;
      requested = next[asset];
    }
  } else if (delta < 0) {
    const receiver: WeightKey = asset === "mmf" ? "bond" : "mmf";
    next[receiver] += Math.abs(delta);
  }

  const total = Object.values(next).reduce((sum, value) => sum + value, 0);
  if (total !== 100) {
    const fixer: WeightKey = asset === "mmf" ? "bond" : "mmf";
    next[fixer] = Math.max(0, next[fixer] + (100 - total));
  }
  next[asset] = requested;
  return cleanWeights(next);
}

function formatDeltaWon(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatKRW(Math.abs(value))}`;
}

function pctDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function resultRows(result: TaxProjectionResult) {
  return [
    ["투자원금", result.principalWon, "text-fg"],
    ["세전 수익", result.grossReturnWon, "text-emerald-700"],
    ["이자세", -result.taxes.interestTaxWon, "text-rose-600"],
    ["배당세", -result.taxes.dividendTaxWon, "text-rose-600"],
    ["양도세", -result.taxes.capitalGainTaxWon, "text-rose-600"],
    ["종합과세/법인세", -result.taxes.comprehensiveTaxWon, "text-rose-600"],
    ["일정 세금", -result.taxes.scheduledTaxWon, "text-rose-600"],
    ["비용", -result.feesWon, "text-amber-700"],
    ["세후 기말자산", result.netEndingWon, "text-blue-700"],
  ] as const;
}

function weightNarratives(base: PortfolioOption["weights"], adjusted: PortfolioOption["weights"]) {
  const narratives: string[] = [];
  const delta = (key: WeightKey) => Math.round(((adjusted[key] ?? 0) - (base[key] ?? 0)) * 10) / 10;
  const etfDelta = delta("etf");
  const mmfDelta = delta("mmf");
  const bondDelta = delta("bond");
  const gainDelta = delta("gold") + delta("dollar") + delta("raw");

  if (Math.abs(etfDelta) >= 1) {
    narratives.push(`주식/ETF ${etfDelta > 0 ? "+" : ""}${etfDelta}%p: 배당세·국내/해외 양도세 민감도가 ${etfDelta > 0 ? "상승" : "하락"}합니다.`);
  }
  if (Math.abs(mmfDelta) >= 1) {
    narratives.push(`MMF/RP ${mmfDelta > 0 ? "+" : ""}${mmfDelta}%p: 이자소득세 민감도가 ${mmfDelta > 0 ? "상승" : "하락"}하고 양도세 민감도는 상대적으로 낮아집니다.`);
  }
  if (Math.abs(bondDelta) >= 1) {
    narratives.push(`채권 ${bondDelta > 0 ? "+" : ""}${bondDelta}%p: 이자소득세와 금융소득종합과세 민감도가 ${bondDelta > 0 ? "상승" : "하락"}합니다.`);
  }
  if (Math.abs(gainDelta) >= 1) {
    narratives.push(`금·달러·원자재 ${gainDelta > 0 ? "+" : ""}${Math.round(gainDelta * 10) / 10}%p: 양도차익 과세 민감도가 변합니다.`);
  }
  return narratives.length > 0 ? narratives : ["비중 변화가 작아 세목별 민감도 변화가 제한적입니다."];
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <p className="text-[11px] font-semibold text-fg-muted">{label}</p>
      <p className={`mt-1 text-lg font-black tabular-nums ${tone ?? "text-fg"}`}>{value}</p>
    </div>
  );
}

function ProjectionTable({
  result,
  compareTo,
}: {
  result: TaxProjectionResult;
  compareTo?: TaxProjectionResult;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border bg-surface-2 px-4 py-3">
        <p className="text-sm font-black text-fg">{result.label}</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">
          세전 {result.preTaxReturnPct}% · 세후 {result.afterTaxReturnPct}% · 실효세율 {result.effectiveTaxRatePct}%
        </p>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {resultRows(result).map(([label, amount, tone]) => {
            const baseAmount = compareTo
              ? resultRows(compareTo).find(([baseLabel]) => baseLabel === label)?.[1] ?? 0
              : 0;
            const delta = compareTo ? amount - baseAmount : 0;
            return (
              <tr key={label} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-fg-muted">{label}</td>
                <td className={`px-4 py-2 text-right font-bold tabular-nums ${tone}`}>{formatKRW(amount)}</td>
                {compareTo && (
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {formatDeltaWon(delta)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeightSlider({
  asset,
  value,
  max,
  label,
  taxHint,
  onChange,
}: {
  asset: WeightKey;
  value: number;
  max: number;
  label: string;
  taxHint: string;
  onChange: (asset: WeightKey, value: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${ASSET_TONE[asset]}`} />
          <span className="text-xs font-black text-fg">{label}</span>
        </div>
        <span className="shrink-0 text-sm font-black text-fg">{value}%</span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        step="1"
        value={value}
        onChange={(event) => onChange(asset, Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface accent-blue-600"
      />
      <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">{taxHint}</p>
    </div>
  );
}

export default function TaxProjectionPanel({ client, baseWeights, principalWon, assetBaseEstimated = false }: Props) {
  const normalizedBase = useMemo(() => cleanWeights(baseWeights), [baseWeights]);
  const [adjustedWeights, setAdjustedWeights] = useState<PortfolioOption["weights"]>(normalizedBase);
  const [horizonYears, setHorizonYears] = useState(1);
  const [taxProfile, setTaxProfile] = useState<TaxProfile>(() => inferTaxProfile(client));

  useEffect(() => {
    setAdjustedWeights(normalizedBase);
  }, [normalizedBase]);

  useEffect(() => {
    setTaxProfile(inferTaxProfile(client));
  }, [client]);

  const questions = useMemo(() => taxProfileQuestions(client), [client]);
  const baseMetrics = useMemo(() => calculateSimulatedMetrics(normalizedBase), [normalizedBase]);
  const adjustedMetrics = useMemo(() => calculateSimulatedMetrics(adjustedWeights), [adjustedWeights]);
  const baseProjection = useMemo(
    () =>
      projectTax({
        principalWon,
        horizonYears,
        weights: normalizedBase,
        expectedReturnPct: baseMetrics.expectedReturn,
        taxProfile,
        cashFlows: client.cashFlows,
        label: "기준안",
      }),
    [baseMetrics.expectedReturn, client.cashFlows, horizonYears, normalizedBase, principalWon, taxProfile],
  );
  const adjustedProjection = useMemo(
    () =>
      projectTax({
        principalWon,
        horizonYears,
        weights: adjustedWeights,
        expectedReturnPct: adjustedMetrics.expectedReturn,
        taxProfile,
        cashFlows: client.cashFlows,
        label: "조정안",
      }),
    [adjustedMetrics.expectedReturn, adjustedWeights, client.cashFlows, horizonYears, principalWon, taxProfile],
  );
  const comparison = useMemo(
    () => compareTaxProjections(baseProjection, adjustedProjection),
    [baseProjection, adjustedProjection],
  );
  const narratives = useMemo(() => weightNarratives(normalizedBase, adjustedWeights), [adjustedWeights, normalizedBase]);
  const profilePatch = (patch: Partial<TaxProfile>) => setTaxProfile((previous) => ({ ...previous, ...patch }));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-black text-amber-900">세전·세후 금액 스트레스테스트</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900">
              포트폴리오 비중 조정에 따른 세전 수익, 세목별 세금, 비용, 세후 기말자산을 원화로 비교합니다.
              상담용 추정이며 세무 신고·납부 확정 금액이 아닙니다.
            </p>
          </div>
          <span className="rounded-full border border-amber-300 bg-surface px-3 py-1 text-[11px] font-bold text-amber-900">
            {assetBaseEstimated ? "등록 자산규모 기준" : "부동산 제외 운용자산 기준"} · {formatKRW(principalWon)}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <StatCard label="기준안 세후 기말자산" value={formatKRW(baseProjection.netEndingWon)} tone="text-blue-700" />
        <StatCard label="조정안 세후 기말자산" value={formatKRW(adjustedProjection.netEndingWon)} tone="text-blue-700" />
        <StatCard
          label="세후 기말자산 Δ"
          value={formatDeltaWon(comparison.deltaNetEndingWon)}
          tone={comparison.deltaNetEndingWon >= 0 ? "text-emerald-700" : "text-rose-600"}
        />
        <StatCard
          label="총 세금 Δ"
          value={formatDeltaWon(comparison.deltaTotalTaxWon)}
          tone={comparison.deltaTotalTaxWon <= 0 ? "text-emerald-700" : "text-rose-600"}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm xl:col-span-5">
          <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-black text-fg">PB 커스텀 비중 조정</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                한 자산을 늘리면 다른 자산을 자동 차감해 합계 100%를 유지합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdjustedWeights(normalizedBase)}
              className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-fg-muted hover:text-fg"
            >
              기준안 복원
            </button>
          </div>
          <div className="space-y-3">
            {CONTROL_ASSETS.map((asset) => (
              <WeightSlider
                key={asset.key}
                asset={asset.key}
                label={asset.label}
                value={Math.round(adjustedWeights[asset.key])}
                max={asset.max}
                taxHint={asset.taxHint}
                onChange={(key, value) => setAdjustedWeights((previous) => adjustWeight(previous, key, value))}
              />
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs font-black text-fg">비중 변화 해석</p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-fg-muted">
              {narratives.map((item) => (
                <li key={item}>• {item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4 xl:col-span-7">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ProjectionTable result={baseProjection} />
            <ProjectionTable result={adjustedProjection} compareTo={baseProjection} />
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-sm font-black text-fg">기준안 대비 변화</h3>
              <span className="text-[11px] font-bold text-fg-muted">
                실효세율 {pctDelta(comparison.deltaEffectiveTaxRatePct)} · 세후수익률 {pctDelta(comparison.deltaAfterTaxReturnPct)}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-2 text-xs leading-relaxed text-fg-muted lg:grid-cols-3">
              {comparison.summary.map((item) => (
                <li key={item} className="rounded-xl border border-border bg-surface-2 p-3">{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm xl:col-span-5">
          <div className="mb-4 border-b border-border pb-3">
            <h3 className="text-sm font-black text-fg">세금 프로필 가정</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              PB가 상담 중 확인한 값으로 바꾸면 상단 금액 비교가 즉시 갱신됩니다.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-fg">
              기존 금융소득(만원)
              <input
                type="number"
                min="0"
                step="100"
                value={Math.round((taxProfile.annualFinancialIncomeWon ?? 0) / 10_000)}
                onChange={(event) => profilePatch({ annualFinancialIncomeWon: Math.max(0, Number(event.target.value) || 0) * 10_000 })}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs font-bold text-fg">
              한계세율
              <select
                value={taxProfile.marginalTaxRatePct ?? 24}
                onChange={(event) => profilePatch({ marginalTaxRatePct: Number(event.target.value) })}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              >
                {[24, 35, 38, 45].map((rate) => (
                  <option key={rate} value={rate}>{rate}%</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-fg">
              ETF 내 국내 비중
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(taxProfile.domesticEquityPct ?? 40)}
                onChange={(event) => {
                  const domestic = Math.max(0, Math.min(100, Number(event.target.value) || 0));
                  profilePatch({ domesticEquityPct: domestic, overseasEquityPct: 100 - domestic });
                }}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs font-bold text-fg">
              연금·IRP 비중
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(taxProfile.pensionAccountPct ?? 0)}
                onChange={(event) => profilePatch({ pensionAccountPct: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs font-bold text-fg">
              수수료·보수 연 %
              <input
                type="number"
                min="0"
                step="0.01"
                value={taxProfile.feeRatePct ?? 0.15}
                onChange={(event) => profilePatch({ feeRatePct: Math.max(0, Number(event.target.value) || 0) })}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs font-bold text-fg">
              법인세 간이세율
              <input
                type="number"
                min="0"
                max="30"
                step="0.1"
                value={taxProfile.corporateTaxRatePct ?? 9}
                onChange={(event) => profilePatch({ corporateTaxRatePct: Math.max(0, Math.min(30, Number(event.target.value) || 0)) })}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="text-xs font-bold text-fg">
              분석 기간(년)
              <input
                type="number"
                min="1"
                max="10"
                value={horizonYears}
                onChange={(event) => setHorizonYears(Math.max(1, Math.min(10, Number(event.target.value) || 1)))}
                className="mt-1 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg"
              />
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-bold text-fg">
              <input
                type="checkbox"
                checked={Boolean(taxProfile.isLargeShareholder)}
                onChange={(event) => profilePatch({ isLargeShareholder: event.target.checked })}
                className="h-4 w-4 accent-blue-600"
              />
              대주주 플래그
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs font-bold text-fg">
              <input
                type="checkbox"
                checked={Boolean(taxProfile.isCorporate)}
                onChange={(event) => profilePatch({ isCorporate: event.target.checked })}
                className="h-4 w-4 accent-blue-600"
              />
              법인세 간이 적용
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm xl:col-span-7">
          <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-black text-fg">세금 프로필 질문</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                플래그/추가질문처럼 PB가 상담에서 확인해야 할 세금 민감도 질문입니다.
              </p>
            </div>
            <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-fg-muted">
              {questions.length}개
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {questions.map((question) => (
              <div key={question.code} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-fg">
                    <span className="mr-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{question.code}</span>
                    {question.title}
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      question.severity === "상"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : question.severity === "중"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-border bg-surface text-fg-muted"
                    }`}
                  >
                    {question.severity}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-fg">{question.question}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{question.reason}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <div className="mb-3 border-b border-border pb-3">
          <h3 className="text-sm font-black text-fg">자산군별 세전 수익·세금 분해</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
            조정안 기준입니다. ETF는 배당 30%와 실현차익 70%, MMF·채권은 이자 100%로 단순 분해합니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-xs">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="px-3 py-2">자산군</th>
                <th className="px-3 py-2 text-right">세전 수익</th>
                <th className="px-3 py-2 text-right">추정 세금</th>
                <th className="px-3 py-2 text-right">세후 수익</th>
              </tr>
            </thead>
            <tbody>
              {adjustedProjection.breakdownByAsset.map((item) => (
                <tr key={item.asset} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-bold text-fg">{item.asset}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatKRW(item.grossWon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">{formatKRW(item.taxWon)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold text-fg">{formatKRW(item.grossWon - item.taxWon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] leading-relaxed text-fg-muted lg:grid-cols-2">
          {adjustedProjection.assumptions.map((assumption) => (
            <p key={assumption} className="rounded-lg border border-border bg-surface-2 px-3 py-2">{assumption}</p>
          ))}
          {adjustedProjection.warnings.map((warning) => (
            <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-900">
              {warning}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
