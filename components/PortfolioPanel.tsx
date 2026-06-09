'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Client, Portfolio } from '@/lib/types';
import {
  buildPortfolioViewModel,
  calculateSimulatedMetrics,
  type PortfolioOption,
} from '@/lib/portfolio';
import {
  FALLBACK_MARKET_RESEARCH,
  type MarketResearchItem,
  type ResearchSignal,
} from '@/lib/portfolioResearch';
import { listPbs } from '@/lib/store';

interface PortfolioPanelProps {
  client: Client;
  pbId: string;
  clientId: string;
  onSelectionChange?: (portfolio: Portfolio) => void;
}

type WeightKey = keyof PortfolioOption['weights'];

// 리서치 분석 캐시(/api/research/signals)에서 읽어올 신호 형태
type AnalyzedReportSignal = { signal: string; direction: -1 | 0 | 1; strength: number; evidence: string };
type AnalyzedReport = { summary: string; signals: AnalyzedReportSignal[]; model?: string };

const RESEARCH_SIGNAL_KO: Record<string, string> = {
  equity: '주식',
  bond: '채권',
  liquidity: '현금성',
  dollar: '달러',
  gold: '금/원자재',
  risk: '위험관리',
  tax: '세금',
};

function SignalChip({ s }: { s: AnalyzedReportSignal }) {
  const arrow = s.direction > 0 ? '▲' : s.direction < 0 ? '▼' : '·';
  const cls =
    s.direction > 0
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : s.direction < 0
        ? 'bg-rose-50 text-rose-700 border-rose-200'
        : 'bg-slate-50 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`} title={s.evidence}>
      {RESEARCH_SIGNAL_KO[s.signal] ?? s.signal} {arrow}
      {s.strength}
    </span>
  );
}

const STRESS_ASSET_MAP: Record<WeightKey, string> = {
  etf: '해외주식',
  bond: '채권',
  els: '대체투자',
  mmf: '현금',
  gold: '대체투자',
  dollar: '현금',
  raw: '대체투자',
};

const weightLabels: Record<WeightKey, string> = {
  etf: '주식 / ETF',
  bond: '채권 인컴',
  els: 'ELS/ELB',
  mmf: 'MMF/RP',
  gold: '금',
  dollar: '달러',
  raw: '원자재',
};

const barColors: Record<WeightKey, string> = {
  etf: 'bg-blue-600',
  bond: 'bg-sky-500',
  els: 'bg-amber-500',
  mmf: 'bg-indigo-600',
  gold: 'bg-yellow-500',
  dollar: 'bg-slate-600',
  raw: 'bg-stone-500',
};

const optionProfiles: Record<
  PortfolioOption['id'],
  {
    emphasis: string;
    signals: ResearchSignal[];
    allocationLogic: string;
    clientMessage: string;
  }
> = {
  stable: {
    emphasis: '세금 납부일과 단기 현금화 가능성을 먼저 방어하는 안정형 안입니다.',
    signals: ['bond', 'liquidity', 'risk', 'dollar', 'gold'],
    allocationLogic: '채권·MMF/RP·달러성 현금 버킷을 우선 배치하고 주식/ETF는 변동성 관리 범위 안에서 제한했습니다.',
    clientMessage: '세금 납부와 대규모 유출 가능성을 먼저 막아 두고, 잔여 자금으로 낮은 변동성의 인컴을 쌓는 구조입니다.',
  },
  balanced: {
    emphasis: '성장 기회와 유동성 방어를 함께 가져가는 균형형 안입니다.',
    signals: ['equity', 'bond', 'liquidity', 'risk'],
    allocationLogic: '주식/ETF 신호를 반영하되 채권과 MMF/RP를 함께 둬 고객 현금흐름의 흔들림을 줄였습니다.',
    clientMessage: '시장 참여 기회는 확보하되 세금·현금흐름 일정 때문에 한쪽으로 과하게 치우치지 않게 설계했습니다.',
  },
  growth: {
    emphasis: 'AI·반도체·글로벌 주식 신호를 더 적극적으로 반영하는 수익추구형 안입니다.',
    signals: ['equity', 'risk', 'dollar', 'gold'],
    allocationLogic: 'ETF 성장자산 비중을 높이고, 변동성 확대 리포트를 감안해 달러·금 헤지를 최소 완충 장치로 남겼습니다.',
    clientMessage: '고객이 더 높은 변동성을 감내할 수 있을 때 성장 테마 참여도를 높이되, 현금화 재원은 별도 분리합니다.',
  },
};

