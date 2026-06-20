"use client";

// 스트레스 테스트 — 5개 매크로 요인 슬라이더 + 백테스트 기반 민감도 검정
//
//  현재 포트폴리오(allocations)를 기준으로:
//   1) 요인별 강도(슬라이더)를 설정 → 충격 시나리오 구성
//   2) 자산군별 충격 수익·기여도 분해
//   3) 충격 후 비중 변화(드리프트)
//   4) 스트레스 대응 조정 포트폴리오 제안
//   5) 각 자산군·요인의 통계 신뢰도(R²·t값) 표기
//
//  민감도 계수는 최근 ~10년 월간 데이터 다중회귀(OLS) 추정치. (lib/sensitivities.ts)

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from "recharts";
import type {
  Portfolio,
  ScenarioShock,
  MacroFactorId,
  StressTestResult,
  RebalanceProposal,
} from "@/lib/types";
import {
  FACTOR_META,
  SAMPLE_INFO,
  ASSET_SENSITIVITIES,
  FACTOR_IDS,
  zeroShock,
  PRESET_SCENARIOS,
  runStressTest,
  proposeRebalance,
} from "@/lib/stresstest";
import { runMonteCarloCvar } from "@/lib/stress/monteCarlo";
import { CHART_COLORS } from "@/lib/theme";
import { EmptyView } from "./StateViews";

interface Props {
  portfolios: Portfolio[];
}

const MACRO_ASSET_LABELS = {
  us: "미국주식 (S&P 500)",
  kr: "국내주식 (KOSPI)",
  bond: "채권 (미국채 10년물)",
} as const;

function normalizeMacroPortfolio(portfolio: Portfolio): Portfolio {
  const grouped = new Map<string, number>();

  for (const allocation of portfolio.allocations) {
    const compact = allocation.assetClass.replace(/\s/g, "").toLowerCase();
    let label: string | null = null;
    if (compact.includes("미국주식") || compact.includes("해외주식") || compact.includes("s&p500")) {
      label = MACRO_ASSET_LABELS.us;
    } else if (compact.includes("국내주식") || compact.includes("kospi")) {
      label = MACRO_ASSET_LABELS.kr;
    } else if (compact.includes("채권") || compact.includes("미국채10년")) {
      label = MACRO_ASSET_LABELS.bond;
    }
    if (label) grouped.set(label, (grouped.get(label) ?? 0) + allocation.weight);
  }

  const includedWeight = Array.from(grouped.values()).reduce((sum, weight) => sum + weight, 0);
  const allocations = Array.from(grouped.entries()).map(([assetClass, weight]) => ({
    assetClass,
    weight: includedWeight > 0 ? Math.round((weight / includedWeight) * 1000) / 10 : 0,
  }));

  return { ...portfolio, allocations };
}

// 숫자 포맷
const fmt = (n: number, d = 1) =>
  (n >= 0 ? "+" : "") + n.toFixed(d);
const fmtAbs = (n: number, d = 1) => n.toFixed(d);

// 신뢰도(R²) → 한글 등급
function confidenceLabel(r2: number): { txt: string; cls: string } {
  if (r2 >= 0.5) return { txt: "높음", cls: "text-emerald-600 dark:text-emerald-300" };
  if (r2 >= 0.2) return { txt: "보통", cls: "text-amber-600 dark:text-amber-300" };
  return { txt: "낮음", cls: "text-red-500" };
}

