"use client";

import { useEffect, useState } from "react";
import { selectionToHoldings } from "@/lib/portfolioAnalytics/selection";
import { PERIODS, type AnalyticsResult, type Period, type Rebalance } from "@/lib/portfolioAnalytics/types";

const pct = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
const METHODS: Record<string, string> = {
  fundamental: "3년 EPS·목표 PER·배당", simplified_fundamental: "단순화 펀더멘털",
  historical_cagr_fallback: "과거 CAGR 대용치", asset_class_fallback: "자산군 가정값",
  cash_assumption: "대기 현금 가정", ytm: "만기수익률", sec_yield: "SEC 수익률", distribution_yield: "분배 수익률",
};
const REBALANCE_LABELS: Array<[Rebalance, string]> = [["none", "리밸런싱 없음"], ["monthly", "매월"], ["quarterly", "분기"], ["semiannual", "반기"], ["annual", "매년"]];

export default function PortfolioAnalyticsCards({ allocation, selected, complete }: {
  allocation: Parameters<typeof selectionToHoldings>[0]; selected: Parameters<typeof selectionToHoldings>[1]; complete: boolean;
}) {
  const [years, setYears] = useState<Period>(5);
  const [rebalance, setRebalance] = useState<Rebalance>("quarterly");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; result?: AnalyticsResult; error?: string }>({ key: "" });
  let selectionError = "", requestKey = "";
  try {
    if (complete) requestKey = JSON.stringify({ holdings: selectionToHoldings(allocation, selected), options: { years, rebalance, baseCurrency: "KRW" } });
  } catch (error) { selectionError = error instanceof Error ? error.message : "종목 구성을 확인하세요."; }
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/portfolio/analytics", { method: "POST", headers: { "content-type": "application/json" }, body: requestKey, signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "분석에 실패했습니다.");
        if (!controller.signal.aborted) setState({ key: requestKey, result: body.result });
      } catch (error) {
        if (!controller.signal.aborted) setState({ key: requestKey, error: error instanceof Error ? error.message : "분석에 실패했습니다." });
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, retry]);
  const current = state.key === requestKey && requestKey ? state : null;
  const result = current?.result;
  const period = result?.portfolio.analysisPeriod;
  const historicalLabel = period && period.years < years - 0.05 ? `과거 ${period.years.toFixed(1)}년 (요청 ${years}Y)` : `과거 ${years}Y`;
  const cards = [
    ["연 기대수익률", result?.portfolio.expectedReturn, "종목별 추정치의 비중 가중합. 아래 산출방식에서 대용치·가정을 확인하세요."],
    [`${historicalLabel} CAGR`, result?.portfolio.historicalCAGR, "과거 데이터 기반 수익률이며 미래 성과를 의미하지 않습니다."],
    [`${historicalLabel} MDD`, result?.portfolio.mdd, "전체 포트폴리오 NAV의 최대 고점 대비 하락률"],
    ["연환산 변동성", result?.portfolio.annualizedVolatility, "포트폴리오 관측 수익률의 표본 표준편차 × √252"],
  ] as const;
  return <section className="space-y-3 rounded-2xl border border-border bg-white p-4 md:p-5" aria-label="포트폴리오 분석">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-black text-fg">포트폴리오 분석 · KRW</h3>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-fg-muted">분석기간 <select aria-label="분석기간" className="rounded-lg border border-border p-2 text-fg" value={years} onChange={e => setYears(Number(e.target.value) as Period)}>{PERIODS.map(p => <option key={p} value={p}>{p}Y</option>)}</select></label>
        <label className="text-xs text-fg-muted">리밸런싱 <select aria-label="리밸런싱 방식" className="rounded-lg border border-border p-2 text-fg" value={rebalance} onChange={e => setRebalance(e.target.value as Rebalance)}>{REBALANCE_LABELS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      </div>
    </div>
    {!complete ? <p className="text-xs text-amber-700">자산군과 각 자산군 내 종목 비중을 모두 100%로 완성하면 분석합니다.</p>
      : selectionError ? <p role="alert" className="text-xs text-amber-700">{selectionError}</p>
      : !current ? <p role="status" className="text-xs text-fg-muted">가격·환율 데이터를 확인하고 분석 중입니다…</p>
      : current.error ? <p role="alert" className="text-xs text-rose-700">{current.error} <button type="button" className="underline" onClick={() => { setState({ key: "" }); setRetry(v => v + 1); }}>다시 시도</button></p> : null}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map(([label, value, info]) => <div key={label} className="rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs font-bold text-fg-muted">{label} <button type="button" title={info} aria-label={info} className="rounded-full px-1 text-[#1428A0]">ⓘ</button></p>
        <p className="mt-2 text-2xl font-black text-[#1428A0]">{pct(value)}</p>
      </div>)}
    </div>
    <p className="text-[11px] text-fg-muted">과거 데이터 기반 수익률이며 미래 성과를 의미하지 않습니다.</p>
    {result && <>
      {period && <p className="text-[11px] text-fg-muted">실제 분석: {period.start} ~ {period.end} · {result.portfolio.fxApplied ? "USD/KRW 환율 반영" : result.holdings.some(h => h.currency !== "KRW") ? "환율 미반영: 경고 확인" : "원화 자산"}</p>}
      <details className="rounded-lg border border-border p-3 text-xs">
        <summary className="cursor-pointer font-bold">기대수익률 산출방식·신뢰도 확인</summary>
        <div className="mt-3 space-y-3">{result.holdings.map((h, i) => <div key={`${h.ticker}-${i}`} className="border-t border-border pt-2">
          <p className="font-bold">{h.name} ({h.ticker}) · {pct(h.weight)} · 연 {pct(h.expectedReturn.value)}</p>
          <p>{METHODS[h.expectedReturn.method] ?? h.expectedReturn.method} · 신뢰도 {h.expectedReturn.confidence === "medium" ? "중간" : "낮음"} · 기여도 {pct(h.contributionToExpectedReturn)}p</p>
          <p className="mt-1 text-fg-muted">{h.expectedReturn.assumptions.join(" · ")}</p>
          <p className="mt-1 break-words text-fg-muted">출처: {h.expectedReturn.source.join(", ")} · 계산일 {h.expectedReturn.calculationDate}</p>
        </div>)}</div>
      </details>
      {result.drawdown && result.drawdown.mdd < 0 && <details className="text-xs text-fg-muted"><summary className="cursor-pointer">최대 낙폭 기간</summary><p className="mt-2">고점 {result.drawdown.peakDate} → 저점 {result.drawdown.troughDate} · {result.drawdown.recoveryDate ? `회복 ${result.drawdown.recoveryDate} (고점 이후 ${result.drawdown.recoveryDays}일)` : "분석 종료일까지 미회복"}</p></details>}
      {result.warnings.length > 0 && <details open className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><summary className="cursor-pointer font-bold">데이터·분석 가정 ({result.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-4">{result.warnings.map((w, i) => <li key={i}>{w.ticker ? `${w.ticker}: ` : ""}{w.message}</li>)}</ul></details>}
    </>}
  </section>;
}
