'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Portfolio } from '@/lib/types';
import {
  buildDetailedHoldings,
  buildPortfolioViewModel,
  calculateTaxDragProxy,
  evaluatePreferenceFeasibility,
  getVolatilityRanges,
  preferenceAdjustedMetrics,
  RETURN_ESTIMATE_LABEL,
  type HeldAssets,
  type PortfolioOption,
} from '@/lib/portfolio';
import { calculatePortfolioProxyReturn, type ProxyReturnEstimate } from '@/lib/proxyReturns';
import { DEFAULT_EQUITY_REGION_SPLIT, setToMacroApiParams } from '@/lib/assetMapping';
import type { HistoricalStressRangeResponse } from '@/lib/macroStress/types';
import { supabase } from '@/lib/supabase';
import {
  type MarketResearchItem,
  type ResearchSignal,
} from '@/lib/portfolioResearch';
import { listPbs } from '@/lib/store';
import TaxPainRubricButton from '@/components/TaxPainRubricButton';
import WmExpertPanel from '@/components/WmExpertPanel';
import StockSectorPanel, { type ExistingHolding, type PlanSummaryItem, type PlanRowOrigin } from '@/components/StockSectorPanel';
import QuickScrollButtons from '@/components/QuickScrollButtons';
import KoreanStockTrendFilter from '@/components/advisory/KoreanStockTrendFilter';
import {
  applyPbSelectedKoreanStocks,
  holdingsToIpsAllocations,
  type PbSelectedKoreanStock,
} from '@/lib/advisory/krTrendPortfolio';
import {
  buildConfirmedPortfolioMetrics,
  type ConfirmedMetricsResult,
} from '@/lib/advisory/confirmedEquityMetrics';

interface PortfolioPanelProps {
  client: Client;
  pbId: string;
  clientId: string;
  onSelectionChange?: (portfolio: Portfolio) => void;
  onHeldAssetsChange?: (heldAssets: HeldAssets | undefined) => void;
  onDetailModeChange?: (isDetailMode: boolean) => void;
  onPlanSummaryChange?: (plan: PlanSummaryItem[]) => void;
  onPlanRowsChange?: (rows: PlanRowOrigin[]) => void;
  initialPlanRows?: PlanRowOrigin[];
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
    emphasis: '인공지능·반도체·글로벌 주식 신호를 더 적극적으로 반영하는 수익추구형 안입니다.',
    signals: ['equity', 'risk', 'dollar', 'gold'],
    allocationLogic: 'ETF 성장자산 비중을 높이고, 변동성 확대 리포트를 감안해 달러·금 헤지를 최소 완충 장치로 남겼습니다.',
    clientMessage: '고객이 더 높은 변동성을 감내할 수 있을 때 성장 테마 참여도를 높이되, 현금화 재원은 별도 분리합니다.',
  },
};

const portfolioOptionCycle: PortfolioOption['id'][] = ['stable', 'balanced', 'growth'];