export default function StressTestPanel({ portfolios }: Props) {
  const [shock, setShock] = useState<ScenarioShock>(zeroShock());
  const [presetId, setPresetId] = useState<string>("none");
  // 어떤 포트폴리오를 대상으로 조정안을 만들지 (기본: 첫 번째)
  const [targetId, setTargetId] = useState<string>(portfolios[0]?.id ?? "");

  // 충격이 하나라도 설정됐는지
  const anyShock = useMemo(
    () => FACTOR_IDS.some((id) => shock[id] !== 0),
    [shock],
  );

  // 결과 계산 (슬라이더 변화에 즉시 반응)
  const macroPortfolios = useMemo(
    () => portfolios.map(normalizeMacroPortfolio).filter((portfolio) => portfolio.allocations.length > 0),
    [portfolios],
  );

  const results: StressTestResult[] = useMemo(
    () => (macroPortfolios.length ? runStressTest(macroPortfolios, shock) : []),
    [macroPortfolios, shock],
  );

  const target = macroPortfolios.find((p) => p.id === targetId) ?? macroPortfolios[0];
  const targetResult = results.find((r) => r.portfolioId === target?.id);
  const proposal: RebalanceProposal | null = useMemo(
    () => (target ? proposeRebalance(target, shock) : null),
    [target, shock],
  );
  const monteCarlo = useMemo(
    () => (target ? runMonteCarloCvar(target, shock, { simulations: 5000 }) : null),
    [target, shock],
  );
  const monteCarloByPortfolio = useMemo(() => {
    return new Map(
      macroPortfolios.map((portfolio) => [
        portfolio.id,
        runMonteCarloCvar(portfolio, shock, { simulations: 5000 }),
      ]),
    );
  }, [macroPortfolios, shock]);

  if (macroPortfolios.length === 0) {
    return (
      <EmptyView
        title="테스트 가능한 자산이 없습니다"
        hint="미국주식, 국내주식, 채권이 포함된 포트폴리오를 먼저 생성하세요."
      />
    );
  }

  const onSlider = (id: MacroFactorId, v: number) => {
    setShock((prev) => ({ ...prev, [id]: v }));
    setPresetId("custom");
  };
  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = PRESET_SCENARIOS.find((s) => s.id === id);
    if (p) setShock({ ...p.shock });
  };
  const reset = () => {
    setShock(zeroShock());
    setPresetId("none");
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-fg">매크로 스트레스 테스트 대상</h3>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          미국주식은 S&amp;P 500, 국내주식은 KOSPI, 채권은 미국채 10년물을 대표 지수로 사용합니다.
          포트폴리오의 다른 자산은 제외하고 이 세 자산군 비중만 100%로 재정규화합니다.
        </p>
      </div>

      {/* ── 컨트롤: 프리셋 + 슬라이더 ── */}
      <div className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">시나리오 프리셋</span>
            <select
              className="input h-9 w-auto"
              value={presetId}
              onChange={(e) => applyPreset(e.target.value)}
            >
              {presetId === "custom" && <option value="custom">사용자 설정</option>}
              {PRESET_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-ghost text-xs" onClick={reset}>
            초기화
          </button>
        </div>

        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {FACTOR_META.map((f) => {
            const v = shock[f.id];
            return (
              <div key={f.id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-sm font-medium text-fg">
                    {f.label}
                    <span className="ml-1 text-[11px] font-normal text-fg-muted">
                      {f.labelEn}
                    </span>
                  </label>
                  <span
                    className={`tabular-nums text-sm font-semibold ${
                      v === 0
                        ? "text-fg-muted"
                        : v > 0
                          ? "text-gold-600 dark:text-gold-300"
                          : "text-sky-600 dark:text-sky-300"
                    }`}
                  >
                    {fmt(v, f.step < 1 ? 2 : 0)}
                    {f.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={v}
                  onChange={(e) => onSlider(f.id, Number(e.target.value))}
                  className="w-full accent-gold-500"
                />
                <div className="mt-0.5 flex justify-between text-[10px] text-fg-muted/70">
                  <span>
                    {f.min}
                    {f.unit}
                  </span>
                  <span>
                    +{f.max}
                    {f.unit}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-tight text-fg-muted">{f.hint}</p>
              </div>
            );
          })}
        </div>
      </div>

      {!anyShock ? (
        <EmptyView
          title="요인 강도를 조정하세요"
          hint="위 슬라이더로 금리·인플레·환율·원자재 충격을 설정하거나 프리셋을 선택하면 결과가 즉시 갱신됩니다."
        />
      ) : (
        <>
          {/* ── 포트폴리오별 충격 후 예상수익·낙폭 요약 ── */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">포트폴리오</th>
                  <th className="px-3 py-2 text-right">기존 기대수익</th>
                  <th className="px-3 py-2 text-right">충격분</th>
                  <th className="px-3 py-2 text-right">충격 후 예상수익</th>
                  <th className="px-3 py-2 text-right">예상 낙폭</th>
                  <th className="px-3 py-2 text-right">VaR 95%</th>
                  <th className="px-3 py-2 text-right">CVaR 95%</th>
                  <th className="px-3 py-2 text-right">손실확률</th>
                  <th className="px-3 py-2 text-center">신뢰도</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const c = confidenceLabel(r.confidence);
                  const mc = monteCarloByPortfolio.get(r.portfolioId);
                  return (
                    <tr
                      key={r.portfolioId}
                      className={`border-b border-border/60 last:border-0 ${
                        r.portfolioId === target?.id ? "bg-gold-50/50 dark:bg-gold-900/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-medium text-fg">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                        {fmtAbs(r.baseReturn)}%
                      </td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          r.shockImpact >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-500"
                        }`}
                      >
                        {fmt(r.shockImpact)}%
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
                        {fmtAbs(r.projectedReturn)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-500">
                        −{fmtAbs(r.projectedDrawdown)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-500">
                        {mc ? `${fmt(mc.var95)}%` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-500">
                        {mc ? `${fmt(mc.cvar95)}%` : "-"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg">
                        {mc ? `${fmtAbs(mc.probabilityOfLoss, 0)}%` : "-"}
                      </td>
                      <td className={`px-3 py-2 text-center text-xs font-medium ${c.cls}`}>
                        {c.txt}
                        <span className="ml-1 text-[10px] text-fg-muted">
                          R²{(r.confidence).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-[11px] text-fg-muted">
              충격분은 설정한 요인 시나리오가 1회 발생했을 때의 단기 수익 영향(%)이며, 예상 낙폭은 충격 손실에 2σ 변동성 버퍼를 더한
              근사치입니다. 신뢰도는 자산군별 회귀모델 설명력(R²)의 비중가중 평균입니다.
            </p>
          </div>

          {/* ── 대상 포트폴리오 선택 ── */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg-muted">상세 분석 대상</span>
            <select
              className="input h-9 w-auto"
              value={target?.id}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {macroPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {targetResult && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* ── 자산군별 기여도 분해 ── */}
              <div className="card p-4">
                <h4 className="mb-1 text-sm font-semibold text-fg">자산군별 충격 기여도</h4>
                <p className="mb-3 text-[11px] text-fg-muted">
                  각 자산군의 충격 수익(%) × 비중 = 포트폴리오 수익 기여(%p)
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    layout="vertical"
                    data={targetResult.contributions.map((c) => ({
                      name: c.assetClass,
                      기여: c.contribution,
                    }))}
                    margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} strokeOpacity={0.25} />
                    <XAxis type="number" tick={{ fill: "currentColor", fontSize: 11 }} unit="%" />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={64}
                      tick={{ fill: "currentColor", fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(v: number) => [`${fmt(v, 2)}%p`, "기여도"]}
                      contentStyle={{
                        background: "rgb(var(--surface))",
                        border: "1px solid rgb(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <ReferenceLine x={0} stroke={CHART_COLORS.muted} />
                    <Bar dataKey="기여" radius={[0, 4, 4, 0]}>
                      {targetResult.contributions.map((c, i) => (
                        <Cell
                          key={i}
                          fill={c.contribution >= 0 ? CHART_COLORS.primary : "#dc2626"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-fg-muted">
                      <tr>
                        <th className="px-2 py-1 text-left">자산군</th>
                        <th className="px-2 py-1 text-right">비중</th>
                        <th className="px-2 py-1 text-right">충격 수익</th>
                        <th className="px-2 py-1 text-right">기여(%p)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {targetResult.contributions.map((c) => (
                        <tr key={c.assetClass} className="border-t border-border/50">
                          <td className="px-2 py-1 text-fg">{c.assetClass}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-fg-muted">
                            {fmtAbs(c.weight)}%
                          </td>
                          <td
                            className={`px-2 py-1 text-right tabular-nums ${
                              c.assetReturn >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-500"
                            }`}
                          >
                            {fmt(c.assetReturn)}%
                          </td>
                          <td
                            className={`px-2 py-1 text-right tabular-nums font-medium ${
                              c.contribution >= 0 ? "text-fg" : "text-red-500"
                            }`}
                          >
                            {fmt(c.contribution, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── 충격 후 비중 변화 ── */}
              <div className="card p-4">
                <h4 className="mb-1 text-sm font-semibold text-fg">충격 후 비중 변화</h4>
                <p className="mb-3 text-[11px] text-fg-muted">
                  자산군 가격 변동에 따른 비중 드리프트(리밸런싱 전)
                </p>
                <div className="space-y-2.5">
                  {targetResult.weightShifts.map((w) => (
                    <div key={w.assetClass}>
                      <div className="mb-0.5 flex items-baseline justify-between text-xs">
                        <span className="text-fg">{w.assetClass}</span>
                        <span className="tabular-nums text-fg-muted">
                          {fmtAbs(w.before)}% → {fmtAbs(w.after)}%
                          <span
                            className={`ml-1.5 font-medium ${
                              w.delta > 0
                                ? "text-emerald-600 dark:text-emerald-300"
                                : w.delta < 0
                                  ? "text-red-500"
                                  : "text-fg-muted"
                            }`}
                          >
                            ({fmt(w.delta)}%p)
                          </span>
                        </span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="absolute left-0 top-0 h-full rounded-full bg-navy-light/40"
                          style={{ width: `${Math.min(100, w.before)}%` }}
                        />
                        <div
                          className={`absolute left-0 top-0 h-full rounded-full ${
                            w.delta >= 0 ? "bg-gold-500" : "bg-red-400"
                          }`}
                          style={{ width: `${Math.min(100, w.after)}%`, opacity: 0.85 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── 스트레스 대응 조정 제안 ── */}
          {proposal && target && (
            <div className="card border-gold-300/60 p-4 dark:border-gold-700/40">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-fg">
                  스트레스 대응 조정안 — {target.label}
                </h4>
                {proposal.improvementDrawdown > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    예상 낙폭 {fmtAbs(proposal.improvementDrawdown)}%p 개선
                  </span>
                )}
              </div>
              <p className="mb-3 text-xs leading-relaxed text-fg-muted">{proposal.rationale}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-xs text-fg-muted">
                    <tr>
                      <th className="px-3 py-1.5 text-left">자산군</th>
                      <th className="px-3 py-1.5 text-right">현재 비중</th>
                      <th className="px-3 py-1.5 text-right">조정 비중</th>
                      <th className="px-3 py-1.5 text-right">변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.allocations.map((a) => {
                      const adj = proposal.allocations.find((x) => x.assetClass === a.assetClass);
                      const after = adj?.weight ?? a.weight;
                      const delta = Math.round((after - a.weight) * 10) / 10;
                      return (
                        <tr key={a.assetClass} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-1.5 text-fg">{a.assetClass}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
                            {fmtAbs(a.weight)}%
                          </td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums text-fg">
                            {fmtAbs(after)}%
                          </td>
                          <td
                            className={`px-3 py-1.5 text-right tabular-nums ${
                              delta > 0
                                ? "text-emerald-600 dark:text-emerald-300"
                                : delta < 0
                                  ? "text-red-500"
                                  : "text-fg-muted"
                            }`}
                          >
                            {delta === 0 ? "—" : `${fmt(delta)}%p`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border text-xs">
                      <td className="px-3 py-1.5 text-fg-muted">시나리오 예상수익 / 낙폭</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted" colSpan={1}>
                        {targetResult && `${fmtAbs(targetResult.projectedReturn)}% / −${fmtAbs(targetResult.projectedDrawdown)}%`}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-fg" colSpan={2}>
                        {fmtAbs(proposal.projectedReturn)}% / −{fmtAbs(proposal.projectedDrawdown)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* ── 모델 신뢰도 상세 (자산군 × 요인 t-통계량) ── */}
          {monteCarlo && (
            <div className="card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-fg">
                    몬테카를로 + CVaR tail risk 점검
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    {monteCarlo.label} 기준 {monteCarlo.simulations.toLocaleString()}회 시뮬레이션한
                    12개월 수익률 분포입니다. 스튜던트-t tail risk, 자산군 변동성, 단순 스트레스 상관 가정을 반영합니다.
                  </p>
                </div>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted">
                  95% tail risk 구간
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-border/70 p-3">
                  <p className="text-[11px] text-fg-muted">평균 수익률</p>
                  <p className={`mt-1 text-lg font-semibold tabular-nums ${monteCarlo.meanReturn >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-500"}`}>
                    {fmt(monteCarlo.meanReturn)}%
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <p className="text-[11px] text-fg-muted">VaR 95%</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-red-500">
                    {fmt(monteCarlo.var95)}%
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <p className="text-[11px] text-fg-muted">CVaR 95%</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-red-500">
                    {fmt(monteCarlo.cvar95)}%
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <p className="text-[11px] text-fg-muted">손실확률</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-fg">
                    {fmtAbs(monteCarlo.probabilityOfLoss, 0)}%
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-fg-muted">시뮬레이션 수익률 분포</p>
                    <p className="text-[11px] text-fg-muted">
                      최악 {fmt(monteCarlo.worstReturn)}% / 최고 {fmt(monteCarlo.bestReturn)}%
                    </p>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={monteCarlo.histogram} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} strokeOpacity={0.2} />
                      <XAxis dataKey="bucket" tick={{ fill: "currentColor", fontSize: 10 }} interval={1} />
                      <YAxis tick={{ fill: "currentColor", fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(v: number) => [`${v.toLocaleString()}개 경로`, "빈도"]}
                        contentStyle={{
                          background: "rgb(var(--surface))",
                          border: "1px solid rgb(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {monteCarlo.histogram.map((bucket) => (
                          <Cell
                            key={bucket.bucket}
                            fill={bucket.bucket.includes("-") || bucket.bucket.includes("<") ? "#dc2626" : CHART_COLORS.primary}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-lg border border-border/70 p-3">
                  <h5 className="text-xs font-semibold text-fg">해석 방법</h5>
                  <div className="mt-2 space-y-2 text-xs leading-relaxed text-fg-muted">
                    <p>
                      VaR 95%는 하위 5% 경계 수익률입니다. CVaR 95%는 그보다 더 나쁜 최악 5%
                      구간의 평균 수익률이므로 더 보수적인 tail risk 지표입니다.
                    </p>
                    <p>
                      -10% 이하 손실확률:{" "}
                      <span className="font-semibold tabular-nums text-fg">
                        {fmtAbs(monteCarlo.probabilityBelowMinus10)}%
                      </span>
                      . 변동성 추정치:{" "}
                      <span className="font-semibold tabular-nums text-fg">
                        {fmtAbs(monteCarlo.volatility)}%
                      </span>
                      .
                    </p>
                    <p>
                      이 값은 보장된 예측이 아니라 PB 검토를 돕는 참고 지표입니다. 선택한 시나리오 주변에서
                      가능한 손익 분포와 tail risk를 보여줘 기존 베타 기반 충격 분석을 보완합니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold text-fg">
              모델 신뢰도 상세 (회귀 추정 계수·t값)
            </summary>
            <p className="mb-3 mt-2 text-[11px] text-fg-muted">
              표본 {SAMPLE_INFO.start}~{SAMPLE_INFO.end} (월간 n={SAMPLE_INFO.n}). 각 칸은 요인 1단위 충격당 자산군 월수익 반응(%),
              괄호는 t-통계량. |t|≥1.96 (★)이면 5% 유의. R²는 모델 설명력. {SAMPLE_INFO.note}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-border text-fg-muted">
                  <tr>
                    <th className="px-2 py-1.5 text-left">자산군</th>
                    {FACTOR_META.map((f) => (
                      <th key={f.id} className="px-2 py-1.5 text-right">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right">R²</th>
                  </tr>
                </thead>
                <tbody>
                  {ASSET_SENSITIVITIES.map((s) => (
                    <tr key={s.key} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-1.5 font-medium text-fg">{s.label}</td>
                      {FACTOR_META.map((f) => {
                        const b = s.betas[f.id];
                        const t = s.tvals[f.id];
                        const sig = Math.abs(t) >= 1.96;
                        return (
                          <td
                            key={f.id}
                            className={`px-2 py-1.5 text-right tabular-nums ${
                              sig ? "text-fg" : "text-fg-muted/60"
                            }`}
                          >
                            {b.toFixed(2)}
                            <span className="ml-0.5 text-[10px]">
                              ({t.toFixed(1)}
                              {sig ? "★" : ""})
                            </span>
                          </td>
                        );
                      })}
                      <td
                        className={`px-2 py-1.5 text-right font-medium tabular-nums ${confidenceLabel(s.r2).cls}`}
                      >
                        {s.r2.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="text-[11px] leading-relaxed text-fg-muted">
            ⚠ 본 결과는 과거 데이터 기반 통계 추정치로 미래 수익을 보장하지 않으며, PB의 정성적 판단을 보조하는 참고 지표입니다.
            요인 간 상관·비선형 효과는 단순화되어 있습니다.
          </p>
        </>
      )}
    </div>
  );
}
