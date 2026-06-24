"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client } from "@/lib/types";
import { calculateSimulatedMetrics, type PortfolioOption } from "@/lib/portfolio";
import { formatKRW } from "@/lib/format";
import { summarizeCashflowsForTax, type ScheduledTaxBucket, type TaxDataSource } from "@/lib/cashflowTaxAggregation";
import {
  compareTaxProjections,
  mergeTaxProfile,
  projectTax,
  taxProfileQuestions,
  type MergedTaxProfile,
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

const SOURCE_LABELS: Record<TaxDataSource, string> = {
  cashflow: "현금흐름",
  manual: "PB 수동",
  inferred: "추정",
  estimated: "운용추정",
  ignored: "미반영",
};

const SOURCE_TONE: Record<TaxDataSource, string> = {
  cashflow: "border-blue-200 bg-blue-50 text-blue-700",
  manual: "border-emerald-200 bg-emerald-50 text-emerald-700",
  inferred: "border-slate-200 bg-slate-50 text-slate-700",
  estimated: "border-amber-200 bg-amber-50 text-amber-700",
  ignored: "border-rose-200 bg-rose-50 text-rose-700",
};

const SCHEDULED_TAX_LABELS: Record<ScheduledTaxBucket, string> = {
  gift: "증여세",
  inheritance: "상속세",
  capitalGain: "양도세",
  corporate: "법인세",
  property: "재산·종부세",
  other: "기타 세금",
};

const SCHEDULED_TAX_BUCKETS: ScheduledTaxBucket[] = [
  "gift",
  "inheritance",
  "capitalGain",
  "corporate",
  "property",
  "other",
];

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

type ProjectionRow = {
  key: string;
  block: "operating" | "scheduled" | "total";
  label: string;
  amount: number;
  tone: string;
  source?: TaxDataSource;
  note?: string;
  strong?: boolean;
};

const PROJECTION_BLOCK_LABELS: Record<ProjectionRow["block"], string> = {
  operating: "운용",
  scheduled: "현금흐름 일정",
  total: "합산",
};

function projectionRows(result: TaxProjectionResult): ProjectionRow[] {
  const hasScheduledCapitalGainTax = result.taxes.scheduledByBucket.capitalGain > 0;
  const hasScheduledCorporateTax = result.taxes.scheduledByBucket.corporate > 0;
  const scheduledRows = SCHEDULED_TAX_BUCKETS
    .map((bucket): ProjectionRow => ({
      key: `scheduled-${bucket}`,
      block: "scheduled",
      label: `${SCHEDULED_TAX_LABELS[bucket]} (납부 일정)`,
      amount: -result.taxes.scheduledByBucket[bucket],
      tone: "text-rose-600",
      source: "cashflow",
      note: "현금흐름 세금 일정에서 반영",
    }))
    .filter((row) => row.amount !== 0);

  return [
    {
      key: "principal",
      block: "operating",
      label: "투자원금",
      amount: result.principalWon,
      tone: "text-fg",
      strong: true,
    },
    {
      key: "gross-return",
      block: "operating",
      label: "세전 수익",
      amount: result.grossReturnWon,
      tone: "text-emerald-700",
      strong: true,
    },
    {
      key: "interest-tax",
      block: "operating",
      label: "이자세",
      amount: -result.taxes.interestTaxWon,
      tone: "text-rose-600",
      source: "estimated",
    },
    {
      key: "dividend-tax",
      block: "operating",
      label: "배당세",
      amount: -result.taxes.dividendTaxWon,
      tone: "text-rose-600",
      source: "estimated",
    },
    {
      key: "capital-gain-tax",
      block: "operating",
      label: "양도세 (운용 추정)",
      amount: -result.taxes.capitalGainTaxWon,
      tone: "text-rose-600",
      source: hasScheduledCapitalGainTax ? "ignored" : "estimated",
      note: hasScheduledCapitalGainTax
        ? "현금흐름 양도세 일정이 있어 운용 추정치는 중복 차감하지 않음"
        : "포트폴리오 비중 기반 실현차익 추정",
    },
    ...(!result.isCorporate
      ? [{
          key: "comprehensive-tax",
          block: "operating" as const,
          label: "종합과세",
          amount: -result.taxes.comprehensiveTaxWon,
          tone: "text-rose-600",
          source: "estimated" as const,
          note: "개인 금융소득종합과세 간이 추정",
        }]
      : []),
    ...(result.isCorporate && !hasScheduledCorporateTax
      ? [{
          key: "corporate-overlay-tax",
          block: "operating" as const,
          label: "법인세 (운용 추정)",
          amount: -result.taxes.corporateOverlayTaxWon,
          tone: "text-rose-600",
          source: "estimated" as const,
          note: "현금흐름 법인세 일정이 없을 때만 운용수익에 간이 적용",
        }]
      : []),
    {
      key: "fees",
      block: "operating",
      label: "비용",
      amount: -result.feesWon,
      tone: "text-amber-700",
      source: "estimated",
    },
    {
      key: "operating-net",
      block: "operating",
      label: "운용 소계 세후",
      amount: result.operatingNetWon,
      tone: "text-blue-700",
      strong: true,
      note: "투자원금 + 세전 수익 - 운용세금 - 비용",
    },
    ...scheduledRows,
    ...(scheduledRows.length > 0
      ? [{
          key: "scheduled-subtotal",
          block: "scheduled" as const,
          label: "일정 세금 소계",
          amount: -result.taxes.scheduledTaxWon,
          tone: "text-rose-600",
          source: "cashflow" as const,
          strong: true,
        }]
      : []),
    {
      key: "net-ending",
      block: "total",
      label: "세후 기말자산",
      amount: result.netEndingWon,
      tone: "text-blue-700",
      strong: true,
    },
  ];
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

function SourceBadge({ source }: { source: TaxDataSource }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${SOURCE_TONE[source]}`}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

function SourceRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: { source: TaxDataSource; note: string };
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-bold text-fg-muted">{label}</p>
        <p className="mt-0.5 text-xs font-black text-fg">{value}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-fg-muted">{meta.note}</p>
      </div>
      <SourceBadge source={meta.source} />
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
  const rows = projectionRows(result);
  const compareRows = compareTo ? new Map(projectionRows(compareTo).map((row) => [row.key, row.amount])) : undefined;
  let lastBlock: ProjectionRow["block"] | null = null;

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
          {rows.map((row) => {
            const showBlock = row.block !== lastBlock;
            lastBlock = row.block;
            const baseAmount = compareRows?.get(row.key) ?? 0;
            const delta = compareTo ? row.amount - baseAmount : 0;
            return (
              <tr
                key={row.key}
                className={`${showBlock ? "border-t border-border" : ""} border-b border-border last:border-0 ${
                  row.strong ? "bg-surface-2/70" : ""
                }`}
                title={row.note}
              >
                <td className="px-4 py-2">
                  {showBlock ? (
                    <p className="mb-1 text-[10px] font-black text-fg-muted">
                      {PROJECTION_BLOCK_LABELS[row.block]}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`${row.strong ? "font-black text-fg" : "text-fg-muted"}`}>{row.label}</span>
                    {row.source ? <SourceBadge source={row.source} /> : null}
                  </div>
                  {row.note ? <p className="mt-0.5 text-[10px] leading-relaxed text-fg-muted">{row.note}</p> : null}
                </td>
                <td className={`px-4 py-2 text-right ${row.strong ? "font-black" : "font-bold"} tabular-nums ${row.tone}`}>
                  {formatKRW(row.amount)}
                </td>
                {compareTo ? (
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${delta >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
                    {formatDeltaWon(delta)}
                  </td>
                ) : null}
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
  const [taxProfileOverrides, setTaxProfileOverrides] = useState<Partial<TaxProfile>>({});

  useEffect(() => {
    setAdjustedWeights(normalizedBase);
  }, [normalizedBase]);

  useEffect(() => {
    setTaxProfileOverrides({});
  }, [client.id]);

  const questions = useMemo(() => taxProfileQuestions(client), [client]);
  const cashflowTaxSummary = useMemo(
    () => summarizeCashflowsForTax(client.cashFlows, horizonYears),
    [client.cashFlows, horizonYears],
  );
  const mergedTaxProfile: MergedTaxProfile = useMemo(
    () => mergeTaxProfile(client, cashflowTaxSummary, taxProfileOverrides),
    [cashflowTaxSummary, client, taxProfileOverrides],
  );
  const taxProfile = mergedTaxProfile.profile;
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
        cashflowTaxSummary,
        label: "기준안",
      }),
    [baseMetrics.expectedReturn, cashflowTaxSummary, client.cashFlows, horizonYears, normalizedBase, principalWon, taxProfile],
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
        cashflowTaxSummary,
        label: "조정안",
      }),
    [adjustedMetrics.expectedReturn, adjustedWeights, cashflowTaxSummary, client.cashFlows, horizonYears, principalWon, taxProfile],
  );
  const comparison = useMemo(
    () => compareTaxProjections(baseProjection, adjustedProjection),
    [baseProjection, adjustedProjection],
  );
  const narratives = useMemo(() => weightNarratives(normalizedBase, adjustedWeights), [adjustedWeights, normalizedBase]);
  const profilePatch = (patch: Partial<TaxProfile>) => setTaxProfileOverrides((previous) => ({ ...previous, ...patch }));

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
          <div className="mb-3 border-b border-border pb-3">
            <h3 className="text-sm font-black text-fg">현금흐름 세금 원장</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              반복 이자·배당과 예정 세금은 현금흐름을 1차 데이터로 집계합니다.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatCard label="연 반복 이자" value={formatKRW(cashflowTaxSummary.annualInterestIncomeWon)} tone="text-blue-700" />
            <StatCard label="연 반복 배당" value={formatKRW(cashflowTaxSummary.annualDividendIncomeWon)} tone="text-blue-700" />
          </div>
          <div className="mt-3 space-y-1.5">
            {SCHEDULED_TAX_BUCKETS.map((bucket) => {
              const amount = cashflowTaxSummary.scheduledTaxes.byBucket[bucket];
              return (
                <div key={bucket} className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
                  <span className="font-bold text-fg-muted">{SCHEDULED_TAX_LABELS[bucket]}</span>
                  <span className={amount > 0 ? "font-black tabular-nums text-rose-600" : "font-bold tabular-nums text-fg-muted"}>
                    {formatKRW(amount)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-900">
            법인 흐름 힌트 {cashflowTaxSummary.entityHints.corporateFlowPct}% · 세금 일정{" "}
            {cashflowTaxSummary.scheduledTaxes.items.length}건 · 중복 제외{" "}
            {cashflowTaxSummary.scheduledTaxes.ignoredDuplicates.length}건
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm xl:col-span-7">
          <div className="mb-3 border-b border-border pb-3">
            <h3 className="text-sm font-black text-fg">세목별 반영 방식</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              현금흐름에 이미 있는 세목은 동일 세금이 두 번 차감되지 않도록 운용 추정치를 미반영 처리합니다.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {adjustedProjection.taxSources.map((source) => (
              <div key={source.item} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-fg">{source.item}</p>
                  <SourceBadge source={source.source} />
                </div>
                <p className="text-sm font-black tabular-nums text-fg">{formatKRW(source.amountWon)}</p>
                {source.ignoredAmountWon ? (
                  <p className="mt-1 text-[11px] font-bold text-rose-700">
                    중복 방지 미반영 {formatKRW(source.ignoredAmountWon)}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{source.note}</p>
              </div>
            ))}
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
          <div className="mt-4 space-y-2 rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black text-fg">프로필 데이터 출처</p>
              <button
                type="button"
                onClick={() => setTaxProfileOverrides({})}
                className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[10px] font-bold text-fg-muted hover:text-fg"
              >
                수동값 초기화
              </button>
            </div>
            <SourceRow
              label="기존 금융소득"
              value={formatKRW(mergedTaxProfile.sources.annualFinancialIncomeWon.value)}
              meta={mergedTaxProfile.sources.annualFinancialIncomeWon}
            />
            <SourceRow
              label="한계세율"
              value={`${mergedTaxProfile.sources.marginalTaxRatePct.value}%`}
              meta={mergedTaxProfile.sources.marginalTaxRatePct}
            />
            <SourceRow
              label="법인세 적용"
              value={mergedTaxProfile.sources.isCorporate.value ? "적용" : "미적용"}
              meta={mergedTaxProfile.sources.isCorporate}
            />
            <SourceRow
              label="수수료·보수"
              value={`${mergedTaxProfile.sources.feeRatePct.value}%`}
              meta={mergedTaxProfile.sources.feeRatePct}
            />
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
