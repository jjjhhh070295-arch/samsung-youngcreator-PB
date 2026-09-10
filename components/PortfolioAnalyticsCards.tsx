"use client";

import { useEffect, useState } from "react";
import PortfolioEvidenceWarning from "./PortfolioEvidenceWarning";
import { calculatePBScenario, type PBAssumptions } from "@/lib/portfolioAnalytics/pbScenario";
import { selectionToHoldings } from "@/lib/portfolioAnalytics/selection";
import { PERIODS, type AnalyticsResult, type Period, type Rebalance } from "@/lib/portfolioAnalytics/types";
import {
  decimalReturnToPctPoints,
  type PortfolioAnalyticsSnapshot,
} from "@/lib/returnAssumptions";

const pct = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
const REBALANCE_LABELS: Array<[Rebalance, string]> = [
  ["none", "리밸런싱 없음"],
  ["monthly", "매월"],
  ["quarterly", "분기"],
  ["semiannual", "반기"],
  ["annual", "매년"],
];

export default function PortfolioAnalyticsCards({
  allocation,
  selected,
  complete,
  onAnalyticsSnapshot,
  evidencePromptEnabled = true,
}: {
  allocation: Parameters<typeof selectionToHoldings>[0];
  selected: Parameters<typeof selectionToHoldings>[1];
  complete: boolean;
  onAnalyticsSnapshot?: (snapshot: PortfolioAnalyticsSnapshot | null) => void;
  /** 근거 부족 모달 자동 오픈 여부. 카드는 단계와 무관하게 붙어 있어 분석은 미리 돌지만,
   *  모달은 PB 가 종목을 고르는 단계부터만 띄운다. */
  evidencePromptEnabled?: boolean;
}) {
  const [years, setYears] = useState<Period>(5);
  const [rebalance, setRebalance] = useState<Rebalance>("quarterly");
  const [retry, setRetry] = useState(0);
  const [pbAssumptions, setPBAssumptions] = useState<PBAssumptions>({});
  const [state, setState] = useState<{ key: string; result?: AnalyticsResult; error?: string }>({
    key: "",
  });
  let selectionError = "";
  let requestKey = "";
  try {
    if (complete) {
      requestKey = JSON.stringify({
        holdings: selectionToHoldings(allocation, selected),
        options: { years, rebalance, baseCurrency: "KRW" },
      });
    }
  } catch (error) {
    selectionError = error instanceof Error ? error.message : "종목 구성을 확인하세요.";
  }
  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/portfolio/analytics", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestKey,
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error || "분석에 실패했습니다.");
        if (!controller.signal.aborted) setState({ key: requestKey, result: body.result });
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            key: requestKey,
            error: error instanceof Error ? error.message : "분석에 실패했습니다.",
          });
        }
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, retry]);

  const current = state.key === requestKey && requestKey ? state : null;
  const result = current?.result;
  const scenario =
    result && Object.keys(pbAssumptions).length ? calculatePBScenario(result, pbAssumptions) : null;
  const effectiveExpectedReturn = scenario?.value ?? result?.portfolio.expectedReturn;
  const effectiveRisk = result?.portfolio.annualizedVolatility ?? null;
  const period = result?.portfolio.analysisPeriod;
  const historicalLabel =
    period && period.years < years - 0.05
      ? `과거 ${period.years.toFixed(1)}년 (요청 ${years}Y)`
      : `과거 ${years}Y`;

  useEffect(() => {
    if (!onAnalyticsSnapshot) return;
    if (!complete || !requestKey) {
      onAnalyticsSnapshot(null);
      return;
    }
    if (!result) return;
    const instrumentAssumptionsPct: PortfolioAnalyticsSnapshot["instrumentAssumptionsPct"] = {};
    for (const h of result.holdings) {
      const dec =
        scenario?.holdings.find((x) => x.ticker === h.ticker)?.scenarioValue ??
        h.expectedReturn.value;
      const pctPts = decimalReturnToPctPoints(dec);
      if (pctPts == null) continue;
      instrumentAssumptionsPct[h.ticker] = {
        totalReturnPct: pctPts,
        returnBasis: "total_return",
      };
    }
    onAnalyticsSnapshot({
      compositionKey: requestKey,
      asOf: new Date().toISOString(),
      expectedReturnDecimal:
        effectiveExpectedReturn != null && Number.isFinite(effectiveExpectedReturn)
          ? effectiveExpectedReturn
          : null,
      expectedRiskDecimal:
        effectiveRisk != null && Number.isFinite(effectiveRisk) ? effectiveRisk : null,
      returnStatus:
        effectiveExpectedReturn != null && Number.isFinite(effectiveExpectedReturn)
          ? "ok"
          : "unavailable",
      riskStatus: effectiveRisk != null && Number.isFinite(effectiveRisk) ? "ok" : "unavailable",
      portfolioReturnBasis: "total_return",
      instrumentAssumptionsPct,
    });
  }, [
    complete,
    requestKey,
    result,
    scenario,
    effectiveExpectedReturn,
    effectiveRisk,
    onAnalyticsSnapshot,
  ]);

  const cards = [
    [
      "연 기대수익률",
      effectiveExpectedReturn,
      scenario?.value != null
        ? "시장 데이터와 PB 입력 가정을 전체 비중으로 가중한 값"
        : "종목별 추정치의 비중 가중합",
    ],
    [
      `${historicalLabel} CAGR`,
      result?.portfolio.historicalCAGR,
      "과거 데이터 기반 수익률이며 미래 성과를 의미하지 않습니다.",
    ],
    [`${historicalLabel} MDD`, result?.portfolio.mdd, "전체 포트폴리오 NAV의 최대 고점 대비 하락률"],
    [
      "연환산 변동성",
      result?.portfolio.annualizedVolatility,
      "포트폴리오 관측 수익률의 표본 표준편차 × √252",
    ],
  ] as const;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-white p-4 md:p-5" aria-label="포트폴리오 분석">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-black text-fg">포트폴리오 분석 · KRW</h3>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs text-fg-muted">
            분석기간{" "}
            <select
              aria-label="분석기간"
              className="rounded-lg border border-border p-2 text-fg"
              value={years}
              onChange={(e) => setYears(Number(e.target.value) as Period)}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {p}Y
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted">
            리밸런싱{" "}
            <select
              aria-label="리밸런싱 방식"
              className="rounded-lg border border-border p-2 text-fg"
              value={rebalance}
              onChange={(e) => setRebalance(e.target.value as Rebalance)}
            >
              {REBALANCE_LABELS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {!complete ? (
        <p className="text-xs text-amber-700">
          자산군과 각 자산군 내 종목 비중을 모두 100%로 완성하면 분석합니다.
        </p>
      ) : selectionError ? (
        <p role="alert" className="text-xs text-amber-700">
          {selectionError}
        </p>
      ) : !current ? (
        <p role="status" className="text-xs text-fg-muted">
          가격·환율 데이터를 확인하고 분석 중입니다…
        </p>
      ) : current.error ? (
        <p role="alert" className="text-xs text-rose-700">
          {current.error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setState({ key: "" });
              setRetry((v) => v + 1);
            }}
          >
            다시 시도
          </button>
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([label, value, info]) => (
          <div key={label} className="min-w-0 rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs font-bold text-fg-muted">
              {label}{" "}
              <button type="button" title={info} aria-label={info} className="rounded-full px-1 text-[#1428A0]">
                ⓘ
              </button>
            </p>
            <p className="mt-2 break-words text-xl font-black tabular-nums text-[#1428A0] sm:text-2xl">
              {label === "연 기대수익률" && result && value == null ? "산출 불가" : pct(value)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-fg-muted">
        과거 데이터 기반 수익률이며 미래 성과를 의미하지 않습니다.
      </p>
      {result && (
        <>
          {result.holdings.some((h) => h.expectedReturn.value == null) && (
            <PortfolioEvidenceWarning
              holdings={result.holdings.filter((h) => h.expectedReturn.value == null)}
              coverage={result.portfolio.expectedReturnCoverage}
              assumptions={pbAssumptions}
              onApply={setPBAssumptions}
              promptEnabled={evidencePromptEnabled}
            />
          )}
          {scenario && scenario.assumedWeight > 0 && (
            <div
              className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"
              aria-label="PB 입력 근거와 경고"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-black text-amber-900">PB 입력 근거 · 적용 경고</h4>
                <button type="button" className="text-xs underline" onClick={() => setPBAssumptions({})}>
                  PB 입력값 해제
                </button>
              </div>
              <p className="text-xs text-amber-900">
                메인 기대수익률에 전체 비중 중 {pct(scenario.assumedWeight)}의 PB 입력값을 반영했습니다.
                PB 판단에 따른 가정이며 검증된 시장 전망이나 보장 수익률이 아닙니다.
              </p>
              {scenario.missing.length > 0 && (
                <p className="text-xs text-amber-800">
                  가정 미입력: {scenario.missing.map((h) => h.name).join(", ")} — 모든 근거 부족 종목을
                  입력해야 전체 시나리오를 계산합니다.
                </p>
              )}
              {scenario.holdings
                .filter((h) => h.assumption)
                .map((h, i) => (
                  <div key={`${h.ticker}-${i}`} className="border-t border-blue-200 pt-2 text-xs">
                    <p className="font-bold">
                      {h.name} ({h.ticker}) · PB 가정 {pct(h.scenarioValue)} · 비중 {pct(h.weight)} ·
                      기여도 {pct(h.contribution)}p
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">근거: {h.assumption!.reason}</p>
                    <p className="mt-1">
                      출처: PB 직접 입력 · 입력일{" "}
                      {new Date(h.assumption!.calculationDate).toLocaleString("ko-KR")}
                    </p>
                  </div>
                ))}
              <p className="text-xs font-semibold text-amber-900">
                MDD·변동성은 기대수익률 가정으로 만들지 않고 실제 가격 이력으로 계산합니다. 가격 이력이
                부족하면 해당 지표는 표시하지 않습니다.
              </p>
            </div>
          )}
          {period && (
            <p className="text-[11px] text-fg-muted">
              실제 분석: {period.start} ~ {period.end} ·{" "}
              {result.portfolio.fxApplied
                ? "USD/KRW 환율 반영"
                : result.holdings.some((h) => h.currency !== "KRW")
                  ? "환율 미반영: 경고 확인"
                  : "원화 자산"}
            </p>
          )}
          {result.drawdown && result.drawdown.mdd < 0 && (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer">최대 낙폭 기간</summary>
              <p className="mt-2">
                고점 {result.drawdown.peakDate} → 저점 {result.drawdown.troughDate} ·{" "}
                {result.drawdown.recoveryDate
                  ? `회복 ${result.drawdown.recoveryDate} (고점 이후 ${result.drawdown.recoveryDays}일)`
                  : "분석 종료일까지 미회복"}
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
