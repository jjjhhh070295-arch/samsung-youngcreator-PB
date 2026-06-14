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
  buildPortfolioViewModel,
  preferenceAdjustedMetrics,
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

interface BenchmarkApiPoint {
  date: string;
  label: string;
  sp500?: number | null;
  kospi200?: number | null;
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
}

type BenchmarkChartPoint = BenchmarkApiPoint & { portfolio: number };

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

const FALLBACK_BENCHMARK_POINTS: BenchmarkApiPoint[] = [
  { date: 'fallback-0', label: '12M 전', sp500: 0, kospi200: 0, bond: 0, gold: 0, dollar: 0, commodity: 0 },
  { date: 'fallback-1', label: '11M 전', sp500: -1.1, kospi200: -2.0, bond: 0.2, gold: 1.6, dollar: -0.4, commodity: -1.7 },
  { date: 'fallback-2', label: '10M 전', sp500: -0.2, kospi200: 1.8, bond: -0.3, gold: 0.7, dollar: 0.8, commodity: -0.6 },
  { date: 'fallback-3', label: '9M 전', sp500: 2.1, kospi200: 0.9, bond: 0.1, gold: 3.9, dollar: 1.1, commodity: 1.5 },
  { date: 'fallback-4', label: '8M 전', sp500: 3.7, kospi200: 4.4, bond: 0.8, gold: 5.4, dollar: -0.2, commodity: 0.2 },
  { date: 'fallback-5', label: '7M 전', sp500: 1.9, kospi200: 3.1, bond: 0.4, gold: 4.8, dollar: 1.7, commodity: 2.8 },
  { date: 'fallback-6', label: '6M 전', sp500: 5.2, kospi200: 6.8, bond: 1.1, gold: 7.2, dollar: 1.2, commodity: 1.9 },
  { date: 'fallback-7', label: '5M 전', sp500: 4.3, kospi200: 5.3, bond: 1.0, gold: 6.1, dollar: 2.4, commodity: 4.1 },
  { date: 'fallback-8', label: '4M 전', sp500: 7.1, kospi200: 9.5, bond: 1.7, gold: 10.4, dollar: 1.6, commodity: 3.2 },
  { date: 'fallback-9', label: '3M 전', sp500: 6.4, kospi200: 7.7, bond: 1.4, gold: 9.2, dollar: 2.9, commodity: 5.6 },
  { date: 'fallback-10', label: '2M 전', sp500: 8.8, kospi200: 11.1, bond: 2.0, gold: 12.7, dollar: 2.0, commodity: 4.3 },
  { date: 'fallback-11', label: '1M 전', sp500: 7.6, kospi200: 9.4, bond: 1.8, gold: 10.8, dollar: 1.3, commodity: 3.8 },
  { date: 'fallback-12', label: '현재', sp500: 9.2, kospi200: 6.4, bond: 2.2, gold: 11.6, dollar: 1.8, commodity: 4.9 },
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

function buildBenchmarkChartData(
  points: BenchmarkApiPoint[],
  weights: PortfolioOption['weights'],
  preference?: { benchmarkOutperformance: boolean; benchmarkTargets: string[]; highRiskAccepted: boolean },
  riskTilt: -1 | 0 | 1 = 0,
): BenchmarkChartPoint[] {
  const sourcePoints = points.length >= 2 ? points : FALLBACK_BENCHMARK_POINTS;
  const total = sourcePoints.length;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 100;

  return sourcePoints.map((point, index) => {
    const sp500 = finiteNumber(point.sp500);
    const kospi200 = finiteNumber(point.kospi200, sp500);
    const bond = finiteNumber(point.bond, fixedIncomeProxy(index, total, 3.2));
    const gold = finiteNumber(point.gold, fixedIncomeProxy(index, total, 4.0));
    const dollar = finiteNumber(point.dollar, fixedIncomeProxy(index, total, 2.3));
    const commodity = finiteNumber(point.commodity, fixedIncomeProxy(index, total, 3.6));
    const cash = fixedIncomeProxy(index, total, 3.0);
    const equityBlend = sp500 * 0.65 + kospi200 * 0.35;
    const els = equityBlend * 0.35 + bond * 0.45 + cash * 0.2;
    const basePortfolio =
      (weights.etf / totalWeight) * equityBlend +
      (weights.bond / totalWeight) * bond +
      (weights.els / totalWeight) * els +
      (weights.mmf / totalWeight) * cash +
      (weights.gold / totalWeight) * gold +
      (weights.dollar / totalWeight) * dollar +
      (weights.raw / totalWeight) * commodity;
    let portfolio = basePortfolio;

    if (preference?.benchmarkOutperformance) {
      const targetBenchmarks = [
        preference.benchmarkTargets.includes('S&P500') ? sp500 : null,
        preference.benchmarkTargets.includes('KOSPI200') ? kospi200 : null,
        preference.benchmarkTargets.includes('벤치마크') || preference.benchmarkTargets.length === 0
          ? Math.max(sp500, kospi200)
          : null,
      ].filter((value): value is number => value != null);
      const benchmarkToBeat = targetBenchmarks.length > 0 ? Math.max(...targetBenchmarks) : Math.max(sp500, kospi200);
      const finalAlpha = preference.highRiskAccepted ? [4, 8, 14][riskTilt + 1] : [2, 4, 7][riskTilt + 1];
      const alphaTarget = finalAlpha * (total <= 1 ? 0 : index / (total - 1));
      portfolio = Math.max(basePortfolio, benchmarkToBeat + alphaTarget);
    }

    return {
      ...point,
      sp500: roundPercent(sp500),
      kospi200: roundPercent(kospi200),
      portfolio: roundPercent(portfolio),
    };
  });
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
      return 'bg-gray-50 text-gray-700 border-gray-200';
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
    preference.benchmarkTargets.includes('KOSPI200') ? finiteNumber(lastPoint.kospi200, Number.NaN) : Number.NaN,
  ].filter(Number.isFinite);
  const values = targets.length > 0
    ? targets
    : [finiteNumber(lastPoint.sp500, Number.NaN), finiteNumber(lastPoint.kospi200, Number.NaN)].filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function BenchmarkReturnChart({
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
  const lastPoint = data[data.length - 1];
  const portfolioReturn = finiteNumber(lastPoint?.portfolio);
  const sp500Return = finiteNumber(lastPoint?.sp500);
  const kospi200Return = finiteNumber(lastPoint?.kospi200);
  const alphaSp500 = portfolioReturn - sp500Return;
  const alphaKospi200 = portfolioReturn - kospi200Return;
  const sourceLabel = fallback ? '일부 지연 · 백업 데이터 포함' : '실시간/지연 지수 데이터 · 최근 1년 월말 종가';
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-950">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-3 dark:border-slate-800 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-900 dark:bg-slate-100"></span>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
              실시간 지수 기반 수익률 추정
            </h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            S&P500·KOSPI200은 최근 1년 종가 경로, 포트폴리오는 현재 비중을 지수와 채권·금·달러·원자재 프록시에 대입한 누적수익률 추정치입니다.
          </p>
          <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
            {sourceLabel}
            {updatedLabel ? ` · 조회 ${updatedLabel}` : ''}
            {source ? ` · ${source}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-[280px]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              S&P500 대비
            </span>
            <b className={alphaSp500 >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}>
              {formatPercent(alphaSp500)}
            </b>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              KOSPI200 대비
            </span>
            <b className={alphaKospi200 >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}>
              {formatPercent(alphaKospi200)}
            </b>
          </div>
        </div>
      </div>

      <div className="h-[320px] w-full text-slate-700 dark:text-slate-200">
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
              name="포트폴리오"
              stroke="rgb(var(--fg))"
              strokeWidth={3}
              dot={{ r: 3, strokeWidth: 1 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              type="linear"
              dataKey="sp500"
              name="S&P500"
              stroke="#ef4444"
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
            <Line
              type="linear"
              dataKey="kospi200"
              name="KOSPI200"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 1 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-950 dark:bg-slate-100" />
          포트폴리오 {portfolioReturn.toFixed(1)}%
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-300">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          S&P500 {sp500Return.toFixed(1)}%
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/50 dark:text-blue-300">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
          KOSPI200 {kospi200Return.toFixed(1)}%
        </span>
      </div>
    </section>
  );
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
  const [benchmarkPoints, setBenchmarkPoints] = useState<BenchmarkApiPoint[]>(FALLBACK_BENCHMARK_POINTS);
  const [benchmarkSource, setBenchmarkSource] = useState('로컬 예비 데이터');
  const [benchmarkFallback, setBenchmarkFallback] = useState(true);
  const [benchmarkUpdatedAt, setBenchmarkUpdatedAt] = useState<string | undefined>();

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
    let cancelled = false;

    async function loadBenchmarks() {
      try {
        const res = await fetch('/api/benchmarks', { cache: 'no-store' });
        if (!res.ok) throw new Error('benchmark api failed');
        const data = (await res.json()) as BenchmarkApiResponse;
        if (cancelled) return;

        if (Array.isArray(data.points) && data.points.length > 0) {
          setBenchmarkPoints(data.points);
          setBenchmarkSource(data.source ?? 'Naver Finance market API');
          setBenchmarkFallback(Boolean(data.fallback));
          setBenchmarkUpdatedAt(data.updatedAt);
          return;
        }

        throw new Error('benchmark points missing');
      } catch {
        if (!cancelled) {
          setBenchmarkPoints(FALLBACK_BENCHMARK_POINTS);
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
    setElsIncluded(target.weights.els > 0);
    setLiquidityAmount(model.liquidityReserveManwon);
  }, [hasManualEdit, model.liquidityReserveManwon, model.recommendedId, portfolioOptions]);

  const adjustedWeights = useMemo(() => {
    const next = { ...weights };
    if (!elsIncluded) next.els = 0;
    return next;
  }, [elsIncluded, weights]);

  const benchmarkTargetReturn = useMemo(
    () => latestBenchmarkTarget(benchmarkPoints, model.preferenceProfile),
    [benchmarkPoints, model.preferenceProfile],
  );
  const displayPortfolioOptions = useMemo(
    () =>
      portfolioOptions.map((option) => {
        const optionMetrics = preferenceAdjustedMetrics(
          option.weights,
          model.preferenceProfile,
          riskTiltForOption(option.id),
          benchmarkTargetReturn,
        );
        return {
          ...option,
          expectedReturn: optionMetrics.expectedReturn,
          volatility: optionMetrics.volatility,
          mdd: optionMetrics.mdd,
          taxReturn: optionMetrics.taxReturn,
        };
      }),
    [benchmarkTargetReturn, model.preferenceProfile, portfolioOptions],
  );
  const selectedRiskTilt = riskTiltForOption(selectedBase);
  const metrics = useMemo(
    () => preferenceAdjustedMetrics(adjustedWeights, model.preferenceProfile, selectedRiskTilt, benchmarkTargetReturn),
    [adjustedWeights, benchmarkTargetReturn, model.preferenceProfile, selectedRiskTilt],
  );
  const benchmarkChartData = useMemo(
    () => buildBenchmarkChartData(benchmarkPoints, adjustedWeights, model.preferenceProfile, selectedRiskTilt),
    [adjustedWeights, benchmarkPoints, model.preferenceProfile, selectedRiskTilt],
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

     <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* 왼쪽 2열: Recommended Conclusion + KPI 카드 (Compact 디자인 적용) */}
        <div className="xl:col-span-7 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-sm">
        <div className="h-full bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-5 text-white space-y-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
                <div>
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                    Recommended Conclusion
                  </span>
                  <h2 className="text-xl font-black text-white mt-1">{currentPortfolioName} 조율안</h2>
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
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-slate-400">예상 수익률</span>
                <span className="mt-0.5 block text-xl font-black text-emerald-400">{metrics.expectedReturn}%</span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-slate-400">세후 가상수익률</span>
                <span className="mt-0.5 block text-xl font-black text-blue-400">{metrics.taxReturn}%</span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-slate-400">포트폴리오 변동성</span>
                <span className="mt-0.5 block text-xl font-black text-slate-200">{metrics.volatility}%</span>
              </div>
              <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-2 text-center">
                <span className="block text-[10px] font-medium text-slate-400">시뮬레이션 MDD</span>
                <span className="mt-0.5 block text-xl font-black text-rose-400">{metrics.mdd}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 오른쪽 1열: 도넛형 자산비중 프리뷰 카드 */}
        <div className="xl:col-span-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 mb-3">
              <span className="h-2 w-2 rounded-full bg-blue-600"></span>
              <h3 className="font-bold text-slate-800 text-sm">포트폴리오 자산 배분 비중</h3>
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
                  <span className="text-[10px] text-slate-400 font-bold uppercase">SUM</span>
                  <span className="text-xl font-black text-slate-900">{totalWeight}%</span>
                </div>
              </div>

              {/* 우측 인라인 자산군 범례 */}
              <div className="grid grid-cols-1 gap-2 w-full max-w-[220px] text-sm">
                {(Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
                  .filter(([, weight]) => weight > 0)
                  .map(([asset, weight]) => (
                    <div key={asset} className="flex items-center justify-between border-b border-slate-50 pb-0.5">
                      <div className="flex items-center space-x-1.5">
                        <span className={`w-1.5 h-1.5 rounded-sm ${barColors[asset]} block flex-shrink-0`}></span>
                        <span className="text-sm font-medium text-slate-600">{weightLabels[asset]}</span>
                      </div>
                      <span className="text-base font-black text-slate-900">{weight}%</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 text-center bg-slate-50 p-1.5 rounded border border-slate-100 mt-2">
            하단 편집기 조율 시 위 도넛 비중이 연동 갱신됩니다.
          </div>
        </div>
      </div>

      <BenchmarkReturnChart
        data={benchmarkChartData}
        source={benchmarkSource}
        fallback={benchmarkFallback}
        updatedAt={benchmarkUpdatedAt}
      />

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
              {model.preferenceProfile.benchmarkOutperformance && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-bold text-rose-800">벤치마크 초과수익 반영 방식</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    {model.preferenceProfile.benchmarkTargets.length > 0
                      ? `${model.preferenceProfile.benchmarkTargets.join("·")} 대비 초과수익`
                      : "벤치마크 대비 초과수익"}을 목표 요구조건으로 감지했습니다. 추천안은 수익추구형을 우선 선택하고,
                    ETF·테마주·해외주식 버킷을 늘리는 대신 채권·MMF 방어 비중은 낮춰 알파 추구형으로 조정합니다.
                  </p>
                </div>
              )}
              {model.preferenceProfile.taxPriority && (
                <div className="mt-3 rounded-lg border border-green-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-bold text-green-800">절세 최우선 반영 방식</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    세금 최소화 요구를 최우선 조건으로 감지했습니다. 추천안은 안정형을 우선 선택하고,
                    브라질 국채 비과세 검토, 국내 상장주식 장내거래, 개별채권 직접투자 매매차익,
                    연금저축·IRP 과세이연 계좌를 먼저 배치합니다. 수익률과 위험도는 세후 효율을 해치지 않는
                    범위에서만 보조적으로 반영합니다.
                  </p>
                </div>
              )}
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
            고유상황에 “해외주식 단일종목만”, “기대수익률 20% 이상”, “세금을 최대한 적게 내고 싶다”처럼 명시된 요구가 있으면 이 영역에 자동 표시되고 포트폴리오 비중과 근거에 반영됩니다.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5">
        

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

      {model.taxPainPoints.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-emerald-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
              <h3 className="text-base font-bold text-slate-800">고액자산가 주요 세금 고충 참고</h3>
            </div>
            <span className="text-[11px] font-medium text-slate-400">
              국세청·세무전문 자료 기반 체크리스트
            </span>
          </div>

          <p className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900">
            실제 고액자산가 상담에서 자주 나오는 세금 이슈를 고객의 현금흐름·고유상황과 대조했습니다.
            확정 절세 판단이 아니라 PB와 세무전문가가 확인해야 할 우선순위입니다.
          </p>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {model.taxPainPoints.map((point) => (
              <div key={point.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800">{point.label}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      point.severity === "상"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : point.severity === "중"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >
                    {point.severity}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{point.whyItMatters}</p>
                <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] leading-relaxed text-emerald-800">
                  반영: {point.portfolioResponse}
                </p>
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
