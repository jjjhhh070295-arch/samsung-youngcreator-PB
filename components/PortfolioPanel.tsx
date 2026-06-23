'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Client, Portfolio } from '@/lib/types';
import {
  buildDetailedHoldings,
  buildPortfolioViewModel,
  evaluatePreferenceFeasibility,
  getVolatilityRanges,
  preferenceAdjustedMetrics,
  RETURN_ESTIMATE_LABEL,
  type HeldAssets,
  type PortfolioOption,
} from '@/lib/portfolio';
import { calculatePortfolioProxyReturn, type ProxyReturnEstimate } from '@/lib/proxyReturns';
import { setToMacroApiParams } from '@/lib/assetMapping';
import type { HistoricalStressRangeResponse } from '@/lib/macroStress/types';
import { supabase } from '@/lib/supabase';
import {
  FALLBACK_MARKET_RESEARCH,
  type MarketResearchItem,
  type ResearchSignal,
} from '@/lib/portfolioResearch';
import { listPbs } from '@/lib/store';
import TaxPainRubricButton from '@/components/TaxPainRubricButton';
import WmExpertPanel from '@/components/WmExpertPanel';
import StockSectorPanel, { type ExistingHolding, type PlanSummaryItem } from '@/components/StockSectorPanel';

interface PortfolioPanelProps {
  client: Client;
  pbId: string;
  clientId: string;
  onSelectionChange?: (portfolio: Portfolio) => void;
  onHeldAssetsChange?: (heldAssets: HeldAssets | undefined) => void;
}

type WeightKey = keyof PortfolioOption['weights'];

// 리서치 분석 캐시(/api/research/signals)에서 읽어올 신호 형태
type AnalyzedReportSignal = { signal: string; direction: -1 | 0 | 1; strength: number; evidence: string };
type AnalyzedReport = { summary: string; signals: AnalyzedReportSignal[]; model?: string };

interface BenchmarkApiPoint {
  date: string;
  label: string;
  sp500?: number | null;
  kospi?: number | null;
  usTreasury10y?: number | null;
  mmf?: number | null;
  bond?: number | null;
  gold?: number | null;
  dollar?: number | null;
  commodity?: number | null;
}

interface BenchmarkApiResponse {
  ok?: boolean;
  source?: string;
  fallback?: boolean;
  updatedAt?: string;
  points?: BenchmarkApiPoint[];
  proxyReturns?: ProxyReturnEstimate[];
}

type BenchmarkChartPoint = BenchmarkApiPoint & { portfolio: number; blendedBenchmark: number };

type ReferenceLineKey = 'sp500' | 'kospi' | 'usTreasury10y';

const REFERENCE_LINE_META: Record<
  ReferenceLineKey,
  {
    dataKey: ReferenceLineKey;
    name: string;
    compareLabel: string;
    stroke: string;
    activeClass: string;
    idleClass: string;
    dotClass: string;
    cardClass: string;
    cardTitleClass: string;
  }
> = {
  sp500: {
    dataKey: 'sp500',
    name: 'S&P500',
    compareLabel: 'S&P500 대비',
    stroke: '#f59e0b',
    activeClass: 'border-amber-300 bg-amber-50 font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    idleClass: 'border-border bg-surface-2 text-fg-muted hover:border-amber-200 dark:hover:border-amber-800',
    dotClass: 'bg-amber-500',
    cardClass: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
    cardTitleClass: 'text-amber-800 dark:text-amber-300',
  },
  kospi: {
    dataKey: 'kospi',
    name: 'KOSPI',
    compareLabel: 'KOSPI 대비',
    stroke: '#3b82f6',
    activeClass: 'border-blue-300 bg-blue-50 font-semibold text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    idleClass: 'border-border bg-surface-2 text-fg-muted hover:border-blue-200 dark:hover:border-blue-800',
    dotClass: 'bg-blue-500',
    cardClass: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30',
    cardTitleClass: 'text-blue-800 dark:text-blue-300',
  },
  usTreasury10y: {
    dataKey: 'usTreasury10y',
    name: '미국 7-10년국채 ETF (IEF)',
    compareLabel: '미국 7-10년국채 ETF 대비',
    stroke: '#8b5cf6',
    activeClass: 'border-violet-300 bg-violet-50 font-semibold text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
    idleClass: 'border-border bg-surface-2 text-fg-muted hover:border-violet-200 dark:hover:border-violet-800',
    dotClass: 'bg-violet-500',
    cardClass: 'border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30',
    cardTitleClass: 'text-violet-800 dark:text-violet-300',
  },
};

function formatAlphaPercentPoints(alpha: number) {
  return `${alpha > 0 ? '+' : ''}${alpha.toFixed(1)}%p`;
}

function alphaToneClass(alpha: number) {
  return alpha >= 0 ? 'text-emerald-600' : 'text-rose-600';
}