const formatWonShort = (won: number) => {
  const abs = Math.abs(won);
  const sign = won < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${Math.round((abs / 100_000_000) * 10) / 10}억원`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

const formatPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;

const targetReturnLabel = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value}%` : '별도 확인';

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

function detailSourceBadge(sourceType?: string) {
  if (sourceType === 'fixed_sleeve') return { label: '고정 ETF sleeve', className: 'border-blue-100 bg-blue-50 text-blue-700' };
  if (sourceType === 'legacy_inactive') return { label: '비활성 레거시 후보', className: 'border-slate-200 bg-slate-50 text-slate-500' };
  return { label: '대표상품 후보', className: 'border-amber-100 bg-amber-50 text-amber-700' };
}


function buildSimplifiedBenchmarkChartData(
  points: BenchmarkApiPoint[],
  weights: PortfolioOption['weights'],
  detailedHoldings: ReturnType<typeof buildDetailedHoldings>,
  riskTilt: -1 | 0 | 1 = 0,
  planSummary: Array<{ etfCode: string; amountKrw: number; isFallback: boolean }> = [],
  sectorEtfData: Record<string, number[]> = {},
  /** PB 확정 국내주식 동일가중 누적% — 있으면 주식형 구간을 이 시계열로 대체 */
  confirmedEquityCumulativePct?: number[] | null,
): BenchmarkChartPoint[] {
  const sourcePoints = points.length >= 2 ? points : FALLBACK_BENCHMARK_POINTS;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 100;
  const overseasPattern = /S&P|NVIDIA|Microsoft|Apple|Broadcom|Eli Lilly|Nasdaq|Nifty|미국|해외|나스닥|인도/i;
  void overseasPattern;
  void detailedHoldings;
  void riskTilt;
  const overseasEquityWeight = weights.etf * DEFAULT_EQUITY_REGION_SPLIT.us;
  const domesticEquityWeight = weights.etf * DEFAULT_EQUITY_REGION_SPLIT.kr;

  // sector ETF weights for portfolio line (선B)
  const etfKrw = new Map<string, number>();
  for (const p of planSummary) {
    if (p.isFallback || p.amountKrw <= 0) continue;
    const series = sectorEtfData[p.etfCode];
    if (!series || series.length < 2) continue;
    etfKrw.set(p.etfCode, (etfKrw.get(p.etfCode) ?? 0) + p.amountKrw);
  }
  const totalEtfKrw = etfKrw.size > 0 ? Array.from(etfKrw.values()).reduce((a, b) => a + b, 0) : 0;
  const etfEntries = totalEtfKrw > 0
    ? Array.from(etfKrw.entries()).map(([code, krw]) => ({ krw, series: sectorEtfData[code] as number[] }))
    : [];

  const useConfirmedEquity =
    Boolean(confirmedEquityCumulativePct && confirmedEquityCumulativePct.length >= 2 && weights.etf > 0);

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

    const nonEquityReturn =
      (weights.bond / totalWeight) * usTreasury10y +
      (weights.mmf / totalWeight) * mmf +
      (weights.gold / totalWeight) * gold +
      (weights.dollar / totalWeight) * dollar +
      (weights.raw / totalWeight) * commodity;

    let portfolioReturn: number;
    if (useConfirmedEquity) {
      const eqCum = confirmedEquityCumulativePct![Math.min(index, confirmedEquityCumulativePct!.length - 1)] ?? 0;
      portfolioReturn = (weights.etf / totalWeight) * eqCum + nonEquityReturn;
    } else {
      const hasSectorData = etfEntries.length > 0 && etfEntries.every((e) => index < e.series.length);
      portfolioReturn = hasSectorData
        ? (weights.etf / totalWeight) * etfEntries.reduce((sum, e) => sum + (e.krw / totalEtfKrw) * (e.series[index] ?? 0), 0) + nonEquityReturn
        : blendedBenchmark;
    }

    return {
      ...point,
      sp500: roundPercent(finiteNumber(point.sp500)),
      kospi: roundPercent(finiteNumber(point.kospi, finiteNumber(point.sp500))),
      usTreasury10y: roundPercent(usTreasury10y),
      portfolio: roundPercent(portfolioReturn),
      blendedBenchmark: roundPercent(blendedBenchmark),
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

export default function PortfolioPanel({ client, pbId, clientId, onSelectionChange, onHeldAssetsChange, onDetailModeChange, onPlanSummaryChange, onPlanRowsChange, initialPlanRows }: PortfolioPanelProps) {
  // 승인 manifest가 없는 레거시 크롤러·LLM·키워드 신호는 fail-closed 한다.
  const [researchItems] = useState<MarketResearchItem[]>([]);
  const [researchStatus] = useState<'loading' | 'ready' | 'fallback' | 'blocked'>('blocked');
  const [fallbackUsed] = useState(false);
  const [analyzedById] = useState<Record<string, AnalyzedReport>>({});
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  // 담당 PB 이름 (헤더에 UUID 대신 이름 표시)
  const [pbName, setPbName] = useState<string>('');
  const [selectedBase, setSelectedBase] = useState<PortfolioOption['id']>('balanced');
  const [weights, setWeights] = useState<PortfolioOption['weights']>({
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
  const [activePortfolioDetail, setActivePortfolioDetail] = useState<'assets' | 'evidence' | 'returns' | null>(null);
  const [hasManualEdit, setHasManualEdit] = useState(false);
  const [krSelectedStocks, setKrSelectedStocks] = useState<PbSelectedKoreanStock[]>([]);
  const [krEquityPending, setKrEquityPending] = useState(true);
  const [confirmedMetrics, setConfirmedMetrics] = useState<ConfirmedMetricsResult | null>(null);
  const [confirmedMetricsLoading, setConfirmedMetricsLoading] = useState(false);
  const handleKrTrendSelection = useCallback((selected: PbSelectedKoreanStock[], equityPending: boolean) => {
    setKrSelectedStocks(selected);
    setKrEquityPending(equityPending);
    if (selected.length === 0) setConfirmedMetrics(null);
  }, []);
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
  const portfolioTopRef = useRef<HTMLDivElement | null>(null);
  const portfolioBottomRef = useRef<HTMLDivElement | null>(null);

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

  // 현재 planSummary를 상위로 전달(값만 미러링) — 확정 시 localStorage 저장에 사용. 저장은 여기서 하지 않음.
  useEffect(() => {
    onPlanSummaryChange?.(planSummary);
  }, [planSummary, onPlanSummaryChange]);

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

  const model = useMemo(() => buildPortfolioViewModel(client, researchItems, heldAssets, proxyReturns.length > 0 ? proxyReturns : undefined), [client, researchItems, heldAssets, proxyReturns]);
  const portfolioOptions = model.portfolioOptions;

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
          proxyReturns: proxyReturns.length > 0 ? proxyReturns : undefined,
        });
        const optionMetrics = preferenceAdjustedMetrics(
          option.weights,
          model.preferenceProfile,
          riskTiltForOption(option.id),
          benchmarkTargetReturn,
          optionFeasibility,
          proxyReturns.length > 0 ? proxyReturns : undefined,
          { client, cashflow: model.cashflowSummary },
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
          preTaxReturn: optionMetrics.expectedReturn,
          volatility: optionMetrics.volatility,
          mdd: optionMetrics.mdd,
          taxReturn: optionMetrics.taxReturn,
          taxDrag: optionMetrics.taxDrag,
          taxDragReasons: optionMetrics.taxDragReasons,
        };
      }),
    [benchmarkTargetReturn, client, model.cashflowSummary, model.preferenceFeasibility.liquidityReasons, model.preferenceProfile, portfolioOptions, proxyReturns],
  );
  const selectedFeasibility = useMemo(
    () =>
      evaluatePreferenceFeasibility(adjustedWeights, model.preferenceProfile, {
        riskTilt: selectedRiskTilt,
        benchmarkTargetReturn,
        liquidityReasons: model.preferenceFeasibility.liquidityReasons,
        proxyReturns: proxyReturns.length > 0 ? proxyReturns : undefined,
      }),
    [adjustedWeights, benchmarkTargetReturn, model.preferenceFeasibility.liquidityReasons, model.preferenceProfile, selectedRiskTilt, proxyReturns],
  );
  const metrics = useMemo(
    () =>
      preferenceAdjustedMetrics(
        adjustedWeights,
        model.preferenceProfile,
        selectedRiskTilt,
        benchmarkTargetReturn,
        selectedFeasibility,
        proxyReturns.length > 0 ? proxyReturns : undefined,
        { client, cashflow: model.cashflowSummary },
      ),
    [adjustedWeights, benchmarkTargetReturn, client, model.cashflowSummary, model.preferenceProfile, selectedFeasibility, selectedRiskTilt, proxyReturns],
  );
  const volatilityRanges = useMemo(
    () => getVolatilityRanges(confirmedMetrics?.status === 'ok' ? confirmedMetrics.volatilityPct : metrics.volatility),
    [metrics.volatility, confirmedMetrics],
  );
  const nonEquityWeightPct = useMemo(
    () =>
      adjustedWeights.bond +
      adjustedWeights.mmf +
      adjustedWeights.gold +
      adjustedWeights.dollar +
      adjustedWeights.raw +
      adjustedWeights.els,
    [adjustedWeights],
  );
  const benchmarkChartData = useMemo(
    () => buildSimplifiedBenchmarkChartData(
      benchmarkPoints,
      adjustedWeights,
      buildDetailedHoldings(adjustedWeights, model.preferenceProfile, selectedBase),
      selectedRiskTilt,
      planSummary,
      sectorEtfData,
      confirmedMetrics?.status === 'ok' ? confirmedMetrics.equityCumulativePct : null,
    ),
    [adjustedWeights, benchmarkPoints, model.preferenceProfile, selectedBase, selectedRiskTilt, planSummary, sectorEtfData, confirmedMetrics],
  );
  const selectedDetailedHoldings = useMemo(() => {
    const base = buildDetailedHoldings(adjustedWeights, model.preferenceProfile, selectedBase);
    return applyPbSelectedKoreanStocks(base, krSelectedStocks, adjustedWeights.etf).holdings;
  }, [adjustedWeights, model.preferenceProfile, selectedBase, krSelectedStocks]);

  // PB 후보 확정 시 선택 종목 OHLC로 성과지표·백테스트 재계산
  useEffect(() => {
    if (krSelectedStocks.length === 0 || adjustedWeights.etf <= 0) {
      setConfirmedMetrics(null);
      return;
    }
    let cancelled = false;
    setConfirmedMetricsLoading(true);
    const tickers = krSelectedStocks.map((s) => s.ticker).join(',');
    const sourcePoints = benchmarkPoints.length >= 2 ? benchmarkPoints : FALLBACK_BENCHMARK_POINTS;
    const nonEquityCum = sourcePoints.map((point, index) => {
      const usTreasury10y = finiteNumber(point.usTreasury10y, fixedIncomeProxy(index, sourcePoints.length, 3.2));
      const mmf = finiteNumber(point.mmf, fixedIncomeProxy(index, sourcePoints.length, 3.0));
      const gold = finiteNumber(point.gold, fixedIncomeProxy(index, sourcePoints.length, 4.0));
      const dollar = finiteNumber(point.dollar, fixedIncomeProxy(index, sourcePoints.length, 2.3));
      const commodity = finiteNumber(point.commodity, fixedIncomeProxy(index, sourcePoints.length, 3.6));
      const w = nonEquityWeightPct || 1;
      return (
        (adjustedWeights.bond / w) * usTreasury10y +
        (adjustedWeights.mmf / w) * mmf +
        (adjustedWeights.gold / w) * gold +
        (adjustedWeights.dollar / w) * dollar +
        (adjustedWeights.raw / w) * commodity
      );
    });

    fetch(`/api/advisory/kr-trend/bars?tickers=${encodeURIComponent(tickers)}&days=260`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: {
        ok?: boolean;
        series?: Array<{ ticker: string; closes: Array<{ date: string; close: number }> }>;
        asOf?: string;
        source?: string;
        status?: string;
      }) => {
        if (cancelled) return;
        if (!data.ok || !data.series?.length) {
          setConfirmedMetrics(null);
          return;
        }
        const seriesByTicker: Record<string, Array<{ date: string; close: number }>> = {};
        for (const s of data.series) {
          if (s.closes?.length >= 2) seriesByTicker[s.ticker] = s.closes;
        }
        const result = buildConfirmedPortfolioMetrics({
          seriesByTicker,
          equityWeightPct: adjustedWeights.etf,
          nonEquityWeightPct,
          nonEquityCumulativePct: nonEquityCum,
          asOf: data.asOf,
          source: data.source,
        });
        setConfirmedMetrics(result);
      })
      .catch(() => {
        if (!cancelled) setConfirmedMetrics(null);
      })
      .finally(() => {
        if (!cancelled) setConfirmedMetricsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [krSelectedStocks, adjustedWeights, benchmarkPoints, nonEquityWeightPct]);

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
  // 고객용 예상수익률·세후 가상수익률 = 자산배분 엔진 통제값 (확정 종목 백테스트로 대체 금지)
  const displayedExpectedReturn = proxyReturnSummary?.annualizedReturnPct ?? metrics.expectedReturn;
  const displayVolatility =
    confirmedMetrics?.status === 'ok' ? confirmedMetrics.volatilityPct : metrics.volatility;
  const displayMdd = confirmedMetrics?.status === 'ok' ? confirmedMetrics.mddPct : metrics.mdd;
  /** PB 확정 종목 OHLC 백테스트 연율화 — KPI가 아닌 참고 지표 */
  const backtestReferenceReturnPct =
    confirmedMetrics?.status === 'ok' ? confirmedMetrics.backtestAnnualizedReturnPct : null;
  const displayTax = useMemo(() => {
    const tax = calculateTaxDragProxy({
      preTaxReturn: displayedExpectedReturn,
      weights: adjustedWeights,
      client,
      cashflow: model.cashflowSummary,
      preference: model.preferenceProfile,
    });
    return tax;
  }, [displayedExpectedReturn, adjustedWeights, client, model.cashflowSummary, model.preferenceProfile]);
  const returnEstimateLabel =
    !proxyReturnSummary || proxyReturnSummary.fallbackUsed
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
  const selectedMarketRationale = model.rationale.market;
  // 시장 리포트 근거를 리포트별로 분리 (요약/근거를 불릿으로 표시)
  const marketReportReasons = useMemo(
    () =>
      selectedResearchItems.slice(0, 4).map((item) => {
        const a = analyzedById[item.id];
        const reason =
          (a?.summary && a.summary.trim()) ||
          a?.signals?.[0]?.evidence ||
          item.excerpt ||
          'PB 승인 근거 연결이 필요합니다.';
        return { id: item.id, title: item.title, source: item.source, reason };
      }),
    [selectedResearchItems, analyzedById],
  );
  const selectedExecutiveConclusion = `${model.executiveConclusion} ${selectedProfile.clientMessage}`;

  useEffect(() => {
    if (!onSelectionChange) return;
    const allocations = holdingsToIpsAllocations(selectedDetailedHoldings);

    onSelectionChange({
      id: selectedBase,
      label: selectedOption.name,
      allocations,
      expectedReturn: displayedExpectedReturn,
      expectedRisk: displayVolatility,
      taxNote: model.rationale.tax,
      rationale: [
        selectedMarketRationale,
        model.rationale.client,
        model.rationale.cashflow,
        model.rationale.preference,
        model.rationale.unique,
        krSelectedStocks.length
          ? `주식형: ${krSelectedStocks.map((s) => s.name).join(', ')} (PB 후보 확정).`
          : krEquityPending
            ? '주식형: PB 확정 대기 (후보 확정 전 자동 추천 금지).'
            : '',
        confirmedMetrics?.status === 'ok'
          ? `변동성·MDD·백테스트는 확정 종목 기준(참고 백테스트 연율 ${confirmedMetrics.backtestAnnualizedReturnPct}%, Sharpe ${confirmedMetrics.sharpe}, VaR95 ${confirmedMetrics.varPct}%, CVaR95 ${confirmedMetrics.cvarPct}%). 고객용 예상수익률은 자산배분 엔진 통제값을 유지.`
          : '',
      ].filter(Boolean).join(' '),
      editedByPb: true,
    });
  }, [
    adjustedWeights,
    selectedDetailedHoldings,
    metrics,
    displayedExpectedReturn,
    displayVolatility,
    model.rationale,
    onSelectionChange,
    selectedBase,
    selectedMarketRationale,
    selectedOption.name,
    krSelectedStocks,
    krEquityPending,
    confirmedMetrics,
  ]);

  const handleBaseChange = (type: PortfolioOption['id']) => {
    const target = portfolioOptions.find((option) => option.id === type);
    if (!target) return;
    setHasManualEdit(true);
    setSelectedBase(type);
    setWeights({ ...target.weights });
  };

  const cyclePortfolioOption = (direction: 1 | -1) => {
    const currentIndex = portfolioOptionCycle.indexOf(selectedBase);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + portfolioOptionCycle.length) % portfolioOptionCycle.length;
    handleBaseChange(portfolioOptionCycle[nextIndex]);
  };

  const handleWeightChange = (asset: WeightKey, value: number) => {
    const sanitizedValue = Math.max(0, Math.min(100, Number.isNaN(value) ? 0 : value));
    setHasManualEdit(true);
    setWeights((prev) => ({
      ...prev,
      [asset]: sanitizedValue,
    }));
  };

  const openPortfolioDetail = (detail: 'assets' | 'evidence' | 'returns') => {
    setActivePortfolioDetail(detail);
  };

  useEffect(() => {
    onDetailModeChange?.(Boolean(activePortfolioDetail));
    return () => onDetailModeChange?.(false);
  }, [activePortfolioDetail, onDetailModeChange]);

  if (activePortfolioDetail) {
    return (
      <div ref={portfolioTopRef} className="flex flex-col gap-5 rounded-2xl bg-surface-2 p-4 text-fg md:p-6">
        <QuickScrollButtons topRef={portfolioTopRef} bottomRef={portfolioBottomRef} />
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
                Portfolio Detail
              </p>
              <h2 className="mt-1 text-xl font-black text-fg">
                {activePortfolioDetail === 'assets'
                  ? '선택안 세부 구현 후보'
                  : activePortfolioDetail === 'returns'
                    ? '수익률 구성'
                    : '포트폴리오 산출 근거'}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActivePortfolioDetail('assets')}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  activePortfolioDetail === 'assets'
                    ? 'border-blue-300 bg-blue-600 text-white'
                    : 'border-border bg-surface-2 text-fg-muted hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                구현 후보
              </button>
              <button
                type="button"
                onClick={() => setActivePortfolioDetail('evidence')}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  activePortfolioDetail === 'evidence'
                    ? 'border-violet-300 bg-violet-600 text-white'
                    : 'border-border bg-surface-2 text-fg-muted hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                산출 근거
              </button>
              <button
                type="button"
                onClick={() => setActivePortfolioDetail('returns')}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  activePortfolioDetail === 'returns'
                    ? 'border-indigo-300 bg-indigo-600 text-white'
                    : 'border-border bg-surface-2 text-fg-muted hover:border-indigo-300 hover:text-indigo-700'
                }`}
              >
                수익률 구성
              </button>
              <button
                type="button"
                onClick={() => setActivePortfolioDetail(null)}
                className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-fg-muted transition hover:border-slate-400 hover:text-fg"
              >
                전체 화면으로 돌아가기
              </button>
            </div>
          </div>
        </section>

        {activePortfolioDetail === 'assets' ? (
          <section className="rounded-2xl border border-blue-200 bg-surface p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-600"></span>
                <h3 className="text-base font-bold text-fg">선택안 세부 구현 후보</h3>
              </div>
              <span className="text-[11px] font-medium text-fg-muted">
                자산군 내부 비중까지 합산 100%
              </span>
            </div>

            <p className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-900">
              본 화면의 세부 자산은 정량 개별종목 랭킹 결과가 아니라, 고객 맞춤 자산배분을 대표 ETF·채권·현금성 상품으로 구현하기 위한 후보입니다.
              ETF 내부 지역배분은 S&amp;P500 60%, KOSPI 40% 기준이며, 위험성향은 전체 주식·채권·현금성 비중 조절로 반영됩니다.
            </p>
            <p className="hidden">
              이 화면은 제안 포트폴리오의 자산군별 추천 종목과 역할만 따로 보여줍니다. 실제 실행 전에는 PB가 고객 적합성,
              세금, 유동성 조건을 다시 확인해야 합니다.
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
                          <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${detailSourceBadge(holding.sourceType).className}`}>
                            {detailSourceBadge(holding.sourceType).label}
                          </span>
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
        ) : activePortfolioDetail === 'returns' ? (
          <section className="rounded-2xl border border-indigo-200 bg-surface p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
                <h3 className="text-base font-bold text-fg">시장 proxy 기반 참고 수익률 구성</h3>
              </div>
              <span className="text-[11px] font-medium text-fg-muted">
                자산군별 적용 수익률과 기여도
              </span>
            </div>
            {proxyReturnSummary ? (
              <div className="space-y-4 text-xs">
                <p className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 leading-relaxed text-indigo-900">
                  주식·대체자산은 최근 5년 가격 연율화, 채권·현금성 자산은 이자수익 특성을 반영한 proxy 기준입니다.
                </p>
                <p className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 leading-relaxed text-blue-900">
                  ETF 내부 지역배분은 S&amp;P500 60%, KOSPI 40%의 글로벌/국내 분산 기준을 적용하고, 위험성향은 전체 주식·채권·현금성 비중 조절로 반영됩니다.
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {proxyReturnSummary.estimates.map((estimate) => (
                    <div key={estimate.key} className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                      <p className="font-bold text-fg">{estimate.label}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                        {estimate.proxy} · {estimate.displayRange ?? `${estimate.annualizedReturnPct.toFixed(1)}%`}
                        {estimate.returnBasis === 'income_proxy'
                          ? ` · ${estimate.displayNote ?? estimate.source}`
                          : estimate.fallback ? ' · fallback' : ` · ${estimate.usedYears.toFixed(1)}년`}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-xl border border-border bg-surface-2 p-3">
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-fg-muted">
                      <tr>
                        <th className="py-2">assetGroup</th>
                        <th className="py-2">weight</th>
                        <th className="py-2">appliedReturn</th>
                        <th className="py-2">contribution</th>
                        <th className="py-2">source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proxyReturnSummary.contributions.map((item) => (
                        <tr key={item.assetGroup} className="border-t border-border">
                          <td className="py-2 font-semibold text-fg">{item.assetGroup}</td>
                          <td className="py-2">{item.weight.toFixed(1)}%</td>
                          <td className="py-2">{item.appliedReturn.toFixed(2)}%</td>
                          <td className="py-2 font-bold text-blue-700">{item.contribution.toFixed(3)}%p</td>
                          <td className="py-2 text-fg-muted">{item.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-border bg-surface-2 p-4 text-xs leading-relaxed text-fg-muted">
                시장 proxy 데이터를 불러오는 중입니다.
              </p>
            )}
          </section>
        ) : (
          <>
            <section className="order-last rounded-2xl border border-rose-100 bg-surface p-5 shadow-sm">
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
                        <p className="text-sm font-black text-rose-800">
                          고객 요구 수익률과 포트폴리오 수익률 충돌
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-rose-900">
                          공격적 목표수익률·위험도 가정은 화면 KPI에 반영하지 않았습니다.
                          PB가 세금 납부 일정, MMF/RP 유동성 floor, 매각 가능 자산을 재확인해 세부 커스텀 조정안을 별도 상담해야 합니다.
                        </p>
                      </div>
                      <div className="grid min-w-[260px] grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-surface px-3 py-2">
                          <span className="block text-fg-muted">고객 요구 수익률</span>
                          <span className="mt-0.5 block text-lg font-black text-rose-700">
                            {targetReturnLabel(selectedFeasibility.requestedTargetReturn ?? model.preferenceProfile.targetReturn)}
                          </span>
                        </div>
                        <div className="rounded-lg bg-surface px-3 py-2">
                          <span className="block text-fg-muted">실제 비중 기반</span>
                          <span className="mt-0.5 block text-lg font-black text-fg">
                            {selectedFeasibility.weightBasedReturn}%
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 rounded-lg border border-rose-100 bg-surface px-3 py-2 text-xs font-semibold leading-relaxed text-rose-800">
                      {selectedFeasibility.conflicts.join(' ')}
                    </p>
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
                        : '요구조건은 기록되었지만 현재 포트폴리오 지표에는 반영하지 않았습니다. PB가 현금 흐름, 세금 일정, 매각 가능 자산, 위험 예산을 확인해 별도 커스텀안을 작성해야 합니다.'}
                    </p>
                    {model.preferenceProfile.rawText && (
                      <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[11px] leading-relaxed text-fg-muted">
                        입력 문장: {model.preferenceProfile.rawText}
                      </p>
                    )}
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                    <p className="text-xs font-bold text-amber-800">
                      {selectedFeasibility.feasible ? 'PB 확인 필요' : 'PB 별도 커스텀 조정 필요'}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-amber-900">
                      {!selectedFeasibility.feasible ? (
                        selectedFeasibility.conflicts.map((warning) => <li key={warning}>- {warning}</li>)
                      ) : model.preferenceProfile.warnings.length > 0 ? (
                        model.preferenceProfile.warnings.map((warning) => <li key={warning}>- {warning}</li>)
                      ) : (
                        <li>- 요구조건과 현금화 일정의 충돌 여부를 상담에서 최종 확인하세요.</li>
                      )}
                    </ul>
                  </div>
                </div>
                </>
              ) : (
                <p className="rounded-xl border border-border bg-surface-2 p-4 text-xs leading-relaxed text-fg-muted">
                  고객 고유상황이 입력되면 이 영역에서 요구조건, 충돌 가능성, PB 확인 항목을 분리해 보여줍니다.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-violet-200 bg-surface p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-600"></span>
                <h3 className="text-base font-bold text-fg">포트폴리오 산출 근거</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-surface-2 p-3 lg:col-span-2">
                  <p className="text-xs font-bold text-fg">리서치 승인 상태</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    {model.rationale.market}
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
                <ReasonBlock title="세금 이벤트 반영" body={model.rationale.tax} />
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

            <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
                  <h3 className="text-base font-bold text-fg">선택안별 승인 근거 상태</h3>
                </div>
                <span className="text-[11px] font-medium text-fg-muted">
                  {researchStatus === 'blocked'
                    ? 'PB 승인 Evidence 미연결'
                    : researchStatus === 'loading'
                    ? '업데이트 확인 중'
                    : fallbackUsed
                      ? '일부 출처 fallback 포함'
                      : '실시간 추출 완료'}
                </span>
              </div>

              <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900">
                미승인 LLM·키워드 신호는 {currentPortfolioName} 비중과 상품 판단에서 제외했습니다.
              </p>

              {researchStatus !== 'blocked' && <div className="grid grid-cols-2 gap-2">
                {selectedSignalScores.slice(0, 4).map((signal) => (
                  <div key={signal.signal} className="rounded-xl border border-border bg-surface-2 p-3">
                    <span className="block text-[11px] font-semibold text-fg-muted">{signal.label}</span>
                    <span className="mt-1 block text-lg font-black text-fg">{signal.score}</span>
                  </div>
                ))}
              </div>}

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
          </>
        )}
        <div ref={portfolioBottomRef} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div ref={portfolioTopRef} className="space-y-4 rounded-xl bg-[#F5F7FC] p-3 text-fg md:p-4">
      <QuickScrollButtons topRef={portfolioTopRef} bottomRef={portfolioBottomRef} />
      <div className="flex flex-col justify-between gap-4 rounded-xl bg-gradient-to-r from-[#071B4A] to-[#102B6B] p-4 text-white shadow-sm md:flex-row md:items-center">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-300">Portfolio Decision Summary</span>
          <h1 className="mt-1 text-xl font-bold tracking-tight">현재 선택: {currentPortfolioName}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
            7요인 분석 → 현금흐름 분석 → 고객 제약 확인 → 포트폴리오 산출 순서이며, PB 승인 리서치는 연결된 경우에만 별도 근거로 표시합니다.
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

      <section className="rounded-xl border border-[#1428A0]/20 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="decision-kicker">Compare & decide</p>
            <h2 className="text-base font-bold text-fg">추천안 비교 선택</h2>
          </div>
          <span className="badge-navy">선택됨 · {currentPortfolioName}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {displayPortfolioOptions.map((option) => {
            const selected = option.id === selectedBase;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedBase(option.id)}
                aria-pressed={selected}
                className={`rounded-xl border p-3 text-left transition ${selected ? "border-[#1428A0] bg-[#F2F5FF] ring-2 ring-[#1428A0]/10" : "border-border bg-white hover:border-[#1428A0]/40"}`}
              >
                <span className="text-[10px] font-bold uppercase text-fg-muted">{option.id}</span>
                <span className="mt-1 block text-sm font-bold text-fg">{option.name}</span>
                <span className="mt-1 block text-[11px] text-fg-muted">{selected ? `예상수익 ${displayedExpectedReturn}% · 변동성 ${metrics.volatility}% · MDD ${metrics.mdd}%` : "선택하여 계산 결과 비교"}</span>
              </button>
            );
          })}
        </div>
      </section>

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
        <div className="xl:col-span-12 overflow-hidden rounded-xl border border-border bg-slate-900 shadow-sm">
        <div className="h-full bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950 p-5 text-white space-y-4">
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-2">
                <div>
                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                    Recommended Conclusion
                  </span>
                  <h2 className="text-xl font-black text-white mt-1">{currentPortfolioName}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openPortfolioDetail('assets')}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                        activePortfolioDetail === 'assets'
                          ? 'border-blue-300 bg-blue-500 text-white'
                          : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-blue-300 hover:text-white'
                      }`}
                    >
                      구현 후보
                    </button>
                    <button
                      type="button"
                      onClick={() => openPortfolioDetail('evidence')}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                        activePortfolioDetail === 'evidence'
                          ? 'border-violet-300 bg-violet-500 text-white'
                          : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-violet-300 hover:text-white'
                      }`}
                    >
                      산출 근거
                    </button>
                    <button
                      type="button"
                      onClick={() => openPortfolioDetail('returns')}
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-200 transition hover:border-indigo-300 hover:text-white"
                    >
                      수익률 구성
                    </button>
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <div className="flex overflow-hidden rounded-lg border border-slate-600 bg-slate-900/70">
                    <button
                      type="button"
                      onClick={() => cyclePortfolioOption(-1)}
                      className="px-3 py-2 text-sm font-black text-slate-200 transition hover:bg-slate-700 hover:text-white"
                      aria-label="이전 추천안"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => cyclePortfolioOption(1)}
                      className="border-l border-slate-600 px-3 py-2 text-sm font-black text-slate-200 transition hover:bg-slate-700 hover:text-white"
                      aria-label="다음 추천안"
                    >
                      ›
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 sm:justify-end">
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
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                {selectedExecutiveConclusion}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">
                본 포트폴리오는 고객 위험성향별 모델 포트폴리오를 기준으로 출발하며, 이후 현금흐름·세금·유동성·투자기간 등 고객 요인에 따라 조정됩니다.
              </p>
            </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_420px]">
              <div className="flex h-auto flex-col rounded-xl border border-slate-700/60 bg-slate-950/35 p-3.5 xl:h-[320px]">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-400"></span>
                    <h3 className="text-sm font-bold text-slate-100">포트폴리오 자산 배분 비중</h3>
                  </div>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-slate-300">
                    총합 {totalWeight}%
                  </span>
                </div>

                <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[170px_1fr] lg:items-center">
                  <div className="relative mx-auto h-40 w-40 flex-shrink-0">
                    <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 42 42">
                      <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="rgba(148,163,184,0.22)" strokeWidth="4" />
                      {(() => {
                        const total = Object.values(adjustedWeights).reduce((a, b) => a + b, 0) || 1;
                        let currentAccum = 0;
                        const assetSvgColors: Record<WeightKey, string> = {
                          etf: '#60a5fa',
                          bond: '#38bdf8',
                          els: '#f59e0b',
                          mmf: '#818cf8',
                          gold: '#eab308',
                          dollar: '#94a3b8',
                          raw: '#a8a29e',
                        };
                        return (Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
                          .filter(([, w]) => w > 0)
                          .sort(([, a], [, b]) => b - a)
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
                      <span className="text-[10px] font-bold uppercase text-slate-500">SUM</span>
                      <span className="text-3xl font-black text-white">{totalWeight}%</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    {(Object.entries(adjustedWeights) as Array<[WeightKey, number]>)
                      .filter(([, weight]) => weight > 0)
                      .sort(([, a], [, b]) => b - a)
                      .map(([asset, weight]) => (
                        <div key={asset} className="flex min-h-[36px] items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-slate-900/55 px-3 py-1.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={`block h-2.5 w-2.5 flex-shrink-0 rounded-sm ${barColors[asset]}`}></span>
                            <span className="truncate text-sm font-medium text-slate-300">{weightLabels[asset]}</span>
                          </div>
                          <span className="text-base font-black text-white">{weight}%</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 xl:h-[320px] xl:grid-cols-1 xl:grid-rows-[70px_52px_118px_56px]">
                <div
                  className="flex min-h-0 flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-1.5 text-center"
                  title={returnEstimateLabel}
                >
                  <span className="block text-[10px] font-medium leading-none text-fg-muted">
                    예상 수익률{!selectedFeasibility.feasible ? ' (비중 기반)' : ''}
                  </span>
                  <span className={`mt-0.5 block text-xl font-black leading-none ${selectedFeasibility.feasible ? 'text-emerald-400' : 'text-amber-300'}`}>
                    {displayedExpectedReturn}%
                  </span>
                  <span className="mt-1 line-clamp-2 text-[9px] leading-tight text-slate-500">{returnEstimateLabel}</span>
                  {!selectedFeasibility.feasible && (
                    <span className="mt-0.5 block text-[9px] font-bold leading-none text-rose-200">
                      요구 {selectedFeasibility.requestedTargetReturn ?? '-'}% 미반영
                    </span>
                  )}
                </div>
                <div
                  className="flex min-h-0 flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-1.5 text-center"
                  title="세후수익률은 세전 기대수익률에서 고객 세금 분석 결과에 따른 tax drag를 차감한 참고값입니다."
                >
                  <span className="block text-[10px] font-medium leading-none text-fg-muted">세후 가상수익률</span>
                  <span className="mt-0.5 block text-xl font-black leading-none text-blue-400">{displayTax.afterTaxReturn}%</span>
                  <span className="mt-1 block text-[9px] leading-tight text-slate-400">
                    세전 {displayedExpectedReturn}% - 세금 조정 {displayTax.taxDrag ?? 0}%p
                  </span>
                  <span className="block text-[9px] leading-tight text-slate-500">
                    tax drag proxy: {displayTax.reasons?.[0] ?? "고객 세금 분석 결과 반영"}
                  </span>
                </div>
                <div
                  className="flex min-h-0 flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-1.5 text-center"
                  title={`일반 시장 변동성 범위 ${volatilityRanges.normalLow}~${volatilityRanges.normalHigh}%${stressLossRange ? ` · 스트레스 MDD ${stressLossRange.low.toFixed(1)}~${stressLossRange.high.toFixed(1)}%` : ''}${confirmedMetrics?.status === 'ok' ? ` · Sharpe ${confirmedMetrics.sharpe} · VaR95 ${confirmedMetrics.varPct}% · CVaR95 ${confirmedMetrics.cvarPct}%` : ''}`}
                >
                  <span className="block text-[10px] font-medium leading-none text-fg-muted">포트폴리오 변동성</span>
                  <span className="mt-0.5 block text-xl font-black leading-none text-slate-200">{displayVolatility}%</span>
                  <span className="mt-1 block text-[9px] leading-tight text-slate-400">일반 시장 변동성 범위 {volatilityRanges.normalLow}~{volatilityRanges.normalHigh}%</span>
                  <span className="block text-[9px] leading-tight text-amber-200/80">{stressLossRange ? `스트레스 MDD 범위 ${stressLossRange.low.toFixed(1)}~${stressLossRange.high.toFixed(1)}%` : '스트레스 MDD 범위 불러오는 중'}</span>
                  {confirmedMetrics?.status === 'ok' && (
                    <span className="mt-1 block text-[9px] leading-tight text-emerald-300/90">
                      Sharpe {confirmedMetrics.sharpe} · VaR95 {confirmedMetrics.varPct}% · CVaR95 {confirmedMetrics.cvarPct}%
                    </span>
                  )}
                  <span className="mt-1 block text-[9px] leading-tight text-slate-500">일반 범위는 연율 변동성, 스트레스 범위는 과거 위기 시나리오 최대낙폭(MDD) 기준입니다.</span>
                </div>
                <div
                  className="flex min-h-0 flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-1.5 text-center"
                  title="일반 시장 가정 기준"
                >
                  <span className="block text-[10px] font-medium leading-none text-fg-muted">시뮬레이션 MDD</span>
                  <span className="mt-0.5 block text-xl font-black leading-none text-rose-400">{displayMdd}%</span>
                  <span className="mt-1 block text-[9px] leading-tight text-slate-500">
                    {confirmedMetrics?.status === 'ok' ? 'PB 확정 종목 백테스트 누적 기준' : '일반 시장 가정의 확률 시뮬레이션 기준'}
                  </span>
                </div>
              </div>
              {(backtestReferenceReturnPct != null || confirmedMetricsLoading) && (
                <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                  <p className="font-semibold text-amber-200">백테스트 수익률 (참고 · 고객용 예상수익률 KPI 아님)</p>
                  {confirmedMetricsLoading && backtestReferenceReturnPct == null ? (
                    <p className="mt-0.5 text-amber-200/80">확정 종목 OHLC로 백테스트 재계산 중…</p>
                  ) : (
                    <p className="mt-0.5">
                      확정 종목 동일가중 백테스트 연율화{' '}
                      <span className="font-black text-amber-50">{backtestReferenceReturnPct}%</span>
                      {confirmedMetrics?.status === 'ok' && (
                        <span className="text-amber-200/70">
                          {' '}
                          · as-of {confirmedMetrics.asOf.slice(0, 19)} · {confirmedMetrics.source}
                        </span>
                      )}
                      . 단기 급등 구간이 포함되면 수치가 비정상적으로 커질 수 있으며, 위 예상·세후 수익률 카드에는 반영하지 않습니다.
                    </p>
                  )}
                </div>
              )}
              </div>
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
      </div>

      <KoreanStockTrendFilter
        clientId={clientId}
        equityWeightPct={adjustedWeights.etf}
        onSelectionChange={handleKrTrendSelection}
      />

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
          <h3 className="text-base font-bold text-fg">분석 기반 추천안 3개 비교</h3>
          {krEquityPending ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
              PB 확정 대기
            </span>
          ) : (
            <span className="rounded-full bg-[#1428A0]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1428A0]">
              주식형 = PB 확정 국내 주식 ({krSelectedStocks.length}종)
            </span>
          )}
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
                  <p className="mb-1.5 text-[10px] font-bold text-fg-muted">구현 후보 미리보기</p>
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

      {activePortfolioDetail === 'evidence' && (
      <section id="portfolio-evidence" className="scroll-mt-24 rounded-2xl border border-violet-200 bg-surface p-5 shadow-sm ring-4 ring-violet-50">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600"></span>
          <h3 className="text-base font-bold text-fg">포트폴리오 산출 근거</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface-2 p-3 lg:col-span-2">
            <p className="text-xs font-bold text-fg">리서치 승인 상태</p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              {model.rationale.market}
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
      )}

      {activePortfolioDetail === 'evidence' && (
      <div className="mt-4 grid grid-cols-1 gap-5">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-600"></span>
              <h3 className="text-base font-bold text-fg">선택안별 승인 근거 상태</h3>
            </div>
            <span className="text-[11px] font-medium text-fg-muted">
              {researchStatus === 'blocked'
                ? 'PB 승인 Evidence 미연결'
                : researchStatus === 'loading'
                ? '업데이트 확인 중'
                : fallbackUsed
                  ? '일부 출처 fallback 포함'
                  : '실시간 추출 완료'}
            </span>
          </div>

          <p className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900">
            미승인 LLM·키워드 신호는 {currentPortfolioName} 비중과 상품 판단에서 제외했습니다.
          </p>

          {researchStatus !== 'blocked' && <div className="grid grid-cols-2 gap-2">
            {selectedSignalScores.slice(0, 4).map((signal) => (
              <div key={signal.signal} className="rounded-xl border border-border bg-surface-2 p-3">
                <span className="block text-[11px] font-semibold text-fg-muted">{signal.label}</span>
                <span className="mt-1 block text-lg font-black text-fg">{signal.score}</span>
              </div>
            ))}
          </div>}

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
      )}

      {model.taxPainPoints.length > 0 && (
        <section className="rounded-2xl border border-emerald-200 bg-surface p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 border-b border-emerald-100 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-600"></span>
              <h3 className="text-base font-bold text-fg">고액자산가 주요 세금 고충 참고</h3>
            </div>
            <TaxPainRubricButton label="세금 고충 기준표 확인" />
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

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <button
          type="button"
          onClick={() => setIsSuitabilityOpen((value) => !value)}
          className="flex w-full items-center justify-between bg-surface-2 p-4 text-left transition-colors hover:bg-surface-2"
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
            <h3 className="text-sm font-bold text-fg">상품군 투자 적합성 필터</h3>
            <span className="text-xs text-fg-muted">고객·세금·현금흐름 기준</span>
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

      <div className="grid grid-cols-1 gap-5">
        <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
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
                  max={(model.assetLayer?.investableKrw ?? client.assetSize ?? 0) > 0
                    ? Math.max(1000, Math.round(((model.assetLayer?.investableKrw ?? client.assetSize) * 0.60) / 10000))
                    : 30000}
                  step="500"
                  value={liquidityAmount}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setHasManualEdit(true);
                    setLiquidityAmount(value);
                    const investableManwon = (model.assetLayer?.investableKrw ?? client.assetSize ?? 0) / 10000;
                    const mmfPct = investableManwon > 0 ? (value / investableManwon) * 100 : 0;
                    handleWeightChange('mmf', Math.min(Math.round(mmfPct), 60));
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-2 accent-indigo-600"
                />
              </div>
            </div>

            <StockSectorPanel
              etfAllocKrw={((model.assetLayer?.investableKrw ?? 0) * weights.etf) / 100}
              existingHoldings={existingHoldings}
              onPlanChange={setPlanSummary}
              onPlanRowsChange={onPlanRowsChange}
              initialRows={initialPlanRows}
            />
          </div>
        </section>

      </div>
      <div ref={portfolioBottomRef} aria-hidden="true" />
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
