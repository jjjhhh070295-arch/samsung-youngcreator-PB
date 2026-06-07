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
} from '@/lib/portfolioResearch';

interface PortfolioPanelProps {
  client: Client;
  pbId: string;
  clientId: string;
  onSelectionChange?: (portfolio: Portfolio) => void;
}

type WeightKey = keyof PortfolioOption['weights'];

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
  const currentPortfolioName = portfolioOptions.find((option) => option.id === selectedBase)?.name || '';

  useEffect(() => {
    if (!onSelectionChange) return;
    const selected = portfolioOptions.find((option) => option.id === selectedBase) ?? portfolioOptions[1];
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
      label: selected.name,
      allocations,
      expectedReturn: metrics.expectedReturn,
      expectedRisk: metrics.volatility,
      taxNote: model.rationale.tax,
      rationale: [
        model.rationale.market,
        model.rationale.client,
        model.rationale.cashflow,
        model.rationale.unique,
      ].join(' '),
      editedByPb: true,
    });
  }, [adjustedWeights, metrics, model.rationale, onSelectionChange, portfolioOptions, selectedBase]);

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
            PB {client.assignedPbId || pbId || '-'}
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
                {model.executiveConclusion}
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
              <h3 className="text-base font-bold text-slate-800">최신 리서치 반영 상태</h3>
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              {researchStatus === 'loading'
                ? '업데이트 확인 중'
                : fallbackUsed
                  ? '일부 출처 fallback 포함'
                  : '실시간 추출 완료'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {model.researchSignals.slice(0, 4).map((signal) => (
              <div key={signal.signal} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <span className="block text-[11px] font-semibold text-slate-500">{signal.label}</span>
                <span className="mt-1 block text-lg font-black text-slate-800">{signal.score}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2">
            {model.researchItems.slice(0, 6).map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-100 px-3 py-2 text-xs hover:border-blue-200 hover:bg-blue-50/40"
              >
                <span className="font-bold text-slate-700">{item.title}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {item.source}
                  {item.date ? ` · ${item.date}` : ''}
                </span>
              </a>
            ))}
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
          <ReasonBlock title="시장 리포트 근거" body={model.rationale.market} />
          <ReasonBlock title="고객 정보 반영" body={model.rationale.client} />
          <ReasonBlock title="현금흐름 반영" body={model.rationale.cashflow} />
          <ReasonBlock title="세금 납부일 반영" body={model.rationale.tax} />
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
                최신 리서치에서는 {model.researchSignals[0]?.label} 신호가 가장 강합니다. 그래서 {currentPortfolioName}은
                해당 자산군을 반영하되, 고객님의 세금 납부와 현금화 일정을 먼저 커버하도록 설계했습니다.
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
                출처: {model.researchItems.slice(0, 3).map((item) => item.source).join(', ')} 등 최신 리포트/기사 최대 20개
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