function BenchmarkAlphaPanel({
  portfolioReturn,
  blendedReturn,
  referenceReturns,
  visibleRefs,
  blendedTitle = '혼합 벤치마크 대비 초과성과',
}: {
  portfolioReturn: number;
  blendedReturn: number;
  referenceReturns: Record<ReferenceLineKey, number>;
  visibleRefs: Record<ReferenceLineKey, boolean>;
  blendedTitle?: string;
}) {
  const activeRefs = (Object.keys(REFERENCE_LINE_META) as ReferenceLineKey[]).filter((key) => visibleRefs[key]);

  return (
    <div className="grid grid-cols-1 gap-2 text-xs sm:min-w-[240px]">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">분산 포트폴리오 기준선</span>
        <b className="text-base font-black text-slate-800 dark:text-slate-100">
          {blendedReturn.toFixed(1)}%
        </b>
        <span className="mt-0.5 block text-[10px] text-fg-muted">
          자산배분 혼합 벤치마크 누적수익률 · S&P500·KOSPI 단독 선과 비교
        </span>
      </div>
      {activeRefs.map((lineKey) => {
        const meta = REFERENCE_LINE_META[lineKey];
        const referenceReturn = referenceReturns[lineKey];
        const alpha = portfolioReturn - referenceReturn;
        return (
          <div key={lineKey} className={`rounded-xl border px-3 py-2 ${meta.cardClass}`}>
            <span className={`block text-[11px] font-semibold ${meta.cardTitleClass}`}>
              {meta.compareLabel} 초과성과
            </span>
            <b className={`text-base font-black ${alphaToneClass(alpha)}`}>
              {formatAlphaPercentPoints(alpha)}
            </b>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              제안 포트폴리오 {portfolioReturn.toFixed(1)}% vs {meta.name} {referenceReturn.toFixed(1)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ReferenceLineToggle({
  lineKey,
  label,
  value,
  active,
  onToggle,
}: {
  lineKey: ReferenceLineKey;
  label: string;
  value: number;
  active: boolean;
  onToggle: (key: ReferenceLineKey) => void;
}) {
  const meta = REFERENCE_LINE_META[lineKey];
  return (
    <button
      type="button"
      onClick={() => onToggle(lineKey)}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${active ? meta.activeClass : meta.idleClass}`}
    >
      <span className={`h-2.5 w-2.5 rounded-full ${active ? meta.dotClass : 'bg-fg-muted opacity-35'}`} />
      {label} {value.toFixed(1)}%
    </button>
  );
}

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
        : 'bg-surface-2 text-fg-muted border-border';
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`} title={s.evidence}>
      {RESEARCH_SIGNAL_KO[s.signal] ?? s.signal} {arrow}
      {s.strength}
    </span>
  );
}

const weightLabels: Record<WeightKey, string> = {
  etf: '주식 / ETF',
  bond: '채권 인컴',
  els: '채권 인컴',
  mmf: 'MMF/RP',
  gold: '금',
  dollar: '달러',
  raw: '원자재',
};

const MACRO_STRESS_LABELS = {
  us: '미국주식 (S&P 500)',
  kr: '국내주식 (KOSPI)',
  bond: '채권 (미국채 10년물)',
} as const;

function buildMacroStressAllocations(
  holdings: Array<{ bucket: WeightKey; name: string; weight: number }>,
) {
  const grouped = new Map<string, number>();
  const add = (label: string, weight: number) => {
    grouped.set(label, (grouped.get(label) ?? 0) + weight);
  };

  for (const holding of holdings) {
    if (holding.bucket === 'bond') {
      add(MACRO_STRESS_LABELS.bond, holding.weight);
      continue;
    }
    if (holding.bucket !== 'etf') continue;

    const name = holding.name.replace(/\s/g, '').toLowerCase();
    const isDomestic = /삼성전자|sk하이닉스|현대차|kodex200|mscikorea|msci한국|ai반도체핵심장비/.test(name);
    const isUs = /nvidia|microsoft|apple|broadcom|elililly|미국|나스닥|s&p500/.test(name);
    if (isDomestic) add(MACRO_STRESS_LABELS.kr, holding.weight);
    else if (isUs) add(MACRO_STRESS_LABELS.us, holding.weight);
  }

  const total = Array.from(grouped.values()).reduce((sum, weight) => sum + weight, 0);
  return Array.from(grouped.entries()).map(([assetClass, weight]) => ({
    assetClass,
    weight: total > 0 ? Math.round((weight / total) * 1000) / 10 : 0,
  }));
}

const barColors: Record<WeightKey, string> = {
  etf: 'bg-blue-600',
  bond: 'bg-sky-500',
  els: 'bg-sky-500',
  mmf: 'bg-indigo-600',
  gold: 'bg-yellow-500',
  dollar: 'bg-slate-600',
  raw: 'bg-stone-500',
};

const FALLBACK_BENCHMARK_POINTS: BenchmarkApiPoint[] = [
  { date: 'fallback-0', label: '12M 전', sp500: 0, kospi: 0, bond: 0, gold: 0, dollar: 0, commodity: 0 },
  { date: 'fallback-1', label: '11M 전', sp500: -1.1, kospi: -2.0, bond: 0.2, gold: 1.6, dollar: -0.4, commodity: -1.7 },
  { date: 'fallback-2', label: '10M 전', sp500: -0.2, kospi: 1.8, bond: -0.3, gold: 0.7, dollar: 0.8, commodity: -0.6 },
  { date: 'fallback-3', label: '9M 전', sp500: 2.1, kospi: 0.9, bond: 0.1, gold: 3.9, dollar: 1.1, commodity: 1.5 },
  { date: 'fallback-4', label: '8M 전', sp500: 3.7, kospi: 4.4, bond: 0.8, gold: 5.4, dollar: -0.2, commodity: 0.2 },
  { date: 'fallback-5', label: '7M 전', sp500: 1.9, kospi: 3.1, bond: 0.4, gold: 4.8, dollar: 1.7, commodity: 2.8 },
  { date: 'fallback-6', label: '6M 전', sp500: 5.2, kospi: 6.8, bond: 1.1, gold: 7.2, dollar: 1.2, commodity: 1.9 },
  { date: 'fallback-7', label: '5M 전', sp500: 4.3, kospi: 5.3, bond: 1.0, gold: 6.1, dollar: 2.4, commodity: 4.1 },
  { date: 'fallback-8', label: '4M 전', sp500: 7.1, kospi: 9.5, bond: 1.7, gold: 10.4, dollar: 1.6, commodity: 3.2 },
  { date: 'fallback-9', label: '3M 전', sp500: 6.4, kospi: 7.7, bond: 1.4, gold: 9.2, dollar: 2.9, commodity: 5.6 },
  { date: 'fallback-10', label: '2M 전', sp500: 8.8, kospi: 11.1, bond: 2.0, gold: 12.7, dollar: 2.0, commodity: 4.3 },
  { date: 'fallback-11', label: '1M 전', sp500: 7.6, kospi: 9.4, bond: 1.8, gold: 10.8, dollar: 1.3, commodity: 3.8 },
  { date: 'fallback-12', label: '현재', sp500: 9.2, kospi: 6.4, bond: 2.2, gold: 11.6, dollar: 1.8, commodity: 4.9 },
];

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

const formatPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

function finiteNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function fixedIncomeProxy(index: number, total: number, annualReturn: number) {
  if (total <= 1) return 0;
  return (Math.pow(1 + annualReturn / 100, index / (total - 1)) - 1) * 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}


function buildSimplifiedBenchmarkChartData(
  points: BenchmarkApiPoint[],
  weights: PortfolioOption['weights'],
  detailedHoldings: ReturnType<typeof buildDetailedHoldings>,
  riskTilt: -1 | 0 | 1 = 0,
): BenchmarkChartPoint[] {
  const sourcePoints = points.length >= 2 ? points : FALLBACK_BENCHMARK_POINTS;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 100;
  const overseasPattern = /S&P|NVIDIA|Microsoft|Apple|Broadcom|Eli Lilly|Nasdaq|Nifty|미국|해외|나스닥|인도/i;
  const etfHoldings = detailedHoldings.filter((holding) => holding.bucket === 'etf');
  const overseasEquityWeight = etfHoldings.reduce(
    (sum, holding) => sum + (overseasPattern.test(holding.name) ? holding.weight : 0),
    0,
  );
  const domesticEquityWeight = Math.max(0, weights.etf - overseasEquityWeight);
  return sourcePoints.map((point, index) => {
    const usTreasury10y = finiteNumber(point.usTreasury10y, fixedIncomeProxy(index, sourcePoints.length, 3.2));
    const mmf = finiteNumber(point.mmf, fixedIncomeProxy(index, sourcePoints.length, 3.0));
    const gold = finiteNumber(point.gold, fixedIncomeProxy(index, sourcePoints.length, 4.0));
    const dollar = finiteNumber(point.dollar, fixedIncomeProxy(index, sourcePoints.length, 2.3));
    const commodity = finiteNumber(point.commodity, fixedIncomeProxy(index, sourcePoints.length, 3.6));
    const blendedBenchmark =
      (overseasEquityWeight / totalWeight) * finiteNumber(point.sp500) +
      (domesticEquityWeight / totalWeight) * finiteNumber(point.kospi, finiteNumber(point.sp500)) +
      (weights.bond / totalWeight) * usTreasury10y +
      (weights.mmf / totalWeight) * mmf +
      (weights.gold / totalWeight) * gold +
      (weights.dollar / totalWeight) * dollar +
      (weights.raw / totalWeight) * commodity;
    return {
      ...point,
      sp500: roundPercent(finiteNumber(point.sp500)),
      kospi: roundPercent(finiteNumber(point.kospi, finiteNumber(point.sp500))),
      usTreasury10y: roundPercent(usTreasury10y),
      portfolio: roundPercent(blendedBenchmark),
      blendedBenchmark: roundPercent(blendedBenchmark),
    };
  });
}

function computeMetrics(
  cumulativePcts: number[],
  riskFreeAnnualPct = 3.0,
): { returnPct: number; volatilityPct: number; mddPct: number; sharpe: number } {
  const n = cumulativePcts.length;
  if (n < 2) return { returnPct: 0, volatilityPct: 0, mddPct: 0, sharpe: 0 };

  const periodReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = 1 + (cumulativePcts[i - 1] ?? 0) / 100;
    const curr = 1 + (cumulativePcts[i] ?? 0) / 100;
    if (prev > 0) periodReturns.push(curr / prev - 1);
  }

  const returnPct = cumulativePcts[n - 1] ?? 0;

  const mean = periodReturns.length > 0
    ? periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length : 0;
  const variance = periodReturns.length > 0
    ? periodReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / periodReturns.length : 0;
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(12) * 100;

  let peak = 1 + (cumulativePcts[0] ?? 0) / 100;
  let mddPct = 0;
  for (const c of cumulativePcts) {
    const price = 1 + c / 100;
    if (price > peak) peak = price;
    const dd = ((price - peak) / peak) * 100;
    if (dd < mddPct) mddPct = dd;
  }

  const sharpe = volatilityPct > 0 ? (returnPct - riskFreeAnnualPct) / volatilityPct : 0;

  return {
    returnPct: Math.round(returnPct * 10) / 10,
    volatilityPct: Math.round(volatilityPct * 10) / 10,
    mddPct: Math.round(mddPct * 10) / 10,
    sharpe: Math.round(sharpe * 100) / 100,
  };
}

function getStatusClass(status: string) {
  switch (status) {
    case '적합':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case '주의':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case '비추천':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-surface-2 text-fg border-border';
  }
}

function riskTiltForOption(id: PortfolioOption['id']): -1 | 0 | 1 {
  if (id === 'stable') return -1;
  if (id === 'growth') return 1;
  return 0;
}

function latestBenchmarkTarget(
  points: BenchmarkApiPoint[],
  preference: { benchmarkOutperformance: boolean; benchmarkTargets: string[] },
) {
  if (!preference.benchmarkOutperformance) return undefined;
  const lastPoint = points[points.length - 1];
  if (!lastPoint) return undefined;
  const targets = [
    preference.benchmarkTargets.includes('S&P500') ? finiteNumber(lastPoint.sp500, Number.NaN) : Number.NaN,
    preference.benchmarkTargets.includes('KOSPI') ? finiteNumber(lastPoint.kospi, Number.NaN) : Number.NaN,
  ].filter(Number.isFinite);
  const values = targets.length > 0
    ? targets
    : [finiteNumber(lastPoint.sp500, Number.NaN), finiteNumber(lastPoint.kospi, Number.NaN)].filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function BenchmarkReturnChart({
  data,
  source,
  fallback,
  updatedAt,
}: {
  data: (BenchmarkChartPoint & { blendedBenchmark?: number })[];
  source: string;
  fallback: boolean;
  updatedAt?: string;
}) {
  const [visibleRefs, setVisibleRefs] = useState<Record<ReferenceLineKey, boolean>>({
    sp500: true,
    kospi: true,
    usTreasury10y: false,
  });
  const toggleReferenceLine = (key: ReferenceLineKey) => {
    setVisibleRefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const lastPoint = data[data.length - 1];
  const portfolioReturn = finiteNumber(lastPoint?.portfolio);
  const blendedReturn = finiteNumber(lastPoint?.blendedBenchmark);
  const sp500Return = finiteNumber(lastPoint?.sp500);
  const kospiReturn = finiteNumber(lastPoint?.kospi);
  const usTreasuryReturn = finiteNumber(lastPoint?.usTreasury10y);
  const referenceReturns: Record<ReferenceLineKey, number> = {
    sp500: sp500Return,
    kospi: kospiReturn,
    usTreasury10y: usTreasuryReturn,
  };
  const sourceLabel = fallback ? '일부 지연 · 백업 데이터 포함' : '실시간/지연 지수 데이터 · 최근 1년 월별 종가 (당월 최신 반영)';
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 dark:border-slate-800 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
            <h3 className="text-base font-bold text-fg dark:text-slate-100">
              맞춤형 혼합 벤치마크(Blended Benchmark) 대비 성과 추정
            </h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted dark:text-fg-muted">
            제안된 적극형/중립형/안정형 포트폴리오의 자산 비중과 일치하도록 자산군별 대표 지수를 실시간 결합한 공정 평가 기준선입니다.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-fg-muted dark:text-fg-muted">
            {sourceLabel}
            {updatedLabel ? ` · 조회 ${updatedLabel}` : ''}
            {source ? ` · ${source}` : ''}
          </p>
        </div>

        <BenchmarkAlphaPanel
          portfolioReturn={portfolioReturn}
          blendedReturn={blendedReturn}
          referenceReturns={referenceReturns}
          visibleRefs={visibleRefs}
        />
      </div>

      <div className="h-[320px] w-full text-fg dark:text-slate-200">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.16} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'currentColor', fontSize: 11 }}
              axisLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
              tickLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
            />
            <YAxis
              unit="%"
              tick={{ fill: 'currentColor', fontSize: 11 }}
              axisLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
              tickLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
            />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [
                value == null ? '-' : `${Number(value).toFixed(1)}%`,
                String(name),
              ]}
              labelFormatter={(label) => `${label} 누적수익률`}
              contentStyle={{
                background: 'rgb(var(--surface))',
                border: '1px solid rgb(var(--border))',
                borderRadius: 10,
                color: 'rgb(var(--fg))',
                fontSize: 12,
              }}
            />
            <Line
              type="linear"
              dataKey="portfolio"
              name="제안 포트폴리오"
              stroke="#0f172a"
              strokeWidth={3}
              dot={{ r: 3, strokeWidth: 1 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="linear"
              dataKey="blendedBenchmark"
              name="혼합 벤치마크 (Blended)"
              stroke="#10b981"
              strokeWidth={2.5}
              strokeDasharray="4 4"
              dot={{ r: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            {(Object.keys(REFERENCE_LINE_META) as ReferenceLineKey[]).map((lineKey) => {
              if (!visibleRefs[lineKey]) return null;
              const meta = REFERENCE_LINE_META[lineKey];
              return (
                <Line
                  key={lineKey}
                  type="linear"
                  dataKey={meta.dataKey}
                  name={meta.name}
                  stroke={meta.stroke}
                  strokeWidth={1.75}
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 font-semibold text-fg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-950 dark:bg-surface-2" />
          제안 포트폴리오 {portfolioReturn.toFixed(1)}%
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:text-emerald-300">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          혼합 벤치마크 {blendedReturn.toFixed(1)}%
        </span>
        <ReferenceLineToggle lineKey="sp500" label="S&P500" value={sp500Return} active={visibleRefs.sp500} onToggle={toggleReferenceLine} />
        <ReferenceLineToggle lineKey="kospi" label="KOSPI" value={kospiReturn} active={visibleRefs.kospi} onToggle={toggleReferenceLine} />
        <ReferenceLineToggle lineKey="usTreasury10y" label="미국 7-10년국채 ETF" value={usTreasuryReturn} active={visibleRefs.usTreasury10y} onToggle={toggleReferenceLine} />
      </div>
    </section>
  );
}

function SimplifiedBenchmarkReturnChart({
  data,
  source,
  fallback,
  updatedAt,
}: {
  data: BenchmarkChartPoint[];
  source: string;
  fallback: boolean;
  updatedAt?: string;
}) {
  const [visibleRefs, setVisibleRefs] = useState<Record<ReferenceLineKey, boolean>>({
    sp500: true,
    kospi: true,
    usTreasury10y: false,
  });
  const toggleReferenceLine = (key: ReferenceLineKey) => {
    setVisibleRefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const lastPoint = data[data.length - 1];
  const portfolioReturn = finiteNumber(lastPoint?.portfolio);
  const blendedReturn = finiteNumber(lastPoint?.blendedBenchmark);
  const sp500Return = finiteNumber(lastPoint?.sp500);
  const kospiReturn = finiteNumber(lastPoint?.kospi);
  const usTreasuryReturn = finiteNumber(lastPoint?.usTreasury10y);
  const referenceReturns: Record<ReferenceLineKey, number> = {
    sp500: sp500Return,
    kospi: kospiReturn,
    usTreasury10y: usTreasuryReturn,
  };
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="mb-4 flex flex-col gap-3 border-b border-border pb-3 dark:border-slate-800 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-base font-bold text-fg dark:text-slate-100">최근 1년 백테스트: 자산배분 포트폴리오 vs 단일 지수 비교</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            현재 추천 포트폴리오 비중을 과거 1년 시장 데이터에 적용한 백테스트입니다. S&P500·KOSPI 단일 지수 대비 분산 투자 효과를 확인할 수 있습니다. 미래 수익률을 보장하지 않습니다.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-fg-muted">
            {fallback ? '예비 데이터 포함' : '최근 1년 시장 데이터'}
            {updatedLabel ? ` · 조회 ${updatedLabel}` : ''}
            {source ? ` · ${source}` : ''}
          </p>
        </div>
        <BenchmarkAlphaPanel
          portfolioReturn={portfolioReturn}
          blendedReturn={blendedReturn}
          referenceReturns={referenceReturns}
          visibleRefs={visibleRefs}
          blendedTitle="혼합 벤치마크 대비"
        />
      </div>

      <div className="h-[320px] w-full text-fg dark:text-slate-200">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.16} />
            <XAxis dataKey="label" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }} tickLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }} />
            <YAxis unit="%" tick={{ fill: 'currentColor', fontSize: 11 }} axisLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }} tickLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }} />
            <Tooltip formatter={(value: unknown, name: unknown) => [value == null ? '-' : `${Number(value).toFixed(1)}%`, String(name)]} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--border))', borderRadius: 10, color: 'rgb(var(--fg))', fontSize: 12 }} />
            <Line type="linear" dataKey="portfolio" name="제안 포트폴리오" stroke="#0f172a" strokeWidth={3} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 6 }} connectNulls />
            <Line type="linear" dataKey="blendedBenchmark" name="혼합 벤치마크" stroke="#10b981" strokeWidth={2.5} strokeDasharray="4 4" dot={{ r: 2 }} activeDot={{ r: 5 }} connectNulls />
            {(Object.keys(REFERENCE_LINE_META) as ReferenceLineKey[]).map((lineKey) => {
              if (!visibleRefs[lineKey]) return null;
              const meta = REFERENCE_LINE_META[lineKey];
              return (
                <Line
                  key={lineKey}
                  type="linear"
                  dataKey={meta.dataKey}
                  name={meta.name}
                  stroke={meta.stroke}
                  strokeWidth={1.75}
                  strokeDasharray="3 3"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-border bg-surface-2 px-2.5 py-1 font-semibold text-fg">제안 포트폴리오 {portfolioReturn.toFixed(1)}%</span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">혼합 벤치마크 {blendedReturn.toFixed(1)}%</span>
        <ReferenceLineToggle lineKey="sp500" label="S&P500" value={sp500Return} active={visibleRefs.sp500} onToggle={toggleReferenceLine} />
        <ReferenceLineToggle lineKey="kospi" label="KOSPI" value={kospiReturn} active={visibleRefs.kospi} onToggle={toggleReferenceLine} />
        <ReferenceLineToggle lineKey="usTreasury10y" label="미국 7-10년국채 ETF" value={usTreasuryReturn} active={visibleRefs.usTreasury10y} onToggle={toggleReferenceLine} />
      </div>
    </section>
  );
}

function buildPlanPortfolioSeries(
  data: BenchmarkChartPoint[],
  planSummary: Array<{ etfCode: string; amountKrw: number; isFallback: boolean }>,
  sectorEtfData: Record<string, number[]>,
  weights: PortfolioOption['weights'],
): number[] | null {
  // Aggregate amountKrw per etfCode (multiple stocks can share one ETF)
  const etfKrw = new Map<string, number>();
  for (const p of planSummary) {
    if (p.isFallback || p.amountKrw <= 0) continue;
    const series = sectorEtfData[p.etfCode];
    if (!series || series.length < 2) continue;
    etfKrw.set(p.etfCode, (etfKrw.get(p.etfCode) ?? 0) + p.amountKrw);
  }
  if (etfKrw.size === 0) return null;

  const totalEtfKrw = Array.from(etfKrw.values()).reduce((a, b) => a + b, 0);
  if (totalEtfKrw <= 0) return null;

  const entries = Array.from(etfKrw.entries()).map(([code, krw]) => ({ krw, series: sectorEtfData[code] as number[] }));
  const minLen = Math.min(data.length, ...entries.map((e) => e.series.length));
  if (minLen < 2) return null;

  // Stable (bond proxy) from existing benchmarkChartData
  const equityWeight = weights.etf;
  const stableWeight = weights.bond + weights.mmf + weights.gold + weights.dollar + weights.raw;
  const totalWeight = Math.max(equityWeight + stableWeight, 1);

  return Array.from({ length: minLen }, (_, t) => {
    const eq = entries.reduce((sum, e) => sum + (e.krw / totalEtfKrw) * (e.series[t] ?? 0), 0);
    const stable = finiteNumber(data[t]?.usTreasury10y, 0);
    return Math.round(((equityWeight / totalWeight) * eq + (stableWeight / totalWeight) * stable) * 10) / 10;
  });
}

function ObjectiveMetricsTable({
  data,
  source,
  fallback,
  updatedAt,
  weights,
  planSummary = [],
  sectorEtfData = {},
}: {
  data: BenchmarkChartPoint[];
  source: string;
  fallback: boolean;
  updatedAt?: string;
  weights?: PortfolioOption['weights'];
  planSummary?: Array<{ etfCode: string; amountKrw: number; isFallback: boolean }>;
  sectorEtfData?: Record<string, number[]>;
}) {
  const planPortfolioSeries = useMemo(() => {
    if (!weights || planSummary.length === 0) return null;
    return buildPlanPortfolioSeries(data, planSummary, sectorEtfData, weights);
  }, [data, planSummary, sectorEtfData, weights]);

  const usePlanData = planPortfolioSeries !== null;

  const portfolioMetrics = useMemo(
    () => computeMetrics(usePlanData ? planPortfolioSeries! : data.map((p) => p.portfolio)),
    [data, planPortfolioSeries, usePlanData],
  );
  const sp500Metrics = useMemo(
    () => computeMetrics(data.map((p) => finiteNumber(p.sp500))),
    [data],
  );
  const kospiMetrics = useMemo(
    () => computeMetrics(data.map((p) => finiteNumber(p.kospi, finiteNumber(p.sp500)))),
    [data],
  );

  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';

  const rows: Array<{ label: string; fmt: (v: number) => string; portfolio: number; sp500: number; kospi: number }> = [
    { label: '수익률 (1년)', fmt: (v) => `${v.toFixed(1)}%`, portfolio: portfolioMetrics.returnPct, sp500: sp500Metrics.returnPct, kospi: kospiMetrics.returnPct },
    { label: '변동성 (연율화)', fmt: (v) => `${v.toFixed(1)}%`, portfolio: portfolioMetrics.volatilityPct, sp500: sp500Metrics.volatilityPct, kospi: kospiMetrics.volatilityPct },
    { label: '최대낙폭 (MDD)', fmt: (v) => `${v.toFixed(1)}%`, portfolio: portfolioMetrics.mddPct, sp500: sp500Metrics.mddPct, kospi: kospiMetrics.mddPct },
    { label: '샤프지수', fmt: (v) => v.toFixed(2), portfolio: portfolioMetrics.sharpe, sp500: sp500Metrics.sharpe, kospi: kospiMetrics.sharpe },
  ];

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="mb-4 border-b border-border pb-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-fg dark:text-slate-100">객관적 지표 비교 (최근 1년)</h3>
          <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${usePlanData ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-border bg-surface-2 text-fg-muted'}`}>
            {usePlanData ? 'PB 종목 선택 반영' : '지수 기반'}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] font-semibold text-fg-muted">
          {fallback ? '예비 데이터 포함' : '최근 1년 실제 시장 데이터'}
          {updatedLabel ? ` · 조회 ${updatedLabel}` : ''}
          {source ? ` · ${source}` : ''}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-fg-muted dark:border-slate-700">
              <th className="pb-2 pr-4 text-left font-medium">지표</th>
              <th className="pb-2 text-center font-semibold text-slate-800 dark:text-slate-100">자산배분 포트폴리오</th>
              <th className="pb-2 text-center font-medium">S&P500</th>
              <th className="pb-2 text-center font-medium">KOSPI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-border last:border-0 dark:border-slate-800">
                <td className="py-2.5 pr-4 text-xs text-fg-muted">{row.label}</td>
                <td className="py-2.5 text-center text-sm font-bold text-fg dark:text-slate-100">
                  {row.fmt(row.portfolio)}
                </td>
                <td className="py-2.5 text-center text-sm font-semibold text-fg-muted">
                  {row.fmt(row.sp500)}
                </td>
                <td className="py-2.5 text-center text-sm font-semibold text-fg-muted">
                  {row.fmt(row.kospi)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[10px] leading-relaxed text-fg-muted">
        과거 1년 실제 시장 데이터. 과거 성과는 미래를 보장하지 않습니다. 샤프지수 무위험수익률 연 3% 기준.
        {usePlanData && ' · 주식 부분은 PB 종목 선택 섹터 ETF 실제 수익률 가중 반영.'}
      </p>
    </section>
  );
}

export default function PortfolioPanel({ client, pbId, clientId, onSelectionChange, onHeldAssetsChange }: PortfolioPanelProps) {
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
    els: 0,
    mmf: 10,
    gold: 5,
    dollar: 5,
    raw: 0,
  } : {
    etf: 35,
    bond: 35,
    els: 0,
    mmf: 10,
    gold: 5,
    dollar: 5,
    raw: 0,
  });
  const [liquidityAmount, setLiquidityAmount] = useState(5000);
  const [isSuitabilityOpen, setIsSuitabilityOpen] = useState(false);
  const [hasManualEdit, setHasManualEdit] = useState(false);
  const [benchmarkPoints, setBenchmarkPoints] = useState<BenchmarkApiPoint[]>(FALLBACK_BENCHMARK_POINTS);
  const [proxyReturns, setProxyReturns] = useState<ProxyReturnEstimate[]>([]);
  const [stressRange, setStressRange] = useState<HistoricalStressRangeResponse | null>(null);
  const [benchmarkSource, setBenchmarkSource] = useState('로컬 예비 데이터');
  const [benchmarkFallback, setBenchmarkFallback] = useState(true);
  const [benchmarkUpdatedAt, setBenchmarkUpdatedAt] = useState<string | undefined>();
  const [heldAssets,       setHeldAssets]       = useState<HeldAssets | undefined>(undefined);
  const [existingHoldings, setExistingHoldings] = useState<ExistingHolding[]>([]);
  const [planSummary,      setPlanSummary]      = useState<PlanSummaryItem[]>([]);
  const [sectorEtfData,    setSectorEtfData]    = useState<Record<string, number[]>>({});

  // 종목 계획 변경 시 섹터 ETF 월별 수익률 취득
  useEffect(() => {
    const valid = planSummary.filter((p) => !p.isFallback && p.amountKrw > 0);
    if (valid.length === 0) { setSectorEtfData({}); return; }
    const uniqueTickers = Array.from(new Set(valid.map((p) => p.etfCode)));
    fetch(`/api/benchmarks/sector-etf?tickers=${encodeURIComponent(uniqueTickers.join(','))}`)
      .then((r) => r.json())
      .then((j: { data?: Record<string, number[] | null> }) => {
        const filtered: Record<string, number[]> = {};
        for (const [k, v] of Object.entries(j.data ?? {})) {
          if (Array.isArray(v) && v.length >= 2) filtered[k] = v;
        }
        setSectorEtfData(filtered);
      })
      .catch(() => setSectorEtfData({}));
  }, [planSummary]);

  // 보유자산 조회 (주식 KIS 현재가 재활용 + 부동산 DB값 + 현금 계산)
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: holdingData }, { data: propData }] = await Promise.all([
          supabase
            .from('client_holdings')
            .select('id, name, ticker, currency, quantity, avg_price')
            .eq('client_id', clientId),
          supabase
            .from('client_real_estate')
            .select('market_value, ownership_share')
            .eq('client_id', clientId),
        ]);
        if (cancelled) return;

        const holdings = holdingData ?? [];

        // 티커 미보유 종목 자동 매핑
        let resolved = [...holdings];
        const noTicker = holdings.filter((h: { ticker: string | null }) => !h.ticker);
        if (noTicker.length > 0) {
          try {
            const res = await fetch('/api/resolve-tickers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ names: noTicker.map((h: { name: string }) => h.name) }),
            });
            const json = await res.json();
            const tMap: Record<string, string | null> = json.tickers ?? {};
            resolved = holdings.map((h) =>
              tMap[h.name] ? { ...h, ticker: tMap[h.name] } : h,
            );
          } catch { /* 매핑 실패 시 avg_price 폴백 */ }
        }

        // KIS 현재가 조회 (서버 캐시 활용 — 30s TTL)
        const tickerRequests = resolved
          .filter((h: { ticker: string | null }) => h.ticker)
          .map((h: { ticker: string | null; currency: string }) => ({
            ticker: h.ticker!,
            currency: (h.currency === 'USD' ? 'USD' : 'KRW') as 'KRW' | 'USD',
          }));

        const liveMap = new Map<string, number | null>();
        let fxUsdKrw = 1350;
        if (tickerRequests.length > 0) {
          try {
            const res = await fetch('/api/prices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tickers: tickerRequests }),
            });
            const json = await res.json();
            fxUsdKrw = json.fxUsdKrw ?? 1350;
            for (const q of json.quotes ?? []) liveMap.set(q.ticker, q.price ?? null);
          } catch { /* 시세 실패 시 avg_price 폴백 */ }
        }

        // 주식 평가금액 + 기존 보유 종목 배열
        let stocksKrw = 0;
        const existingHoldingsData: ExistingHolding[] = [];
        for (const h of resolved) {
          const qty  = (h as { quantity: number }).quantity ?? 0;
          const live = (h as { ticker: string | null }).ticker ? (liveMap.get((h as { ticker: string }).ticker) ?? null) : null;
          const fx   = (h as { currency: string }).currency === 'USD' ? fxUsdKrw : 1;
          const price = live ?? ((h as { avg_price: number | null }).avg_price ?? 0);
          stocksKrw += qty * price * fx;
          const evalKrw = Math.round(qty * price * fx);
          if (evalKrw > 0) {
            existingHoldingsData.push({
              name:    (h as { name: string }).name,
              ticker:  (h as { ticker: string | null }).ticker ?? null,
              evalKrw,
            });
          }
        }
        existingHoldingsData.sort((a, b) => b.evalKrw - a.evalKrw);

        // 부동산 평가금액
        const realEstateKrw = (propData ?? []).reduce(
          (s: number, p: { market_value: number | null; ownership_share: number }) =>
            s + (p.market_value ?? 0) * (p.ownership_share ?? 1),
          0,
        );

        const totalKrw = Math.max(client.assetSize ?? 0, stocksKrw + realEstateKrw);
        const cashKrw = Math.max(0, totalKrw - stocksKrw - realEstateKrw);

        if (!cancelled) {
          setHeldAssets({ stocksKrw, realEstateKrw, cashKrw, totalKrw });
          setExistingHoldings(existingHoldingsData);
        }
      } catch { /* 전체 실패 → heldAssets undefined 유지, 기존 폴백 동작 */ }
    })();
    return () => { cancelled = true; };
  }, [clientId, client.assetSize]);

  useEffect(() => { onHeldAssetsChange?.(heldAssets); }, [heldAssets, onHeldAssetsChange]);

  const model = useMemo(() => buildPortfolioViewModel(client, researchItems, heldAssets), [client, researchItems, heldAssets]);
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
    let cancelled = false;

    async function loadBenchmarks() {
      try {
        const res = await fetch('/api/benchmarks', { cache: 'no-store' });
        if (!res.ok) throw new Error('benchmark api failed');
        const data = (await res.json()) as BenchmarkApiResponse;
        if (cancelled) return;

        if (Array.isArray(data.points) && data.points.length > 0) {
          setBenchmarkPoints(data.points);
          setProxyReturns(Array.isArray(data.proxyReturns) ? data.proxyReturns : []);
          setBenchmarkSource(data.source ?? 'Naver Finance market API');
          setBenchmarkFallback(Boolean(data.fallback));
          setBenchmarkUpdatedAt(data.updatedAt);
          return;
        }

        throw new Error('benchmark points missing');
      } catch {
        if (!cancelled) {
          setBenchmarkPoints(FALLBACK_BENCHMARK_POINTS);
          setProxyReturns([]);
          setBenchmarkSource('로컬 예비 데이터');
          setBenchmarkFallback(true);
          setBenchmarkUpdatedAt(undefined);
        }
      }
    }

    loadBenchmarks();
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
    setLiquidityAmount(model.liquidityReserveManwon);
  }, [hasManualEdit, model.liquidityReserveManwon, model.recommendedId, portfolioOptions]);

  const adjustedWeights = useMemo(() => {
    return { ...weights, els: 0 };
  }, [weights]);

  const benchmarkTargetReturn = useMemo(
    () => latestBenchmarkTarget(benchmarkPoints, model.preferenceProfile),
    [benchmarkPoints, model.preferenceProfile],
  );
  const selectedRiskTilt = riskTiltForOption(selectedBase);
  const displayPortfolioOptions = useMemo(
    () =>
      portfolioOptions.map((option) => {
        const optionFeasibility = evaluatePreferenceFeasibility(option.weights, model.preferenceProfile, {
          riskTilt: riskTiltForOption(option.id),
          benchmarkTargetReturn,
          liquidityReasons: model.preferenceFeasibility.liquidityReasons,
        });
        const optionMetrics = preferenceAdjustedMetrics(
          option.weights,
          model.preferenceProfile,
          riskTiltForOption(option.id),
          benchmarkTargetReturn,
          optionFeasibility,
        );
        const optionHoldings = buildDetailedHoldings(option.weights, model.preferenceProfile, option.id);
        const proxyExpectedReturn = proxyReturns.length > 0
          ? calculatePortfolioProxyReturn(
              option.weights,
              proxyReturns,
              optionHoldings.filter((holding) => holding.bucket === 'etf').map((holding) => ({ name: holding.name, weight: holding.weight })),
            ).annualizedReturnPct
          : optionMetrics.expectedReturn;
        return {
          ...option,
          expectedReturn: proxyExpectedReturn,
          volatility: optionMetrics.volatility,
          mdd: optionMetrics.mdd,
          taxReturn: optionMetrics.taxReturn,
        };
      }),
    [benchmarkTargetReturn, model.preferenceFeasibility.liquidityReasons, model.preferenceProfile, portfolioOptions, proxyReturns],
  );
  const selectedFeasibility = useMemo(
    () =>
      evaluatePreferenceFeasibility(adjustedWeights, model.preferenceProfile, {
        riskTilt: selectedRiskTilt,
        benchmarkTargetReturn,
        liquidityReasons: model.preferenceFeasibility.liquidityReasons,
      }),
    [adjustedWeights, benchmarkTargetReturn, model.preferenceFeasibility.liquidityReasons, model.preferenceProfile, selectedRiskTilt],
  );
  const metrics = useMemo(
    () => preferenceAdjustedMetrics(adjustedWeights, model.preferenceProfile, selectedRiskTilt, benchmarkTargetReturn, selectedFeasibility),
    [adjustedWeights, benchmarkTargetReturn, model.preferenceProfile, selectedFeasibility, selectedRiskTilt],
  );
  const volatilityRanges = useMemo(() => getVolatilityRanges(metrics.volatility), [metrics.volatility]);
  const benchmarkChartData = useMemo(
    () => buildSimplifiedBenchmarkChartData(
      benchmarkPoints,
      adjustedWeights,
      buildDetailedHoldings(adjustedWeights, model.preferenceProfile, selectedBase),
      selectedRiskTilt,
    ),
    [adjustedWeights, benchmarkPoints, model.preferenceProfile, selectedBase, selectedRiskTilt],
  );
  const selectedDetailedHoldings = useMemo(
    () => buildDetailedHoldings(adjustedWeights, model.preferenceProfile, selectedBase),
    [adjustedWeights, model.preferenceProfile, selectedBase],
  );
  const proxyReturnSummary = useMemo(
    () => proxyReturns.length > 0
      ? calculatePortfolioProxyReturn(
          adjustedWeights,
          proxyReturns,
          selectedDetailedHoldings.filter((holding) => holding.bucket === 'etf').map((holding) => ({ name: holding.name, weight: holding.weight })),
        )
      : null,
    [adjustedWeights, proxyReturns, selectedDetailedHoldings],
  );
  const stressParams = useMemo(
    () => setToMacroApiParams(adjustedWeights, selectedDetailedHoldings.filter((holding) => holding.bucket === 'etf').map((holding) => ({ name: holding.name, weight: holding.weight }))),
    [adjustedWeights, selectedDetailedHoldings],
  );
  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ summary: 'range', us: String(stressParams.us), kr: String(stressParams.kr), bond: String(stressParams.bond) });
    fetch(`/api/macro-stress?${query}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('stress range unavailable')))
      .then((value: HistoricalStressRangeResponse) => { if (!cancelled) setStressRange(value); })
      .catch(() => { if (!cancelled) setStressRange(null); });
    return () => { cancelled = true; };
  }, [stressParams.bond, stressParams.kr, stressParams.us]);
  const stressLossRange = useMemo(() => {
    if (!stressRange?.scenarios.length) return null;
    const coverage = stressParams.equityBondPct / 100;
    const losses = stressRange.scenarios.map((scenario) => scenario.actualMdd * coverage * 100);
    return { low: Math.min(...losses), high: Math.max(...losses), count: losses.length };
  }, [stressParams.equityBondPct, stressRange]);
  const displayedExpectedReturn = proxyReturnSummary?.annualizedReturnPct ?? metrics.expectedReturn;
  const returnEstimateLabel = !proxyReturnSummary || proxyReturnSummary.fallbackUsed
    ? '일부 자산군은 시장 데이터 미연결로 fallback 추정치를 사용했습니다.'
    : RETURN_ESTIMATE_LABEL;
  const detailBuckets = useMemo(
    () =>
      (Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
        .filter(([, weight]) => weight > 0)
        .map(([asset, weight]) => ({
          asset,
          weight,
          holdings: selectedDetailedHoldings.filter((holding) => holding.bucket === asset),
        }))
        .filter((bucket) => bucket.holdings.length > 0),
    [adjustedWeights, selectedDetailedHoldings],
  );
  const totalWeight = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
  const weightDiff = 100 - totalWeight;
  const selectedOption = displayPortfolioOptions.find((option) => option.id === selectedBase) ?? displayPortfolioOptions[1];
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
  const selectedExecutiveConclusion = `${currentPortfolioName}입니다. 7요인, 현금흐름, 최신 리서치를 반영해 현재 비중을 산출했습니다. ${
    model.preferenceProfile.hasRequirement && !selectedFeasibility.feasible
      ? '고유 요구조건의 공격적 수익·위험 가정은 실제 비중으로 달성 불가해 KPI에서 제외했습니다.'
      : model.preferenceProfile.hasRequirement
        ? '고유 요구조건은 달성 가능 범위에서 반영했습니다.'
        : '고객 입력 조건 기준으로 산출했습니다.'
  } ${selectedProfile.clientMessage}`;

  useEffect(() => {
    if (!onSelectionChange) return;
    const allocations = buildMacroStressAllocations(selectedDetailedHoldings);

    onSelectionChange({
      id: selectedBase,
      label: selectedOption.name,
      allocations,
      expectedReturn: displayedExpectedReturn,
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
    selectedDetailedHoldings,
    metrics,
    displayedExpectedReturn,
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
    <div className="space-y-6 rounded-2xl bg-surface-2 p-4 text-fg md:p-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-slate-900 p-5 text-white shadow-sm md:flex-row md:items-center">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
            Samsung Securities Young Creator PB Center
          </span>
          <h1 className="mt-1 text-xl font-bold tracking-tight">VIP 맞춤형 자산배분 제안 시스템</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
            7요인 분석 → 현금흐름 분석 → 리포트 및 리서치 분석 → 포트폴리오 산출 순서로 추천합니다.
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

      {/* 자산 3층 구조 요약 카드 */}
      {model.assetLayer ? (
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
              <h3 className="text-base font-bold text-fg">실제 보유자산 구조</h3>
            </div>
            <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              이 SET은 투자가능자산 {formatWonShort(model.assetLayer.investableKrw)} 기준으로 산출됩니다
            </span>
          </div>

          {model.assetLayer.realEstateWarning && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <span className="mt-0.5 text-amber-500 text-sm font-black">⚠</span>
              <p className="text-xs font-semibold text-amber-800">{model.assetLayer.realEstateWarning}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-center">
              <span className="block text-[10px] font-medium text-fg-muted">총자산</span>
              <span className="block text-sm font-black text-fg mt-0.5">{formatWonShort(model.assetLayer.totalKrw)}</span>
            </div>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
              <span className="block text-[10px] font-medium text-blue-700">투자가능자산</span>
              <span className="block text-sm font-black text-blue-800 mt-0.5">{formatWonShort(model.assetLayer.investableKrw)}</span>
              <span className="block text-[9px] text-blue-500 mt-0.5">총자산 - 부동산</span>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-center">
              <span className="block text-[10px] font-medium text-fg-muted">부동산</span>
              <span className={`block text-sm font-black mt-0.5 ${model.assetLayer.realEstateWarning ? 'text-amber-600' : 'text-fg'}`}>
                {formatWonShort(model.assetLayer.totalKrw - model.assetLayer.investableKrw)}
              </span>
              <span className="block text-[9px] text-fg-muted mt-0.5">운용 제외</span>
            </div>
          </div>

          {/* 비중 막대 */}
          <div>
            <div className="flex h-3 w-full overflow-hidden rounded-full gap-px">
              {model.assetLayer.stocksPct > 0 && (
                <div style={{ width: `${model.assetLayer.stocksPct}%` }} className="bg-blue-600" title={`주식 ${model.assetLayer.stocksPct.toFixed(1)}%`} />
              )}
              {model.assetLayer.realEstatePct > 0 && (
                <div style={{ width: `${model.assetLayer.realEstatePct}%` }} className={model.assetLayer.realEstateWarning ? 'bg-amber-500' : 'bg-amber-400'} title={`부동산 ${model.assetLayer.realEstatePct.toFixed(1)}%`} />
              )}
              {model.assetLayer.cashPct > 0 && (
                <div style={{ width: `${model.assetLayer.cashPct}%` }} className="bg-slate-400" title={`현금·기타 ${model.assetLayer.cashPct.toFixed(1)}%`} />
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[10px] text-fg-muted">
              <span><span className="inline-block w-2 h-2 rounded-sm bg-blue-600 mr-1 align-middle" />주식 {model.assetLayer.stocksPct.toFixed(1)}%</span>
              <span><span className={`inline-block w-2 h-2 rounded-sm mr-1 align-middle ${model.assetLayer.realEstateWarning ? 'bg-amber-500' : 'bg-amber-400'}`} />부동산 {model.assetLayer.realEstatePct.toFixed(1)}%</span>
              <span><span className="inline-block w-2 h-2 rounded-sm bg-slate-400 mr-1 align-middle" />현금·기타 {model.assetLayer.cashPct.toFixed(1)}%</span>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-xs text-fg-muted">
          실제 보유자산 정보 없음 — SET은 등록된 총자산 기준으로 산출됩니다.
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gold-500"></span>
            <h3 className="text-base font-bold text-fg">단계별 산출 흐름</h3>
          </div>
          <span className="text-[11px] font-medium text-fg-muted">분석 입력값 기반 추천 엔진</span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {model.calculationSteps.map((step) => (
            <div key={step.order} className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-navy-800 text-[11px] font-black text-gold-300">
                  {step.order}
                </span>
                <p className="text-xs font-black text-fg">{step.title}</p>
              </div>
              <p className="text-[11px] font-semibold leading-relaxed text-fg">{step.detail}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{step.impact}</p>
            </div>
          ))}
        </div>
      </section>

     <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* 왼쪽 2열: Recommended Conclusion + KPI 카드 (Compact 디자인 적용) */}
        <div className="xl:col-span-7 overflow-hidden rounded-xl border border-border bg-slate-900 shadow-sm">
        <div className="h-full bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-5 text-white space-y-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
                <div>
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                    Recommended Conclusion
                  </span>
                  <h2 className="text-xl font-black text-white mt-1">{currentPortfolioName}</h2>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-200 border border-slate-700">
                    #{model.clientSummary.clientType}
                  </span>
                  <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-200 border border-blue-500/30">
                    #{model.clientSummary.riskPropensity}
                  </span>
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-200 border border-rose-500/30">
                    #세금 {model.clientSummary.taxSensitivity}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {selectedExecutiveConclusion}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                본 포트폴리오는 고객 위험성향별 모델 포트폴리오를 기준으로 출발하며, 이후 현금흐름·세금·유동성·투자기간 등 고객 요인에 따라 조정됩니다.
              </p>
            </div>

	            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
	              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
	                <span className="block text-[10px] font-medium text-fg-muted">
	                  예상 수익률{!selectedFeasibility.feasible ? ' (비중 기반)' : ''}
	                </span>
	                <span className={`mt-0.5 block text-xl font-black ${selectedFeasibility.feasible ? 'text-emerald-400' : 'text-amber-300'}`}>
	                  {displayedExpectedReturn}%
	                </span>
	                <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">{returnEstimateLabel}</span>
	                {!selectedFeasibility.feasible && (
	                  <span className="mt-1 block text-[9px] font-bold text-rose-200">
	                    요구 {selectedFeasibility.requestedTargetReturn ?? '-'}% 미반영
	                  </span>
	                )}
	              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-fg-muted">세후 가상수익률</span>
                <span className="mt-0.5 block text-xl font-black text-blue-400">{metrics.taxReturn}%</span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-fg-muted">포트폴리오 변동성</span>
                <span className="mt-0.5 block text-xl font-black text-slate-200">{metrics.volatility}%</span>
                <span className="mt-1 block text-[9px] leading-relaxed text-slate-400">일반 시장 범위 {volatilityRanges.normalLow}~{volatilityRanges.normalHigh}%</span>
                <span className="block text-[9px] leading-relaxed text-amber-200/80">{stressLossRange ? `스트레스 손실 범위 ${stressLossRange.low.toFixed(1)}~${stressLossRange.high.toFixed(1)}%` : '스트레스 손실 범위 불러오는 중'}</span>
                <span className="mt-1 block text-[9px] leading-relaxed text-slate-500">일반 범위는 평상시 변동성 추정치이며, 스트레스 손실 범위는 과거 위기 시나리오 적용 시 최대낙폭(MDD) 기준입니다.</span>
                {false && <>
                <span className="mt-1 block text-[9px] leading-relaxed text-slate-400">평상시 {volatilityRanges.normalLow}~{volatilityRanges.normalHigh}%</span>
                <span className="block text-[9px] leading-relaxed text-amber-200/80">위기 {volatilityRanges.stressLow}~{volatilityRanges.stressHigh}%</span>
                <span className="mt-1 block text-[9px] text-slate-500" title="대표지수 proxy 변동성·상관관계 기반 연율화 추정치">proxy 기반 연율화 추정치</span>
                </>}
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-fg-muted">시뮬레이션 MDD</span>
                <span className="mt-0.5 block text-xl font-black text-rose-400">{metrics.mdd}%</span>
	              </div>
	            </div>
	            {proxyReturnSummary && (
	              <div className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/40 p-3 text-[10px] text-slate-300">
	                <p className="font-bold text-slate-100">최근 5년 시장 proxy 연율화 참고 수익률 구성</p>
	                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
	                  {proxyReturnSummary.estimates.map((estimate) => (
	                    <span key={estimate.key}>
	                      {estimate.label} · {estimate.proxy} · {estimate.annualizedReturnPct.toFixed(1)}%
	                      {estimate.fallback ? ' · fallback' : ` · ${estimate.usedYears.toFixed(1)}년`}
	                    </span>
	                  ))}
	                </div>
	              </div>
	            )}
	            {!selectedFeasibility.feasible && (
	              <div className="rounded-lg border border-rose-400/70 bg-rose-950/60 p-3 text-xs leading-relaxed text-rose-50">
	                <p className="font-black text-white">PB 세부 커스텀 조정 필요</p>
	                <p className="mt-1">
	                  현재 비중 기준 기대수익률 {selectedFeasibility.weightBasedReturn}% / 변동성 {selectedFeasibility.weightBasedVolatility}%입니다.
	                  MMF floor {selectedFeasibility.mmfFloorPct}% 기준 최대 가능 수익률은 {selectedFeasibility.maxAchievableReturn}%로,
	                  감지된 공격적 수익·위험 가정은 KPI에 반영하지 않았습니다.
	                </p>
	                {selectedFeasibility.liquidityReasons.length > 0 && (
	                  <p className="mt-1 font-semibold text-rose-100">
	                    유동성 근거: {selectedFeasibility.liquidityReasons.join(' · ')}
	                  </p>
	                )}
	              </div>
	            )}
	          </div>
	        </div>

        {/* 오른쪽 1열: 도넛형 자산비중 프리뷰 카드 */}
        <div className="xl:col-span-5 rounded-xl border border-border bg-surface p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 pb-2 border-b border-border mb-3">
              <span className="h-2 w-2 rounded-full bg-blue-600"></span>
              <h3 className="font-bold text-fg text-sm">포트폴리오 자산 배분 비중</h3>
            </div>

            <div className="flex flex-row items-center justify-between gap-6 py-3">
              {/* SVG 원형 도넛 차트 */}
              <div className="relative w-40 h-40 xl:w-44 xl:h-44 flex-shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 42 42">
                  <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#f1f5f9" strokeWidth="4" />
                  {(() => {
                    const total = Object.values(adjustedWeights).reduce((a, b) => a + b, 0) || 1;
                    let currentAccum = 0;
                    const assetSvgColors: Record<WeightKey, string> = {
                      etf: '#2563eb', bond: '#0ea5e9', els: '#f59e0b', mmf: '#4f46e5', gold: '#eab308', dollar: '#475569', raw: '#78716c'
                    };
                    return (Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
                      .filter(([, w]) => w > 0)
                      .map(([asset, w]) => {
                        const percentage = (w / total) * 100;
                        const dashArray = `${percentage} ${100 - percentage}`;
                        const dashOffset = 25 - currentAccum;
                        currentAccum += percentage;
                        return (
                          <circle
                            key={asset}
                            cx="21"
                            cy="21"
                            r="15.915"
                            fill="transparent"
                            stroke={assetSvgColors[asset] || '#cbd5e1'}
                            strokeWidth="4.5"
                            strokeDasharray={dashArray}
                            strokeDashoffset={dashOffset}
                          />
                        );
                      });
                  })()}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] text-fg-muted font-bold uppercase">SUM</span>
                  <span className="text-xl font-black text-fg">{totalWeight}%</span>
                </div>
              </div>

              {/* 우측 인라인 자산군 범례 */}
              <div className="grid grid-cols-1 gap-2 w-full max-w-[220px] text-sm">
                {(Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
                  .filter(([, weight]) => weight > 0)
                  .map(([asset, weight]) => (
                    <div key={asset} className="flex items-center justify-between border-b border-border pb-0.5">
                      <div className="flex items-center space-x-1.5">
                        <span className={`w-1.5 h-1.5 rounded-sm ${barColors[asset]} block flex-shrink-0`}></span>
                        <span className="text-sm font-medium text-fg-muted">{weightLabels[asset]}</span>
                      </div>
                      <span className="text-base font-black text-fg">{weight}%</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          {/* 보유 주식 vs SET 목표 주식 비중 비교 */}
          {model.assetLayer && model.assetLayer.investableKrw > 0 && (() => {
            const currentStocksPct = Math.round(
              (model.assetLayer!.stocksPct / 100 * model.assetLayer!.totalKrw)
              / model.assetLayer!.investableKrw * 1000
            ) / 10;
            const targetStocksPct = adjustedWeights.etf ?? 0;
            const diff = Math.round((targetStocksPct - currentStocksPct) * 10) / 10;
            const isOverweight = diff < -5;
            const isUnderweight = diff > 5;
            return (
              <div className="mt-2 rounded border border-border bg-surface-2 px-3 py-2 text-[11px]">
                <p className="font-semibold text-fg-muted mb-1.5">주식 비중 비교 (투자가능자산 기준)</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">현재 보유</span>
                  <span className="font-black text-fg">{currentStocksPct.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">SET 목표</span>
                  <span className="font-black text-blue-700">{targetStocksPct}%</span>
                </div>
                <div className={`mt-1 pt-1 border-t border-border flex items-center justify-between gap-2 font-semibold ${isOverweight ? 'text-amber-600' : isUnderweight ? 'text-blue-600' : 'text-emerald-600'}`}>
                  <span>{isOverweight ? '현재 과다 — 일부 축소 검토' : isUnderweight ? '부족분 추가 매수 가능' : '목표 범위 내'}</span>
                  <span>{diff > 0 ? '+' : ''}{diff.toFixed(1)}%p</span>
                </div>
              </div>
            );
          })()}

          <div className="text-[10px] text-fg-muted text-center bg-surface-2 p-1.5 rounded border border-border mt-2">
            하단 편집기 조율 시 위 도넛 비중이 연동 갱신됩니다.
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
            <h3 className="text-base font-bold text-fg">선택안 세부 추천 자산</h3>
          </div>
          <span className="text-[11px] font-medium text-fg-muted">
            자산군 내부 비중까지 합산 100%
          </span>
        </div>

        <p className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
          위 자산배분 비중을 실제 제안서에서 설명할 수 있도록 세부 후보로 나눴습니다.
          각 비중은 전체 포트폴리오 기준이며, PB 검토와 고객 적합성 확인 전제의 예시입니다.
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {detailBuckets.map(({ asset, weight, holdings }) => (
            <div key={asset} className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-sm ${barColors[asset]}`}></span>
                  <p className="text-sm font-black text-fg">{weightLabels[asset]}</p>
                </div>
                <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-black text-fg">
                  {weight}%
                </span>
              </div>
              <div className="space-y-2">
                {holdings.map((holding) => (
                  <div key={`${asset}-${holding.name}`} className="rounded-lg border border-white bg-surface px-3 py-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-fg">{holding.name}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-fg-muted">{holding.role}</p>
                      </div>
                      <span className="shrink-0 text-sm font-black text-blue-700">{holding.weight}%</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        {holding.taxNote}
                      </span>
                      <span className="rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
                        {holding.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <SimplifiedBenchmarkReturnChart
        data={benchmarkChartData}
        source={benchmarkSource}
        fallback={benchmarkFallback}
        updatedAt={benchmarkUpdatedAt}
      />

      <ObjectiveMetricsTable
        data={benchmarkChartData}
        source={benchmarkSource}
        fallback={benchmarkFallback}
        updatedAt={benchmarkUpdatedAt}
        weights={adjustedWeights}
        planSummary={planSummary}
        sectorEtfData={sectorEtfData}
      />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
            <h3 className="text-base font-bold text-fg">고객 고유 요구조건 반영</h3>
          </div>
          <span className="text-[11px] font-medium text-fg-muted">
            고유상황 입력값 자동 해석
          </span>
        </div>

	        {model.preferenceProfile.hasRequirement ? (
	          <>
	            {!selectedFeasibility.feasible && (
	              <div className="mb-4 rounded-xl border-2 border-rose-500 bg-rose-50 p-4">
	                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
	                  <div>
	                    <p className="text-sm font-black text-rose-800">PB 세부 커스텀 조정 필요</p>
	                    <p className="mt-1 text-xs leading-relaxed text-rose-900">
	                      고객 고유 요구조건은 감지했지만 현재 현금흐름·세금 납부용 MMF 선확보와 충돌합니다.
	                      공격적 수익률·위험도 가정은 포트폴리오 KPI에 반영하지 않았습니다.
	                    </p>
	                  </div>
	                  <div className="grid min-w-[220px] grid-cols-2 gap-2 text-xs">
	                    <div className="rounded-lg bg-surface px-3 py-2">
	                      <span className="block text-fg-muted">비중 기반 수익률</span>
	                      <span className="mt-0.5 block text-lg font-black text-fg">{selectedFeasibility.weightBasedReturn}%</span>
	                    </div>
	                    <div className="rounded-lg bg-surface px-3 py-2">
	                      <span className="block text-fg-muted">상한 추정</span>
	                      <span className="mt-0.5 block text-lg font-black text-fg">{selectedFeasibility.maxAchievableReturn}%</span>
	                    </div>
	                  </div>
	                </div>
	                <div className="mt-3 grid grid-cols-1 gap-2 text-xs lg:grid-cols-2">
	                  <div className="rounded-lg border border-rose-100 bg-surface px-3 py-2">
	                    <p className="font-bold text-rose-800">미반영 항목</p>
	                    <p className="mt-1 leading-relaxed text-fg-muted">
	                      {selectedFeasibility.suppressedPreferences.join(' · ')}
	                    </p>
	                  </div>
	                  <div className="rounded-lg border border-rose-100 bg-surface px-3 py-2">
	                    <p className="font-bold text-rose-800">충돌 근거</p>
	                    <p className="mt-1 leading-relaxed text-fg-muted">
	                      {selectedFeasibility.conflicts.join(' ')}
	                    </p>
	                  </div>
	                </div>
	              </div>
	            )}
	          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
	            <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 lg:col-span-2">
	              <p className="text-xs font-bold text-rose-800">
	                감지된 요구조건{!selectedFeasibility.feasible ? ' (KPI 미반영)' : ''}
	              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {model.preferenceProfile.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-rose-200 bg-surface px-2.5 py-1 text-[11px] font-bold text-rose-700">
                    {tag}
                  </span>
                ))}
              </div>
	              <p className="mt-3 text-xs leading-relaxed text-rose-900">
	                {selectedFeasibility.feasible
	                  ? model.rationale.preference
	                  : '요구조건은 기록하되 현재 포트폴리오 지표에는 반영하지 않습니다. PB가 세금 납부 일정, 매각 가능 자산, 위험예산을 재확인해 별도 커스텀안을 작성해야 합니다.'}
	              </p>
	              {model.preferenceProfile.benchmarkOutperformance && (
	                <div className="mt-3 rounded-lg border border-rose-200 bg-surface px-3 py-2">
	                  <p className="text-[11px] font-bold text-rose-800">
	                    벤치마크 초과수익 {selectedFeasibility.feasible ? '반영 방식' : '미반영'}
	                  </p>
	                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
	                    {selectedFeasibility.feasible
	                      ? `${model.preferenceProfile.benchmarkTargets.length > 0
	                        ? `${model.preferenceProfile.benchmarkTargets.join("·")} 대비 초과수익`
	                        : "벤치마크 대비 초과수익"}을 목표 요구조건으로 감지했습니다. 추천안은 수익추구형을 우선 선택하고, ETF·테마주·해외주식 버킷을 늘리는 대신 채권·MMF 방어 비중은 낮춰 알파 추구형으로 조정합니다.`
	                      : '벤치마크 초과수익 요구는 현재 MMF/RP 유동성 floor와 충돌하므로 KPI 수익률·위험도 상향에 사용하지 않습니다.'}
	                  </p>
	                </div>
	              )}
              {model.preferenceProfile.taxPriority && (
                <div className="mt-3 rounded-lg border border-green-200 bg-surface px-3 py-2">
                  <p className="text-[11px] font-bold text-green-800">절세 최우선 반영 방식</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    세금 최소화 요구를 최우선 조건으로 감지했습니다. 추천안은 안정형을 우선 선택하고,
                    브라질 국채 비과세 검토, 국내 상장주식 장내거래, 개별채권 직접투자 매매차익,
                    연금저축·IRP 과세이연 계좌를 먼저 배치합니다. 수익률과 위험도는 세후 효율을 해치지 않는
                    범위에서만 보조적으로 반영합니다.
                  </p>
                </div>
              )}
              {model.preferenceProfile.rawText && (
                <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                  입력 문장: {model.preferenceProfile.rawText}
                </p>
              )}
            </div>
	            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
	              <p className="text-xs font-bold text-amber-800">
	                {selectedFeasibility.feasible ? 'PB 확인 필요' : 'PB 세부 커스텀 조정 필요'}
	              </p>
	              <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-900">
	                {!selectedFeasibility.feasible ? (
	                  selectedFeasibility.conflicts.map((warning) => <li key={warning}>• {warning}</li>)
	                ) : model.preferenceProfile.warnings.length > 0 ? (
	                  model.preferenceProfile.warnings.map((warning) => <li key={warning}>• {warning}</li>)
	                ) : (
	                  <li>• 요구조건과 적합성·현금화 일정의 충돌 여부를 상담에서 최종 확인하세요.</li>
	                )}
	              </ul>
	            </div>
	          </div>
	          </>
	        ) : (
          <p className="rounded-xl border border-border bg-surface-2 p-4 text-xs leading-relaxed text-fg-muted">
            고유상황에 “해외주식 단일종목만”, “기대수익률 20% 이상”, “세금을 최대한 적게 내고 싶다”처럼 명시된 요구가 있으면 이 영역에 자동 표시되고 포트폴리오 비중과 근거에 반영됩니다.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5">
        

        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
              <h3 className="text-base font-bold text-fg">선택안별 리서치 반영 상태</h3>
            </div>
            <span className="text-[11px] font-medium text-fg-muted">
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
              <div key={signal.signal} className="rounded-xl border border-border bg-surface-2 p-3">
                <span className="block text-[11px] font-semibold text-fg-muted">{signal.label}</span>
                <span className="mt-1 block text-lg font-black text-fg">{signal.score}</span>
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
                  className="rounded-xl border border-border text-xs transition hover:border-blue-200"
                >
                  <button
                    type="button"
                    onClick={() => setOpenReportId(isOpen ? null : item.id)}
                    className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-blue-50/40"
                  >
                    <span className="min-w-0">
                      <span className="block font-bold text-fg">{item.title}</span>
                      <span className="mt-0.5 block text-[11px] text-fg-muted">
                        {item.source}
                        {item.date ? ` · ${item.date}` : ''}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-[11px] text-fg-muted">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-border px-3 py-2.5">
                      {analyzed?.summary ? (
                        <p className="text-[11px] leading-relaxed text-fg-muted">{analyzed.summary}</p>
                      ) : (
                        <p className="text-[11px] leading-relaxed text-fg-muted">
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

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
          <h3 className="text-base font-bold text-fg">분석 기반 추천안 3개 비교</h3>
        </div>

        {/* 부동산 과다 경고 — 배분 차단 없이 정보 제공 */}
        {model.assetLayer?.realEstateWarning && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4">
            <span className="mt-0.5 text-2xl leading-none">⚠️</span>
            <div>
              <p className="text-sm font-bold text-amber-800">{model.assetLayer.realEstateWarning}</p>
              <p className="mt-1 text-xs text-amber-700">
                부동산은 SET 운용 대상에서 제외됩니다.
                아래 3개 추천안은 <span className="font-bold">투자가능자산 {formatWonShort(model.assetLayer.investableKrw)}</span> 기준으로 산출되었으며,
                부동산 관련 의사결정은 PB 자문 및 전문가 상담 영역입니다.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {displayPortfolioOptions.map((option) => {
            const isSelected = selectedBase === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleBaseChange(option.id)}
                className={`rounded-2xl border p-5 text-left transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/30 shadow-md ring-4 ring-blue-50'
                    : 'border-border bg-surface opacity-75 hover:border-border hover:opacity-100'
                }`}
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-bold text-fg">{option.name}</h4>
                  {isSelected && (
                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                      Active
                    </span>
                  )}
                </div>
                <table className="mb-3 w-full text-xs">
                  <tbody>
                    <tr className="border-b border-border">
                      <td className="py-1 text-fg-muted">기대수익률</td>
                      <td className="py-1 text-right font-bold text-emerald-600">{option.expectedReturn}%</td>
                    </tr>
                    <tr className="border-b border-border">
                      <td className="py-1 text-fg-muted">세후수익률</td>
                      <td className="py-1 text-right font-bold text-blue-600">{option.taxReturn}%</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-fg-muted">최대낙폭</td>
                      <td className="py-1 text-right font-medium text-rose-500">{option.mdd}%</td>
                    </tr>
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-1">
                  {option.mainProducts.map((product) => (
                    <span key={product} className="rounded border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                      {product}
                    </span>
                  ))}
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <p className="mb-1.5 text-[10px] font-bold text-fg-muted">세부 비중 미리보기</p>
                  <div className="space-y-1">
                    {option.detailedHoldings.slice(0, 4).map((holding) => (
                      <div key={`${option.id}-${holding.bucket}-${holding.name}`} className="flex items-center justify-between gap-2 text-[10px]">
                        <span className="min-w-0 truncate text-fg-muted">{holding.name}</span>
                        <span className="shrink-0 font-black text-fg">{holding.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600"></span>
          <h3 className="text-base font-bold text-fg">포트폴리오 산출 근거</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface-2 p-3 lg:col-span-2">
            <p className="text-xs font-bold text-fg">시장 리포트 근거</p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              {currentPortfolioName}은 {selectedProfile.emphasis} 아래 리포트들을 근거로 {selectedProfile.allocationLogic}
            </p>
            <ul className="mt-2 space-y-2">
              {marketReportReasons.map((r) => (
                <li key={r.id} className="border-l-2 border-indigo-200 pl-2 text-xs leading-relaxed">
                  <span className="font-semibold text-fg">{r.title}</span>
                  <span className="text-[11px] text-fg-muted"> · {r.source}</span>
                  <span className="mt-0.5 block text-fg-muted">근거: {r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
          <ReasonBlock title="고객 정보 반영" body={model.rationale.client} />
          <ReasonBlock title="현금흐름 반영" body={model.rationale.cashflow} />
          <ReasonBlock title="세금 납부일 반영" body={model.rationale.tax} />
          <ReasonBlock title="요구조건 반영" body={model.rationale.preference} />
          <ReasonBlock title="고유상황 반영" body={model.rationale.unique} wide />
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs font-bold text-fg">현금흐름 핵심 숫자</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <span className="text-fg-muted">월 유입</span>
              <span className="text-right font-bold">{formatWonShort(model.cashflowSummary.monthlyIncome)}</span>
              <span className="text-fg-muted">월 유출</span>
              <span className="text-right font-bold">{formatWonShort(model.cashflowSummary.monthlyOutflow)}</span>
              <span className="text-fg-muted">세금성 예정 유출</span>
              <span className="text-right font-bold text-rose-600">{formatWonShort(model.cashflowSummary.taxOutflow)}</span>
              <span className="text-fg-muted">단기 분리 제안액</span>
              <span className="text-right font-bold text-indigo-600">{liquidityAmount.toLocaleString()}만원</span>
            </div>
          </div>
        </div>
      </section>

      {model.taxPainPoints.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-surface p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-emerald-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
              <h3 className="text-base font-bold text-fg">고액자산가 주요 세금 고충 참고</h3>
            </div>
            <TaxPainRubricButton label="AI 세금 고충 기준표 확인" />
          </div>

          <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            실제 고액자산가 상담에서 자주 나오는 세금 이슈를 고객의 현금흐름·고유상황과 대조해 상/중/하로 정량 분류했습니다.
            확정 절세 판단이 아니라 PB와 세무전문가가 확인해야 할 우선순위입니다.
          </p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {model.taxPainPoints.map((point) => (
              <div key={point.id} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-fg">{point.label}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      point.severity === "상"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : point.severity === "중"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-border bg-surface text-fg-muted"
                    }`}
                  >
                    {point.severity}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">{point.whyItMatters}</p>
                <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                  <b className="text-fg">정량 근거</b> {point.basis.join(" · ")}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-emerald-800">상담 사유: {point.portfolioResponse}</p>
                  <TaxPainRubricButton id={point.id} />
                </div>
                {(point.severity === "상" || point.severity === "중") && (
                  <p className="mt-2 text-[11px] font-bold text-emerald-800">
                    {point.id === "inheritance-gift" ? "삼성헤리티지 컨설팅 검토 필요" : "삼성 WM센터 전문 세무 상담 권고"}
                  </p>
                )}
                <a
                  href={point.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[11px] font-medium text-blue-600 underline hover:text-blue-700"
                >
                  출처: {point.source.label}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      <WmExpertPanel taxPainPoints={model.taxPainPoints} />

      <section className="hidden rounded-2xl border border-border bg-surface p-5 shadow-sm" aria-hidden="true">
        <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-green-600"></span>
            <h3 className="text-base font-bold text-fg">KODEX 연금저축·IRP 절세 포트폴리오</h3>
          </div>
          <span className="text-[11px] font-medium text-fg-muted">
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
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] font-semibold text-fg-muted">세액공제 대상</p>
            <p className="mt-1 text-sm font-black text-fg">{formatWonShort(model.taxSavingPlan.taxCreditBase)}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-[11px] font-semibold text-fg-muted">가정 공제율</p>
            <p className="mt-1 text-sm font-black text-fg">{Math.round(model.taxSavingPlan.creditRate * 1000) / 10}%</p>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-[11px] font-semibold text-blue-700">예상 환급액</p>
            <p className="mt-1 text-sm font-black text-blue-900">{formatWonShort(model.taxSavingPlan.estimatedCredit)}</p>
          </div>
        </div>

        <p className="mb-4 rounded-xl border border-border bg-surface-2 p-3 text-xs leading-relaxed text-fg-muted">
          {model.taxSavingPlan.clientFit}
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {model.taxSavingPlan.portfolios.map((portfolio) => (
            <div key={portfolio.accountType} className="rounded-2xl border border-border p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-fg">{portfolio.accountType} KODEX 추천안</h4>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">{portfolio.note}</p>
                </div>
                <span className="rounded-full bg-surface-2 px-2 py-1 text-[11px] font-bold text-fg-muted">
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
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-xs hover:border-green-200 hover:bg-green-50/40"
                  >
                    <span>
                      <b className="block text-fg">{holding.product.name}</b>
                      <span className="text-[11px] text-fg-muted">
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
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-xs font-bold text-fg">참고 출처</p>
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

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setIsSuitabilityOpen((value) => !value)}
          className="flex w-full items-center justify-between bg-surface-2 p-4 text-left transition-colors hover:bg-surface-2"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
            <h3 className="text-sm font-bold text-fg">상품군 투자 적합성 필터</h3>
            <span className="text-xs text-fg-muted">리서치·세금·현금흐름 기준</span>
          </div>
          <span className="text-xs font-bold text-blue-600">{isSuitabilityOpen ? '접기' : '펼쳐보기'}</span>
        </button>
        {isSuitabilityOpen && (
          <div className="overflow-x-auto p-4">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-xs text-fg-muted">
                  <th className="p-3 font-semibold">자산군</th>
                  <th className="w-24 p-3 text-center font-semibold">적합도</th>
                  <th className="p-3 font-semibold">판단 근거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {model.assetSuitability.map((item) => (
                  <tr key={item.category} className="hover:bg-surface-2/50">
                    <td className="p-3 font-bold text-fg">{item.category}</td>
                    <td className="p-3 text-center">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="p-3 font-medium text-fg-muted">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm lg:col-span-2">
          <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-600"></span>
              <h3 className="text-base font-bold text-fg">PB 커스텀 세부 비중 조율</h3>
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

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-bold text-fg">단기 유동성 분리 확보액</span>
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
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-2 accent-indigo-600"
                />
              </div>
            </div>

            <StockSectorPanel
              etfAllocKrw={((model.assetLayer?.investableKrw ?? 0) * weights.etf) / 100}
              existingHoldings={existingHoldings}
              onPlanChange={setPlanSummary}
            />
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
              <p className="border-t border-slate-800 pt-2 text-[11px] text-fg-muted">
                출처: {selectedResearchItems.slice(0, 3).map((item) => `${item.source} - ${item.title}`).join(' / ')} 등 최신 리포트/기사 최대 20개
              </p>
            </div>
          </div>

          <div
            className={`mt-5 rounded-xl px-4 py-3 text-center text-xs font-bold tracking-wide ${
              totalWeight === 100
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-slate-800 text-fg-muted'
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
      <span className="block text-xs font-medium text-fg-muted">{label}</span>
      <span className={`mt-1 block text-2xl font-black ${toneClass}`}>{value}</span>
    </div>
  );
}

function ReasonBlock({ title, body, wide }: { title: string; body: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-border bg-surface-2 p-3 ${wide ? 'lg:col-span-2' : ''}`}>
      <p className="text-xs font-bold text-fg">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-fg-muted">{body}</p>
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
      <div className="mb-1 flex items-center justify-between text-xs font-bold text-fg">
        <span>{weightLabels[asset]} 비중</span>
        {compact && <span className="text-fg-muted">{value}%</span>}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max={max}
          step="1"
          value={value}
          onChange={(event) => onChange(asset, Number(event.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-surface-2 accent-blue-600"
        />
        <div className="relative flex w-24 flex-shrink-0 items-center">
          <input
            type="number"
            min="0"
            max={max}
            value={value}
            onChange={(event) => onChange(asset, Math.min(max, Number(event.target.value)))}
            className="w-full rounded-md border border-border py-1 pl-2 pr-6 text-right text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="absolute right-2 text-xs font-semibold text-fg-muted">%</span>
        </div>
      </div>
    </div>
  );
}
