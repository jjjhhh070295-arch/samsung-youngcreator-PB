"use client";

import { useEffect, useState } from "react";
import PortfolioEvidenceWarning from "./PortfolioEvidenceWarning";
import { calculatePBScenario, type PBAssumptions } from "@/lib/portfolioAnalytics/pbScenario";
import { selectionToHoldings } from "@/lib/portfolioAnalytics/selection";
import {
  bondEtfSymbolKey,
  emptyBondEtfMetricOverride,
} from "@/lib/portfolioAnalytics/bondEtfSettings";
import {
  PERIODS,
  type AnalyticsResult,
  type BondEtfMetricOverride,
  type BondEtfScenarioSettings,
  type Period,
  type Rebalance,
} from "@/lib/portfolioAnalytics/types";
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

function BufferedNumberInput({
  value,
  onCommit,
  label,
  min,
  max,
  step = "any",
}: {
  value: number | null | undefined;
  onCommit: (value: number | null) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number | "any";
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    const clamped = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
    setDraft(String(clamped));
    onCommit(clamped);
  };
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="h-10 w-full rounded-md border border-border bg-white px-3 text-sm tabular-nums text-fg outline-none focus:border-[#1428A0] focus:ring-2 focus:ring-[#1428A0]/10"
    />
  );
}

const scenarioPct = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "미확보";