const formatWonShort = (won: number) => {
  const abs = Math.abs(won);
  const sign = won < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${Math.round((abs / 100_000_000) * 10) / 10}억원`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

function getStatusClass(status: string) {
  switch (status) {
    case '적합':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case '주의':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case '비추천':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
}

export default function PortfolioPanel({ client, pbId, clientId, onSelectionChange }: PortfolioPanelProps) {
  const [researchItems, setResearchItems] = useState<MarketResearchItem[]>(FALLBACK_MARKET_RESEARCH);
  const [researchStatus, setResearchStatus] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [fallbackUsed, setFallbackUsed] = useState(false);
  // 리포트별 LLM 분석(요약·신호) — id로 매칭해 리서치 카드에 인라인 표시
  const [analyzedById, setAnalyzedById] = useState<Record<string, AnalyzedReport>>({});
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  // 담당 PB 이름 (헤더에 UUID 대신 이름 표시)
  const [pbName, setPbName] = useState<string>('');
  const [selectedBase, setSelectedBase] = useState<PortfolioOption['id']>('balanced');
  const [weights, setWeights] = useState<PortfolioOption['weights']>(FALLBACK_MARKET_RESEARCH.length ? {
    etf: 35,
    bond: 35,
    els: 10,
    mmf: 10,
    gold: 5,
    dollar: 5,
    raw: 0,
  } : {
    etf: 35,
    bond: 35,
    els: 10,
    mmf: 10,
    gold: 5,
    dollar: 5,
    raw: 0,
  });
  const [elsIncluded, setElsIncluded] = useState(true);
  const [liquidityAmount, setLiquidityAmount] = useState(5000);
  const [isSuitabilityOpen, setIsSuitabilityOpen] = useState(false);
  const [hasManualEdit, setHasManualEdit] = useState(false);

  const model = useMemo(() => buildPortfolioViewModel(client, researchItems), [client, researchItems]);
  const portfolioOptions = model.portfolioOptions;

  useEffect(() => {
    let cancelled = false;

    async function loadResearch() {
      try {
        const res = await fetch('/api/research', { cache: 'no-store' });
        if (!res.ok) throw new Error('research api failed');
        const data = await res.json();
        if (!cancelled && Array.isArray(data.items) && data.items.length > 0) {
          setResearchItems(data.items);
          setFallbackUsed(Boolean(data.fallbackUsed));
          setResearchStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setResearchItems(FALLBACK_MARKET_RESEARCH);
          setFallbackUsed(true);
          setResearchStatus('fallback');
        }
      }
    }

    loadResearch();
    return () => {
      cancelled = true;
    };
  }, []);

  // 리포트별 분석(요약·신호) 캐시 로드 — 제목만 보이던 리스트에 요약을 붙인다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/research/signals', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.reports)) return;
        const map: Record<string, AnalyzedReport> = {};
        for (const r of data.reports) {
          map[r.id] = { summary: r.summary ?? '', signals: r.signals ?? [], model: r.model };
        }
        setAnalyzedById(map);
      } catch {
        /* 분석 캐시 없으면 제목만 표시(기존 동작) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 담당 PB 이름 조회 — 헤더에 UUID 대신 이름 표시
  useEffect(() => {
    const id = client.assignedPbId || pbId;
    if (!id) return;
    let cancelled = false;
    listPbs()
      .then((pbs) => {
        if (cancelled) return;
        const pb = pbs.find((p) => p.id === id);
        if (pb) setPbName(pb.name);
      })
      .catch(() => {
        /* 조회 실패 시 헤더는 '-'로 폴백 */
      });
    return () => {
      cancelled = true;
    };
  }, [client.assignedPbId, pbId]);

  useEffect(() => {
    if (hasManualEdit) return;
    const target = portfolioOptions.find((option) => option.id === model.recommendedId) ?? portfolioOptions[1];
    setSelectedBase(target.id);
    setWeights({ ...target.weights });
    setElsIncluded(target.weights.els > 0);
    setLiquidityAmount(model.liquidityReserveManwon);
  }, [hasManualEdit, model.liquidityReserveManwon, model.recommendedId, portfolioOptions]);

  const adjustedWeights = useMemo(() => {
    const next = { ...weights };
    if (!elsIncluded) next.els = 0;
    return next;
  }, [elsIncluded, weights]);

  const metrics = useMemo(() => calculateSimulatedMetrics(adjustedWeights), [adjustedWeights]);
  const totalWeight = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
  const weightDiff = 100 - totalWeight;
  const selectedOption = portfolioOptions.find((option) => option.id === selectedBase) ?? portfolioOptions[1];
  const currentPortfolioName = selectedOption?.name || '';
  const selectedProfile = optionProfiles[selectedBase];
  const selectedResearchItems = useMemo(() => {
    const focused = model.researchItems.filter((item) =>
      item.signals.some((signal) => selectedProfile.signals.includes(signal)),
    );
    const fallback = model.researchItems.filter((item) => !focused.some((focusedItem) => focusedItem.id === item.id));
    return [...focused, ...fallback].slice(0, 6);
  }, [model.researchItems, selectedProfile.signals]);
  const selectedSignalScores = useMemo(() => {
    const focused = model.researchSignals.filter((signal) => selectedProfile.signals.includes(signal.signal));
    return focused.length > 0 ? focused : model.researchSignals.slice(0, 4);
  }, [model.researchSignals, selectedProfile.signals]);
  const selectedSourceSummary = selectedResearchItems
    .slice(0, 3)
    .map((item) => `${item.source} '${item.title}'`)
    .join(', ');
  const selectedMarketRationale = `${currentPortfolioName}은 ${selectedProfile.emphasis} ${selectedSourceSummary || '최신 리서치'}를 근거로 ${selectedProfile.allocationLogic}`;
  // 시장 리포트 근거를 리포트별로 분리 (요약/근거를 불릿으로 표시)
  const marketReportReasons = useMemo(
    () =>
      selectedResearchItems.slice(0, 4).map((item) => {
        const a = analyzedById[item.id];
        const reason =
          (a?.summary && a.summary.trim()) ||
          a?.signals?.[0]?.evidence ||
          item.excerpt ||
          '최신 리서치를 반영했습니다.';
        return { id: item.id, title: item.title, source: item.source, reason };
      }),
    [selectedResearchItems, analyzedById],
  );
  const selectedExecutiveConclusion = `${currentPortfolioName} 조율안입니다. ${selectedProfile.clientMessage} 최신 리서치, 고객 현금흐름${model.preferenceProfile.hasRequirement ? ', 고유 요구조건' : ''}을 같이 반영해 현재 비중을 산출했습니다.`;

  useEffect(() => {
    if (!onSelectionChange) return;
    const aggregated: Record<string, number> = {};

    (Object.entries(adjustedWeights) as Array<[WeightKey, number]>).forEach(([asset, weight]) => {
      if (weight <= 0) return;
      const assetClass = STRESS_ASSET_MAP[asset] ?? weightLabels[asset];
      aggregated[assetClass] = (aggregated[assetClass] ?? 0) + weight;
    });

    const allocations = Object.entries(aggregated).map(([assetClass, weight]) => ({
      assetClass,
      weight: Math.round(weight * 10) / 10,
    }));

    onSelectionChange({
      id: selectedBase,
      label: selectedOption.name,
      allocations,
      expectedReturn: metrics.expectedReturn,
      expectedRisk: metrics.volatility,
      taxNote: model.rationale.tax,
      rationale: [
        selectedMarketRationale,
        model.rationale.client,
        model.rationale.cashflow,
        model.rationale.preference,
        model.rationale.unique,
      ].join(' '),
      editedByPb: true,
    });
  }, [
    adjustedWeights,
    metrics,
    model.rationale,
    onSelectionChange,
    selectedBase,
    selectedMarketRationale,
    selectedOption.name,
  ]);

  const handleBaseChange = (type: PortfolioOption['id']) => {
    const target = portfolioOptions.find((option) => option.id === type);
    if (!target) return;
    setHasManualEdit(true);
    setSelectedBase(type);
    setWeights({ ...target.weights });
    setElsIncluded(target.weights.els > 0);
  };

  const handleWeightChange = (asset: WeightKey, value: number) => {
    const sanitizedValue = Math.max(0, Math.min(100, Number.isNaN(value) ? 0 : value));
    setHasManualEdit(true);
    setWeights((prev) => ({
      ...prev,
      [asset]: sanitizedValue,
    }));
  };

  return (
    <div className="space-y-6 rounded-2xl bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-slate-900 p-5 text-white shadow-sm md:flex-row md:items-center">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
            Samsung Securities Young Creator PB Center
          </span>
          <h1 className="mt-1 text-xl font-bold tracking-tight">VIP 맞춤형 자산배분 제안 시스템</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
            최신 리서치 최대 20개와 고객의 7요인, 현금흐름, 세금 납부 일정을 함께 반영합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5">
            담당 PB {pbName || '-'}
          </span>
          <span className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5">
            {client.code || clientId} · {client.name}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-6 text-white">
          <div className="flex flex-col gap-4 border-b border-slate-700/60 pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
                Recommended Conclusion
              </span>
              <h2 className="mt-2 text-2xl font-black">{currentPortfolioName} 조율안</h2>
              <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-300">
                {selectedExecutiveConclusion}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 md:max-w-xs md:justify-end">
              <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200">
                #{model.clientSummary.clientType}
              </span>
              <span className="rounded-md border border-blue-500/30 bg-blue-500/20 px-2 py-1 text-[11px] font-bold text-blue-200">
                #{model.clientSummary.riskPropensity}
              </span>
              <span className="rounded-md border border-rose-500/30 bg-rose-500/20 px-2 py-1 text-[11px] font-bold text-rose-200">
                #세금민감도 {model.clientSummary.taxSensitivity}
              </span>
              <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200">
                #유동성 {model.clientSummary.liquidityNeed}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-5 md:grid-cols-4">
            <MetricCard label="예상 수익률" value={`${metrics.expectedReturn}%`} tone="emerald" />
            <MetricCard label="세후 가상수익률" value={`${metrics.taxReturn}%`} tone="blue" />
            <MetricCard label="포트폴리오 변동성" value={`${metrics.volatility}%`} tone="slate" />
            <MetricCard label="시뮬레이션 MDD" value={`${metrics.mdd}%`} tone="rose" />
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
            <h3 className="text-base font-bold text-slate-800">고객 고유 요구조건 반영</h3>
          </div>
          <span className="text-[11px] font-medium text-slate-400">
            고유상황 입력값 자동 해석
          </span>
        </div>

        {model.preferenceProfile.hasRequirement ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 lg:col-span-2">
              <p className="text-xs font-bold text-rose-800">감지된 요구조건</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {model.preferenceProfile.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-rose-900">{model.rationale.preference}</p>
              {model.preferenceProfile.rawText && (
                <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-slate-500">
                  입력 문장: {model.preferenceProfile.rawText}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-bold text-amber-800">PB 확인 필요</p>
              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-900">
                {model.preferenceProfile.warnings.length > 0 ? (
                  model.preferenceProfile.warnings.map((warning) => <li key={warning}>• {warning}</li>)
                ) : (
                  <li>• 요구조건과 적합성·현금화 일정의 충돌 여부를 상담에서 최종 확인하세요.</li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
            고유상황에 “해외주식 단일종목만”, “기대수익률 20% 이상”처럼 명시된 요구가 있으면 이 영역에 자동 표시되고 포트폴리오 비중과 근거에 반영됩니다.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
            <h3 className="text-base font-bold text-slate-800">현재 포트폴리오 자산 비중 프리뷰</h3>
          </div>
          <div className="space-y-3">
            {(Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
              .filter(([, weight]) => weight > 0)
              .map(([asset, weight]) => (
                <div key={asset}>
                  <div className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
                    <span>{weightLabels[asset]}</span>
                    <span>{weight}%</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`${barColors[asset]} h-full rounded-full transition-all`}
                      style={{ width: `${Math.min(100, weight)}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
            현금흐름표에서 저장된 세금성 유출은 MMF/RP와 채권 버킷의 최소 비중을 높이는 근거로 사용됩니다.
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
              <h3 className="text-base font-bold text-slate-800">선택안별 리서치 반영 상태</h3>
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              {researchStatus === 'loading'
                ? '업데이트 확인 중'
                : fallbackUsed
                  ? '일부 출처 fallback 포함'
                  : '실시간 추출 완료'}
            </span>
          </div>

          <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900">
            {currentPortfolioName} 기준: {selectedProfile.emphasis}
          </p>

          <div className="grid grid-cols-2 gap-2">
            {selectedSignalScores.slice(0, 4).map((signal) => (
              <div key={signal.signal} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <span className="block text-[11px] font-semibold text-slate-500">{signal.label}</span>
                <span className="mt-1 block text-lg font-black text-slate-800">{signal.score}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {selectedResearchItems.map((item) => {
              const analyzed = analyzedById[item.id];
              const isOpen = openReportId === item.id;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-100 text-xs transition hover:border-blue-200"
                >
                  <button
                    type="button"
                    onClick={() => setOpenReportId(isOpen ? null : item.id)}
                    className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50/40"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-slate-700">{item.title}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-400">
                        {item.source}
                        {item.date ? ` · ${item.date}` : ''}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-[11px] text-slate-400">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 px-3 py-2.5">
                      {analyzed?.summary ? (
                        <p className="text-[11px] leading-relaxed text-slate-600">{analyzed.summary}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-slate-400">
                          본문 요약 미생성 — 사이드바 ‘리서치 분석’에서 [실패만 재분석]을 누르면 요약이 채워집니다.
                        </p>
                      )}
                      {analyzed?.signals && analyzed.signals.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {analyzed.signals.map((s, i) => (
                            <SignalChip key={i} s={s} />
                          ))}
                        </div>
                      )}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-[11px] font-medium text-blue-600 underline hover:text-blue-700"
                      >
                        원문 ↗
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
          <h3 className="text-base font-bold text-slate-800">추천 포트폴리오 3개안 비교</h3>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {portfolioOptions.map((option) => {
            const isSelected = selectedBase === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleBaseChange(option.id)}
                className={`rounded-2xl border p-5 text-left transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/30 shadow-md ring-4 ring-blue-50'
                    : 'border-slate-200 bg-white opacity-75 hover:border-slate-300 hover:opacity-100'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-800">{option.name}</h4>
                  {isSelected && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      Active
                    </span>
                  )}
                </div>
                <table className="mb-3 w-full text-xs">
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 text-slate-400">기대수익률</td>
                      <td className="py-1 text-right font-bold text-emerald-600">{option.expectedReturn}%</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-1 text-slate-400">세후수익률</td>
                      <td className="py-1 text-right font-bold text-blue-600">{option.taxReturn}%</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-400">최대낙폭</td>
                      <td className="py-1 text-right font-medium text-rose-500">{option.mdd}%</td>
                    </tr>
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-1">
                  {option.mainProducts.map((product) => (
                    <span key={product} className="rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                      {product}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600"></span>
          <h3 className="text-base font-bold text-slate-800">포트폴리오 산출 근거</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 lg:col-span-2">
            <p className="text-xs font-bold text-slate-700">시장 리포트 근거</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {currentPortfolioName}은 {selectedProfile.emphasis} 아래 리포트들을 근거로 {selectedProfile.allocationLogic}
            </p>
            <ul className="mt-2 space-y-2">
              {marketReportReasons.map((r) => (
                <li key={r.id} className="border-l-2 border-indigo-200 pl-2 text-xs leading-relaxed">
                  <span className="font-semibold text-slate-700">{r.title}</span>
                  <span className="text-[11px] text-slate-400"> · {r.source}</span>
                  <span className="mt-0.5 block text-slate-600">근거: {r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
          <ReasonBlock title="고객 정보 반영" body={model.rationale.client} />
          <ReasonBlock title="현금흐름 반영" body={model.rationale.cashflow} />
          <ReasonBlock title="세금 납부일 반영" body={model.rationale.tax} />
          <ReasonBlock title="요구조건 반영" body={model.rationale.preference} />
          <ReasonBlock title="고유상황 반영" body={model.rationale.unique} wide />
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-700">현금흐름 핵심 숫자</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <span className="text-slate-500">월 유입</span>
              <span className="text-right font-bold">{formatWonShort(model.cashflowSummary.monthlyIncome)}</span>
              <span className="text-slate-500">월 유출</span>
              <span className="text-right font-bold">{formatWonShort(model.cashflowSummary.monthlyOutflow)}</span>
              <span className="text-slate-500">세금성 예정 유출</span>
              <span className="text-right font-bold text-rose-600">{formatWonShort(model.cashflowSummary.taxOutflow)}</span>
              <span className="text-slate-500">단기 분리 제안액</span>
              <span className="text-right font-bold text-indigo-600">{liquidityAmount.toLocaleString()}만원</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 border-b border-slate-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-green-600"></span>
            <h3 className="text-base font-bold text-slate-800">KODEX 연금저축·IRP 절세 포트폴리오</h3>
          </div>
          <span className="text-[11px] font-medium text-slate-400">
            삼성자산운용 KODEX 상품 기준
          </span>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <p className="text-[11px] font-semibold text-green-700">세액공제 배분</p>
            <p className="mt-1 text-sm font-black text-green-900">
              연금저축 {formatWonShort(model.taxSavingPlan.pensionSavingContribution)} + IRP {formatWonShort(model.taxSavingPlan.irpContribution)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-slate-500">세액공제 대상</p>
            <p className="mt-1 text-sm font-black text-slate-800">{formatWonShort(model.taxSavingPlan.taxCreditBase)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-slate-500">가정 공제율</p>
            <p className="mt-1 text-sm font-black text-slate-800">{Math.round(model.taxSavingPlan.creditRate * 1000) / 10}%</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-[11px] font-semibold text-blue-700">예상 환급액</p>
            <p className="mt-1 text-sm font-black text-blue-900">{formatWonShort(model.taxSavingPlan.estimatedCredit)}</p>
          </div>
        </div>

        <p className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          {model.taxSavingPlan.clientFit}
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {model.taxSavingPlan.portfolios.map((portfolio) => (
            <div key={portfolio.accountType} className="rounded-2xl border border-slate-200 p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">{portfolio.accountType} KODEX 추천안</h4>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{portfolio.note}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                  위험자산 {portfolio.riskAssetWeight}%
                </span>
              </div>
              <div className="space-y-2">
                {portfolio.holdings.map((holding) => (
                  <a
                    key={`${portfolio.accountType}-${holding.product.name}`}
                    href={holding.product.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2 text-xs hover:border-green-200 hover:bg-green-50/40"
                  >
                    <span>
                      <b className="block text-slate-700">{holding.product.name}</b>
                      <span className="text-[11px] text-slate-400">
                        {holding.product.role} · {holding.product.retirementLimit}
                      </span>
                    </span>
                    <span className="font-black text-green-700">{holding.weight}%</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-green-100 bg-green-50 p-3">
            <p className="text-xs font-bold text-green-800">절세 솔루션</p>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-green-900">
              {model.taxSavingPlan.solutions.map((solution) => (
                <li key={solution}>• {solution}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-bold text-slate-700">참고 출처</p>
            <div className="mt-2 flex flex-col gap-1.5 text-xs">
              {model.taxSavingPlan.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  {source.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setIsSuitabilityOpen((value) => !value)}
          className="flex w-full items-center justify-between bg-slate-50 p-4 text-left transition-colors hover:bg-slate-100"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
            <h3 className="text-sm font-bold text-slate-800">상품군 투자 적합성 필터</h3>
            <span className="text-xs text-slate-400">리서치·세금·현금흐름 기준</span>
          </div>
          <span className="text-xs font-bold text-blue-600">{isSuitabilityOpen ? '접기' : '펼쳐보기'}</span>
        </button>
        {isSuitabilityOpen && (
          <div className="overflow-x-auto p-4">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/60 text-xs text-slate-500">
                  <th className="p-3 font-semibold">자산군</th>
                  <th className="w-24 p-3 text-center font-semibold">적합도</th>
                  <th className="p-3 font-semibold">판단 근거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {model.assetSuitability.map((item) => (
                  <tr key={item.category} className="hover:bg-slate-50/50">
                    <td className="p-3 font-bold text-slate-700">{item.category}</td>
                    <td className="p-3 text-center">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="p-3 font-medium text-slate-600">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-600"></span>
              <h3 className="text-base font-bold text-slate-800">PB 커스텀 세부 비중 조율</h3>
            </div>
            <div
              className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${
                totalWeight === 100
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-600'
              }`}
            >
              비중 총합 {totalWeight}% · {weightDiff === 0 ? '정확히 일치' : weightDiff > 0 ? `남은 비중 ${weightDiff}%` : `초과 ${Math.abs(weightDiff)}%`}
            </div>
          </div>

          <div className="space-y-5">
            <WeightControl asset="etf" value={weights.etf} onChange={handleWeightChange} />
            <WeightControl asset="bond" value={weights.bond} onChange={handleWeightChange} />
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <WeightControl asset="dollar" value={weights.dollar} onChange={handleWeightChange} max={30} compact />
              <WeightControl asset="gold" value={weights.gold} onChange={handleWeightChange} max={30} compact />
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div>
                  <span className="block text-xs font-bold text-slate-700">구조화 지수 ELS/ELB 포함</span>
                  <span className="text-[10px] text-slate-400">비활성화 시 ELS 비중 0% 처리</span>
                </div>
                <input
                  type="checkbox"
                  checked={elsIncluded}
                  onChange={(event) => {
                    setHasManualEdit(true);
                    setElsIncluded(event.target.checked);
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">단기 유동성 분리 확보액</span>
                  <span className="text-xs font-bold text-indigo-600">{liquidityAmount.toLocaleString()}만원</span>
                </div>
                <input
                  type="range"
                  min="1000"
                  max="30000"
                  step="500"
                  value={liquidityAmount}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setHasManualEdit(true);
                    setLiquidityAmount(value);
                    handleWeightChange('mmf', Math.min(Math.round((value / 100000) * 100), 40));
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-100 accent-indigo-600"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-between rounded-2xl bg-slate-900 p-5 text-white shadow-lg">
          <div>
            <div className="mb-4 flex items-center gap-2 border-b border-slate-800 pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-400"></span>
              <h3 className="text-sm font-bold text-slate-200">고객 대면 브리핑 스크립트</h3>
            </div>
            <div className="max-h-[360px] space-y-3 overflow-y-auto rounded-xl border border-slate-800/60 bg-slate-800/40 p-4 text-xs leading-relaxed text-slate-300">
              <p className="text-[11px] font-bold uppercase tracking-wide text-orange-300">Client Presentation Script</p>
              <p>
                {currentPortfolioName}은 {selectedSignalScores[0]?.label} 관련 리포트를 우선 참고했습니다.
                {selectedProfile.clientMessage}
              </p>
              <p>
                고객님의 월 순현금흐름은 {formatWonShort(model.cashflowSummary.monthlyNet)}이고, 세금성 예정 유출은
                {formatWonShort(model.cashflowSummary.taxOutflow)}입니다. 따라서 MMF/RP에 {liquidityAmount.toLocaleString()}만원을
                별도 분리하고, 나머지 자금은 채권과 ETF로 나누어 운용합니다.
              </p>
              <p>
                {model.rationale.unique}
              </p>
              <p className="border-t border-slate-800 pt-2 text-[11px] text-slate-400">
                출처: {selectedResearchItems.slice(0, 3).map((item) => `${item.source} - ${item.title}`).join(' / ')} 등 최신 리포트/기사 최대 20개
              </p>
            </div>
          </div>

          <div
            className={`mt-5 rounded-xl px-4 py-3 text-center text-xs font-bold tracking-wide ${
              totalWeight === 100
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {totalWeight === 100
              ? '위 최종 확정 버튼으로 이 리서치 근거 포트폴리오를 저장할 수 있습니다'
              : '자산 비중의 총합을 100%로 맞춰주세요'}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'blue' | 'slate' | 'rose' }) {
  const toneClass = {
    emerald: 'text-emerald-400',
    blue: 'text-blue-400',
    slate: 'text-slate-200',
    rose: 'text-rose-400',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4 text-center">
      <span className="block text-xs font-medium text-slate-400">{label}</span>
      <span className={`mt-1 block text-2xl font-black ${toneClass}`}>{value}</span>
    </div>
  );
}

function ReasonBlock({ title, body, wide }: { title: string; body: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-100 bg-slate-50 p-3 ${wide ? 'lg:col-span-2' : ''}`}>
      <p className="text-xs font-bold text-slate-700">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}

function WeightControl({
  asset,
  value,
  onChange,
  max = 100,
  compact = false,
}: {
  asset: WeightKey;
  value: number;
  onChange: (asset: WeightKey, value: number) => void;
  max?: number;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-slate-700">
        <span>{weightLabels[asset]} 비중</span>
        {compact && <span className="text-slate-500">{value}%</span>}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max={max}
          step="1"
          value={value}
          onChange={(event) => onChange(asset, Number(event.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-100 accent-blue-600"
        />
        <div className="relative flex w-24 flex-shrink-0 items-center">
          <input
            type="number"
            min="0"
            max={max}
            value={value}
            onChange={(event) => onChange(asset, Math.min(max, Number(event.target.value)))}
            className="w-full rounded-md border border-slate-300 py-1 pl-2 pr-6 text-right text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="absolute right-2 text-xs font-semibold text-slate-400">%</span>
        </div>
      </div>
    </div>
  );
}