export default function PortfolioAnalyticsCards({
  allocation,
  selected,
  complete,
  bondEtfScenarioSettings,
  onBondEtfScenarioSettingsChange,
  onAnalyticsSnapshot,
}: {
  allocation: Parameters<typeof selectionToHoldings>[0];
  selected: Parameters<typeof selectionToHoldings>[1];
  complete: boolean;
  bondEtfScenarioSettings: BondEtfScenarioSettings;
  onBondEtfScenarioSettingsChange: (settings: BondEtfScenarioSettings) => void;
  onAnalyticsSnapshot?: (snapshot: PortfolioAnalyticsSnapshot | null) => void;
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
        holdings: selectionToHoldings(allocation, selected, bondEtfScenarioSettings),
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
        method: h.expectedReturn.method,
        source: h.expectedReturn.source,
        calculationDate: h.expectedReturn.calculationDate,
        ...(h.expectedReturn.bondScenario
          ? {
              ytmPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.ytm),
              expenseRatioPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.expenseRatio),
              effectiveDurationYears: h.expectedReturn.bondScenario.effectiveDuration,
              spreadDurationYears: h.expectedReturn.bondScenario.spreadDuration,
              rateChangeBp: h.expectedReturn.bondScenario.rateChangeBp,
              spreadChangeBp: h.expectedReturn.bondScenario.spreadChangeBp,
              carryRollPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.carryRoll),
              expenseDragPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.expenseDrag),
              ratePriceEffectPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.ratePriceEffect),
              spreadPriceEffectPct: decimalReturnToPctPoints(h.expectedReturn.bondScenario.spreadPriceEffect),
              factsAsOf: h.expectedReturn.bondScenario.factsAsOf,
              factsSourceLabel: h.expectedReturn.bondScenario.factsSourceLabel,
              factsSourceUrl: h.expectedReturn.bondScenario.factsSourceUrl,
            }
          : {}),
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

  const bondSelections = selected.filter(
    (item) => /Bond/i.test(item.assetClass) && /ETF/i.test(item.kind),
  );
  const updateScenario = (patch: Partial<BondEtfScenarioSettings>) =>
    onBondEtfScenarioSettingsChange({ ...bondEtfScenarioSettings, ...patch });
  const updateOverride = (symbol: string, patch: Partial<BondEtfMetricOverride>) => {
    const key = bondEtfSymbolKey(symbol);
    const current = bondEtfScenarioSettings.overridesBySymbol[key] ?? emptyBondEtfMetricOverride();
    updateScenario({
      overridesBySymbol: {
        ...bondEtfScenarioSettings.overridesBySymbol,
        [key]: { ...current, ...patch },
      },
    });
  };
  const clearOverride = (symbol: string) => {
    const key = bondEtfSymbolKey(symbol);
    const next = { ...bondEtfScenarioSettings.overridesBySymbol };
    delete next[key];
    updateScenario({ overridesBySymbol: next });
  };

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
      {bondSelections.length > 0 && (
        <div className="border-y border-border py-4" aria-label="채권 ETF 기대수익률 시나리오">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-fg">채권 ETF 기대수익률 시나리오</h4>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                운용사 공시 YTM과 듀레이션을 사용한 1년 근사치입니다. 기본값 0bp는 현재 금리와
                신용스프레드가 유지된다는 가정입니다.
              </p>
            </div>
            <span className="text-[11px] font-semibold text-fg-muted">단위: bp, %, 년</span>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-bold text-fg">
              시장금리 변화 (bp)
              <BufferedNumberInput
                label="시장금리 변화 bp"
                value={bondEtfScenarioSettings.rateChangeBp}
                min={-1000}
                max={1000}
                step={1}
                onCommit={(value) => updateScenario({ rateChangeBp: value ?? 0 })}
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-fg">
              신용스프레드 변화 (bp)
              <BufferedNumberInput
                label="신용스프레드 변화 bp"
                value={bondEtfScenarioSettings.spreadChangeBp}
                min={-1000}
                max={1000}
                step={1}
                onCommit={(value) => updateScenario({ spreadChangeBp: value ?? 0 })}
              />
            </label>
          </div>
          {bondEtfScenarioSettings.spreadChangeBp !== 0 && (
            <label className="mt-3 flex items-start gap-2 text-xs text-amber-800">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#1428A0]"
                checked={bondEtfScenarioSettings.allowMissingSpreadDuration}
                onChange={(event) => updateScenario({ allowMissingSpreadDuration: event.target.checked })}
              />
              스프레드 듀레이션이 없으면 신용스프레드 가격효과를 0으로 처리하는 PB 가정을 허용합니다.
              선택하지 않으면 해당 종목의 기대수익률은 산출 불가로 표시됩니다.
            </label>
          )}
          <div className="mt-4 divide-y divide-border border-y border-border">
            {bondSelections.map((item) => {
              const key = bondEtfSymbolKey(item.symbol);
              const holding = result?.holdings.find(
                (candidate) => bondEtfSymbolKey(candidate.ticker) === key,
              );
              const diagnostic = holding?.expectedReturn.bondScenario;
              const override = bondEtfScenarioSettings.overridesBySymbol[key];
              const sourceUrl = diagnostic?.factsSourceUrl && /^https?:\/\//i.test(diagnostic.factsSourceUrl)
                ? diagnostic.factsSourceUrl
                : null;
              return (
                <div key={key} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-fg">{item.name} ({item.symbol})</p>
                      {diagnostic ? (
                        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                          YTM {scenarioPct(diagnostic.ytm)} · 유효듀레이션 {diagnostic.effectiveDuration?.toFixed(2) ?? "미확보"}년 ·
                          보수 {scenarioPct(diagnostic.expenseRatio)} · 기준일 {diagnostic.factsAsOf ?? "미확보"}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-700">
                          공식 YTM 공시를 확인 중이거나 확보하지 못했습니다. 아래 PB 검증값을 사용할 수 있습니다.
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black tabular-nums text-[#1428A0]">
                        {holding?.expectedReturn.value == null ? "산출 불가" : pct(holding.expectedReturn.value)}
                      </p>
                      <p className="text-[10px] text-fg-muted">
                        {diagnostic?.sourceKind === "pb_override" ? "PB 검증값" : "운용사 공시"}
                      </p>
                    </div>
                  </div>
                  {diagnostic && (
                    <div className="mt-2 grid gap-1 text-[11px] tabular-nums text-fg-muted sm:grid-cols-2 lg:grid-cols-4">
                      <span>캐리/YTM {scenarioPct(diagnostic.carryRoll)}</span>
                      <span>보수 효과 -{scenarioPct(diagnostic.expenseDrag)}</span>
                      <span>금리 가격효과 {scenarioPct(diagnostic.ratePriceEffect)}</span>
                      <span>스프레드 가격효과 {scenarioPct(diagnostic.spreadPriceEffect)}</span>
                    </div>
                  )}
                  {(diagnostic?.factsSourceLabel || sourceUrl) && (
                    <p className="mt-2 text-[11px] text-fg-muted">
                      출처: {sourceUrl ? (
                        <a href={sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-[#1428A0] underline">
                          {diagnostic?.factsSourceLabel ?? "공식 공시"}
                        </a>
                      ) : diagnostic?.factsSourceLabel}
                    </p>
                  )}
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer font-bold text-[#1428A0]">PB 검증값 입력</summary>
                    <p className="mt-2 leading-relaxed text-fg-muted">
                      공식 조회 실패 또는 공시 교차검증이 필요한 경우에만 사용합니다. YTM, 기준일, 출처명을 모두
                      입력해야 계산에 반영됩니다.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="grid gap-1 font-bold text-fg">
                        YTM (%)
                        <BufferedNumberInput
                          label={`${item.name} YTM`}
                          value={override?.ytmPct}
                          min={-10}
                          max={100}
                          onCommit={(value) => updateOverride(item.symbol, { ytmPct: value })}
                        />
                      </label>
                      <label className="grid gap-1 font-bold text-fg">
                        유효듀레이션 (년)
                        <BufferedNumberInput
                          label={`${item.name} 유효듀레이션`}
                          value={override?.effectiveDurationYears}
                          min={0}
                          max={50}
                          onCommit={(value) => updateOverride(item.symbol, { effectiveDurationYears: value })}
                        />
                      </label>
                      <label className="grid gap-1 font-bold text-fg">
                        스프레드듀레이션 (년)
                        <BufferedNumberInput
                          label={`${item.name} 스프레드듀레이션`}
                          value={override?.spreadDurationYears}
                          min={0}
                          max={50}
                          onCommit={(value) => updateOverride(item.symbol, { spreadDurationYears: value })}
                        />
                      </label>
                      <label className="grid gap-1 font-bold text-fg">
                        총보수 (%)
                        <BufferedNumberInput
                          label={`${item.name} 총보수`}
                          value={override?.expenseRatioPct}
                          min={0}
                          max={10}
                          onCommit={(value) => updateOverride(item.symbol, { expenseRatioPct: value })}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="grid gap-1 font-bold text-fg">
                        공시 기준일
                        <input
                          type="date"
                          value={override?.asOf ?? ""}
                          onChange={(event) => updateOverride(item.symbol, { asOf: event.target.value })}
                          className="h-10 rounded-md border border-border bg-white px-3 text-sm text-fg"
                        />
                      </label>
                      <label className="grid gap-1 font-bold text-fg">
                        출처명
                        <input
                          type="text"
                          maxLength={200}
                          value={override?.sourceLabel ?? ""}
                          placeholder="예: 운용사 월간보고서"
                          onChange={(event) => updateOverride(item.symbol, { sourceLabel: event.target.value })}
                          className="h-10 rounded-md border border-border bg-white px-3 text-sm text-fg"
                        />
                      </label>
                      <label className="grid gap-1 font-bold text-fg">
                        출처 URL (선택)
                        <input
                          type="url"
                          maxLength={500}
                          value={override?.sourceUrl ?? ""}
                          placeholder="https://"
                          onChange={(event) => updateOverride(item.symbol, { sourceUrl: event.target.value })}
                          className="h-10 rounded-md border border-border bg-white px-3 text-sm text-fg"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {diagnostic && (
                        <button
                          type="button"
                          className="rounded-md border border-border bg-white px-3 py-2 text-xs font-bold text-fg"
                          onClick={() => updateOverride(item.symbol, {
                            ytmPct: diagnostic.ytm == null ? null : diagnostic.ytm * 100,
                            effectiveDurationYears: diagnostic.effectiveDuration,
                            spreadDurationYears: diagnostic.spreadDuration,
                            expenseRatioPct: diagnostic.expenseRatio == null ? null : diagnostic.expenseRatio * 100,
                            asOf: diagnostic.factsAsOf ?? "",
                            sourceLabel: diagnostic.factsSourceLabel ?? "운용사 공식 공시",
                            sourceUrl: diagnostic.factsSourceUrl ?? "",
                          })}
                        >
                          현재 공시값 복사
                        </button>
                      )}
                      {override && (
                        <button
                          type="button"
                          className="rounded-md border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700"
                          onClick={() => clearOverride(item.symbol)}
                        >
                          PB 검증값 해제
                        </button>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-muted">
            YTM은 만기까지의 보유수익을 보장하지 않으며 실제 ETF 수익은 금리·신용스프레드·구성종목 교체·추적오차·환율에 따라 달라집니다.
          </p>
        </div>
      )}
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
