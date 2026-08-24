'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// ── 공개 타입 (PortfolioPanel에서 import) ──────────────────────────────────
export interface ExistingHolding {
  name:    string;
  ticker:  string | null;
  evalKrw: number; // qty × price × fx — PortfolioPanel에서 계산 완료
}

export interface PlanSummaryItem {
  etfCode:    string;  // Yahoo Finance 형식 e.g. "091160.KS"
  amountKrw:  number;
  isFallback: boolean;
}

// PB가 입력한 원본 종목 (섹터 ETF 변환 전) — 복원 시 원본 종목 단위 재구성용
export interface PlanRowOrigin {
  stockCode:  string;  // PB 입력 원본 6자리 코드 e.g. "016360"
  stockName:  string;
  amountKrw:  number;
}

// ── API 응답 타입 (SectorAnalysisResult 미러) ──────────────────────────────
interface MultiSectorEntry {
  sector:      string;
  sectorLabel: string;
  etfTicker:   string;
  weightPct:   number;
}
interface ReliabilityInfo { r2: number; isLow: boolean; message: string; }
interface StockAnalysis {
  stockCode:        string;
  stockName:        string;
  sector:           string;
  sectorLabel:      string;
  etfCode:          string;
  etfName:          string;
  beta:             number;
  volatilityAnnual: number;
  alphaAnnual:      number;
  r2:               number;
  periodMonths:     number;
  rangeStart:       string;
  rangeEnd:         string;
  isFallback:       boolean;
  isUncovered:      boolean;
  multiSector:      MultiSectorEntry[] | null;
  reliability:      ReliabilityInfo;
  cachedAt:         string;
}

// ── 내부 타입 ─────────────────────────────────────────────────────────────
interface PlanRow    { analysis: StockAnalysis; amountKrw: number; }
interface HoldingRow { holding: ExistingHolding; analysis: StockAnalysis | null; loadError: string | null; }

interface CombinedHolding {
  name:        string;
  sector:      string;
  sectorLabel: string;
  valueKrw:    number;
  isFallback:  boolean;
  source:      'existing' | 'plan';
}

interface SectorBucket {
  sector:         string;
  sectorLabel:    string;
  valueKrw:       number;
  weightPct:      number;
  count:          number;
  hasAnyFallback: boolean;
}

// ── 상수 ──────────────────────────────────────────────────────────────────
const SECTOR_COLOR: Record<string, string> = {
  semiconductor: 'bg-blue-100 text-blue-800 border-blue-200',
  battery:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  bio:           'bg-purple-100 text-purple-800 border-purple-200',
  finance:       'bg-amber-100 text-amber-800 border-amber-200',
  energy_chem:   'bg-orange-100 text-orange-800 border-orange-200',
  steel:         'bg-slate-200 text-slate-700 border-slate-300',
  it:            'bg-cyan-100 text-cyan-800 border-cyan-200',
  auto:          'bg-rose-100 text-rose-800 border-rose-200',
  healthcare:    'bg-pink-100 text-pink-800 border-pink-200',
  shipbuilding:  'bg-sky-100 text-sky-800 border-sky-200',
  defense:       'bg-red-100 text-red-800 border-red-200',
  market:        'bg-gray-100 text-gray-600 border-gray-200',
};

// 섹터 ETF 매핑 (추천 카드용)
const SECTOR_ETF: Record<string, { code: string; name: string }> = {
  semiconductor: { code: '091160', name: 'KODEX 반도체' },
  battery:       { code: '305720', name: 'KODEX 2차전지산업' },
  bio:           { code: '244580', name: 'KODEX 바이오' },
  finance:       { code: '139270', name: 'KODEX 은행' },
  energy_chem:   { code: '117460', name: 'KODEX 에너지화학' },
  steel:         { code: '117680', name: 'KODEX 철강' },
  it:            { code: '266360', name: 'KODEX IT' },
  auto:          { code: '091180', name: 'KODEX 자동차' },
  shipbuilding:  { code: '441540', name: 'HANARO Fn조선해운' },
  defense:       { code: '463250', name: 'TIGER K방산&우주' },
};

// 집중도 바 색상
const SECTOR_BAR: Record<string, string> = {
  semiconductor: 'bg-blue-500',
  battery:       'bg-emerald-500',
  bio:           'bg-purple-500',
  finance:       'bg-amber-500',
  energy_chem:   'bg-orange-500',
  steel:         'bg-slate-500',
  it:            'bg-cyan-500',
  auto:          'bg-rose-500',
  healthcare:    'bg-pink-500',
  shipbuilding:  'bg-sky-500',
  defense:       'bg-red-500',
  market:        'bg-gray-400',
};

// 추천 트리거 임계값
const RECOMMEND_MIN_STOCKS = 3;   // 같은 섹터 N종목 이상
const RECOMMEND_MIN_WEIGHT = 40;  // 섹터 비중 N% 이상

// ── 표시 헬퍼 ─────────────────────────────────────────────────────────────
function fmtAmt(won: number): string {
  if (!Number.isFinite(won) || won === 0) return '0억';
  const abs  = Math.abs(won);
  const sign = won < 0 ? '-' : '';
  if (abs >= 1_0000_0000) return `${sign}${(abs / 1_0000_0000).toFixed(1)}억`;
  if (abs >= 1_0000)      return `${sign}${Math.round(abs / 1_0000).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}원`;
}

function wonToBillion(won: number): string {
  if (won === 0) return '';
  return (won / 1_0000_0000).toFixed(2).replace(/\.?0+$/, '');
}

function SectorFlags({ a }: { a: StockAnalysis }) {
  return (
    <>
      <span className={`rounded-full border px-1.5 py-0 text-[10px] font-bold ${SECTOR_COLOR[a.sector] ?? SECTOR_COLOR.market}`}>
        {a.sectorLabel}
      </span>
      {a.isUncovered && (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0 text-[10px] text-gray-500">
          fallback
        </span>
      )}
      {a.reliability.isLow && (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-600">
          R²낮음
        </span>
      )}
      {a.multiSector && a.multiSector.length > 0 && (
        <span className="rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0 text-[10px] text-indigo-600">
          복수:{a.multiSector.map((s) => s.sectorLabel).join('·')}
        </span>
      )}
    </>
  );
}

// ── 기존 보유 행 (읽기 전용, 회색) ────────────────────────────────────────
function HoldingDisplayRow({ row, totalKrw }: { row: HoldingRow; totalKrw: number }) {
  const { holding: h, analysis: a, loadError } = row;
  const weightPct = totalKrw > 0 && h.evalKrw > 0 ? (h.evalKrw / totalKrw) * 100 : null;
  const isLoading = !a && !loadError;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="font-semibold text-slate-700">{h.name}</span>
        {h.ticker && <span className="text-slate-400">{h.ticker}</span>}
        <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0 text-[9px] text-slate-400">기존 보유 분석</span>
        {isLoading && (
          <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0 text-[10px] text-slate-400">
            <span className="inline-block h-2 w-2 animate-spin rounded-full border border-slate-400 border-t-transparent" />
            분석 중
          </span>
        )}
        {loadError && (
          <span className="rounded-full border border-rose-100 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-400">조회 실패</span>
        )}
        {a && <SectorFlags a={a} />}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-[5.5rem] text-right font-semibold text-slate-700">{fmtAmt(h.evalKrw)}</span>
        <span className="w-14 text-right text-slate-500">
          {weightPct !== null ? `${weightPct.toFixed(1)}%` : '—'}
        </span>
        <span className="w-12 text-right text-slate-400">
          {a && !a.isUncovered ? `β ${a.beta.toFixed(2)}` : '—'}
        </span>
        <span className="w-14 text-right text-slate-400">
          {a && !a.isUncovered ? `σ ${a.volatilityAnnual.toFixed(1)}%` : ''}
        </span>
        <div className="flex-1" />
      </div>
    </div>
  );
}

// ── 신규 계획 행 (편집 가능, 파란색) ──────────────────────────────────────
function PlanStockRow({
  row, etfAllocKrw, onRemove, onAmountChange,
}: {
  row: PlanRow; etfAllocKrw: number;
  onRemove: () => void; onAmountChange: (krw: number) => void;
}) {
  const { analysis: a, amountKrw } = row;
  const weightPct = etfAllocKrw > 0 && amountKrw > 0 ? (amountKrw / etfAllocKrw) * 100 : null;

  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="font-semibold text-fg">{a.stockName}</span>
        <span className="text-fg-muted">{a.stockCode}</span>
        <span className="rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0 text-[10px] text-indigo-600">PB 수동 입력</span>
        <SectorFlags a={a} />
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <input
            type="number" min="0" step="0.1"
            value={wonToBillion(amountKrw)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onAmountChange(Number.isFinite(v) && v >= 0 ? Math.round(v * 1_0000_0000) : 0);
            }}
            placeholder="0"
            className="w-[5.5rem] rounded-md border border-border bg-surface px-2 py-1 pr-6 text-right text-xs font-semibold text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute right-2 text-[10px] text-fg-muted">억</span>
        </div>
        <div className="w-14 text-right">
          {weightPct !== null
            ? <span className="font-bold text-indigo-700">{weightPct.toFixed(1)}%</span>
            : <span className="text-fg-muted">—</span>}
        </div>
        <div className="w-12 text-right text-fg-muted">
          {a.isUncovered ? '—' : `β ${a.beta.toFixed(2)}`}
        </div>
        <div className="w-14 text-right text-fg-muted">
          {a.isUncovered ? '' : `σ ${a.volatilityAnnual.toFixed(1)}%`}
        </div>
        <div className="flex-1" />
        <button onClick={onRemove} className="text-fg-muted hover:text-rose-500" title="제거">✕</button>
      </div>
    </div>
  );
}

function ColHeader() {
  return (
    <div className="mb-1 flex items-center gap-2 px-1 text-[10px] text-fg-muted">
      <span className="flex-1">종목 · 섹터</span>
      <span className="w-[5.5rem] text-right">금액</span>
      <span className="w-14 text-right">비중</span>
      <span className="w-12 text-right">베타</span>
      <span className="w-14 text-right">변동성</span>
      <span className="w-4" />
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────
export default function StockSectorPanel({
  etfAllocKrw,
  existingHoldings = [],
  onPlanChange,
  onPlanRowsChange,
  initialRows,
}: {
  etfAllocKrw:       number;
  existingHoldings?: ExistingHolding[];
  onPlanChange?:     (plan: PlanSummaryItem[]) => void;
  onPlanRowsChange?: (rows: PlanRowOrigin[]) => void;
  initialRows?:      PlanRowOrigin[]; // localStorage 복원용 원본 종목 (마운트 1회 hydrate)
}) {
  // ── 기존 보유 분석 state ───────────────────────────────────────────────
  const [holdingRows,     setHoldingRows]     = useState<HoldingRow[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  useEffect(() => {
    if (existingHoldings.length === 0) { setHoldingRows([]); return; }
    let cancelled = false;
    setHoldingsLoading(true);
    setHoldingRows(existingHoldings.map((h) => ({ holding: h, analysis: null, loadError: null })));
    (async () => {
      const results = await Promise.allSettled(
        existingHoldings.map(async (h) => {
          const q = h.ticker ?? h.name;
          const res = await fetch(`/api/sector-analysis/stock?q=${encodeURIComponent(q)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as StockAnalysis;
        }),
      );
      if (cancelled) return;
      setHoldingRows(existingHoldings.map((h, i) => {
        const r = results[i];
        return {
          holding:   h,
          analysis:  r.status === 'fulfilled' ? r.value : null,
          loadError: r.status === 'rejected' ? String((r as PromiseRejectedResult).reason) : null,
        };
      }));
      setHoldingsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [existingHoldings]);

  // ── 신규 계획 state ────────────────────────────────────────────────────
  const [query,         setQuery]         = useState('');
  const [amountBillion, setAmountBillion] = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [planRows,      setPlanRows]      = useState<PlanRow[]>([]);
  const [restoring,     setRestoring]     = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!onPlanChange) return;
    onPlanChange(
      planRows
        .filter((r) => r.amountKrw > 0)
        .map((r) => ({
          etfCode:    r.analysis.etfCode,
          amountKrw:  r.amountKrw,
          isFallback: r.analysis.isFallback || r.analysis.isUncovered,
        })),
    );
  }, [planRows, onPlanChange]);

  // 원본 종목(stockCode·stockName·amountKrw)도 상위로 미러링 — 값만 전달, 저장은 확정 시점에만.
  useEffect(() => {
    if (!onPlanRowsChange) return;
    onPlanRowsChange(
      planRows
        .filter((r) => r.amountKrw > 0)
        .map((r) => ({
          stockCode: r.analysis.stockCode,
          stockName: r.analysis.stockName,
          amountKrw: r.amountKrw,
        })),
    );
  }, [planRows, onPlanRowsChange]);

  // ── 복원(hydrate): localStorage에서 받은 initialRows를 마운트 1회 재구성 ──────
  // startup(기존 보유 분석) 완료 후에만 시작 + 종목별 재조회는 "순차"(직렬)로 — cascade flicker 방지.
  // startup 미완료 또는 사용자가 이미 입력을 시작했으면 주입하지 않는다.
  const startupSettled =
    existingHoldings.length === 0 ||
    (!holdingsLoading && holdingRows.length === existingHoldings.length);

  useEffect(() => {
    if (typeof window === 'undefined') return;        // SSR 가드 — 클라이언트에서만
    if (!initialRows || initialRows.length === 0) return;
    if (!startupSettled) return;                      // 기존 startup API 끝난 뒤에만 시작

    // StrictMode 이중 마운트 안전: cleanup은 이 run의 fetch만 abort.
    // abort된(가짜 cleanup/언마운트) run은 폐기되고, 살아남는 마운트가 새로 fetch해 완료한다.
    const controller = new AbortController();
    setRestoring(true);
    (async () => {
      try {
        const restored: PlanRow[] = [];
        for (const row of initialRows) {              // 순차(직렬): 동시 호출 금지
          try {
            const res = await fetch(
              `/api/sector-analysis/stock?q=${encodeURIComponent(row.stockCode)}`,
              { signal: controller.signal },
            );
            if (!res.ok) continue;                    // 실패 종목은 스킵
            const data = (await res.json()) as StockAnalysis;
            restored.push({ analysis: data, amountKrw: row.amountKrw });
          } catch (e) {
            if (controller.signal.aborted) throw e;   // 진짜 중단 → 루프 종료(살아남는 마운트가 완료)
            /* 개별 종목 실패 → 다음 종목 계속 */
          }
        }
        // 루프 완료 후 1회만 반영 → 복원 도중 planRows 불변 → effect 자기취소 없음.
        // 사용자가 도중 직접 입력했으면 덮어쓰지 않음(planRows는 PB 수동전용, 보유종목과 별도 배열).
        setPlanRows((prev) => (prev.length > 0 ? prev : restored));
      } catch {
        /* abort: StrictMode 가짜 cleanup 또는 실제 언마운트 — 살아남는 마운트가 다시 완료 */
      } finally {
        // 살아있는(abort 안 된) run만 스피너 해제 → 영구 고착 차단.
        // abort된 run은 직후 새 마운트가 setRestoring(true) 후 완료 시 해제하므로 안전.
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();
    return () => { controller.abort(); };
  }, [initialRows, startupSettled]);

  // ── 섹터 종합 분석 (memo) ──────────────────────────────────────────────
  const combinedHoldings = useMemo<CombinedHolding[]>(() => {
    const result: CombinedHolding[] = [];
    for (const row of holdingRows) {
      if (!row.analysis || row.holding.evalKrw <= 0) continue;
      result.push({
        name:        row.holding.name,
        sector:      row.analysis.sector,
        sectorLabel: row.analysis.sectorLabel,
        valueKrw:    row.holding.evalKrw,
        isFallback:  row.analysis.isFallback,
        source:      'existing',
      });
    }
    for (const row of planRows) {
      if (row.amountKrw <= 0) continue;
      result.push({
        name:        row.analysis.stockName,
        sector:      row.analysis.sector,
        sectorLabel: row.analysis.sectorLabel,
        valueKrw:    row.amountKrw,
        isFallback:  row.analysis.isFallback,
        source:      'plan',
      });
    }
    return result;
  }, [holdingRows, planRows]);

  const sectorAnalysis = useMemo(() => {
    if (combinedHoldings.length === 0) return null;
    const totalKrw = combinedHoldings.reduce((s, h) => s + h.valueKrw, 0);
    if (totalKrw === 0) return null;

    const groups = new Map<string, { sectorLabel: string; valueKrw: number; count: number; hasAnyFallback: boolean }>();
    for (const h of combinedHoldings) {
      const g = groups.get(h.sector) ?? { sectorLabel: h.sectorLabel, valueKrw: 0, count: 0, hasAnyFallback: false };
      g.valueKrw += h.valueKrw;
      g.count++;
      if (h.isFallback) g.hasAnyFallback = true;
      groups.set(h.sector, g);
    }

    const buckets: SectorBucket[] = Array.from(groups.entries())
      .map(([sector, g]) => ({
        sector,
        sectorLabel:    g.sectorLabel,
        valueKrw:       g.valueKrw,
        weightPct:      (g.valueKrw / totalKrw) * 100,
        count:          g.count,
        hasAnyFallback: g.hasAnyFallback,
      }))
      .sort((a, b) => b.weightPct - a.weightPct);

    const recommendations = buckets.filter((b) =>
      SECTOR_ETF[b.sector] !== undefined &&
      !b.hasAnyFallback &&
      (b.count >= RECOMMEND_MIN_STOCKS || b.weightPct >= RECOMMEND_MIN_WEIGHT),
    );

    return { buckets, totalKrw, recommendations };
  }, [combinedHoldings]);

  // ── 파생값 ─────────────────────────────────────────────────────────────
  const totalHoldingsKrw = existingHoldings.reduce((s, h) => s + h.evalKrw, 0);
  const hasAlloc         = etfAllocKrw > 0;
  const totalEnteredKrw  = planRows.reduce((s, r) => s + r.amountKrw, 0);
  const remainingKrw     = etfAllocKrw - totalEnteredKrw;
  const fillRatioPct     = hasAlloc ? Math.min((totalEnteredKrw / etfAllocKrw) * 100, 100) : 0;
  const isOver           = hasAlloc && remainingKrw < 0;
  const totalWeightPct   = hasAlloc ? (totalEnteredKrw / etfAllocKrw) * 100 : 0;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const already = planRows.find((r) => r.analysis.stockCode === q || r.analysis.stockName === q);
    if (already) { setError(`${already.analysis.stockName}은(는) 이미 추가됐습니다.`); return; }
    const billion   = parseFloat(amountBillion);
    const amountKrw = Number.isFinite(billion) && billion > 0 ? Math.round(billion * 1_0000_0000) : 0;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/sector-analysis/stock?q=${encodeURIComponent(q)}`);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${res.status}`); }
      const data: StockAnalysis = await res.json();
      setPlanRows((prev) => [...prev, { analysis: data, amountKrw }]);
      setQuery(''); setAmountBillion('');
      nameRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 실패');
    } finally { setLoading(false); }
  }

  function removePlan(code: string) { setPlanRows((prev) => prev.filter((r) => r.analysis.stockCode !== code)); }
  function updatePlanAmount(code: string, krw: number) {
    setPlanRows((prev) => prev.map((r) => r.analysis.stockCode === code ? { ...r, amountKrw: krw } : r));
  }

  // ── 렌더 ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 border-t border-border pt-4">

      {/* ══ 섹션 1: 고객 기존 보유주식 (회색, 읽기 전용) ══════════════════ */}
      {existingHoldings.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <span className="text-xs font-bold text-fg">기존 보유종목 섹터 진단</span>
              {holdingsLoading && <span className="text-[10px] text-fg-muted">섹터 분석 중…</span>}
            </div>
            {totalHoldingsKrw > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-fg-muted">합계</span>
                <span className="font-bold text-slate-600">{fmtAmt(totalHoldingsKrw)}</span>
              </div>
            )}
          </div>
          <div className="mb-1 flex items-center gap-2 px-1 text-[10px] text-fg-muted">
            <span className="flex-1">종목 · 섹터</span>
            <span className="w-[5.5rem] text-right">평가금액</span>
            <span className="w-14 text-right">비중</span>
            <span className="w-12 text-right">베타</span>
            <span className="w-14 text-right">변동성</span>
            <span className="w-4" />
          </div>
          <div className="space-y-1.5">
            {holdingRows.map((row) => (
              <HoldingDisplayRow
                key={row.holding.ticker ?? row.holding.name}
                row={row}
                totalKrw={totalHoldingsKrw}
              />
            ))}
          </div>
          {holdingRows.length >= 2 && (
            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-[11px]">
              <span className="flex-1 text-slate-500">합계</span>
              <span className="w-[5.5rem] text-right font-bold text-slate-700">{fmtAmt(totalHoldingsKrw)}</span>
              <span className="w-14 text-right text-slate-500">100%</span>
              <span className="w-12" /><span className="w-14" /><span className="w-4" />
            </div>
          )}
        </div>
      )}

      {/* ══ 섹션 2: PB 검토용 종목 분석 (파란색, 편집 가능) ════════════════════ */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            <span className="text-xs font-bold text-fg">PB 검토용 종목 분석</span>
            {restoring && (
              <span className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0 text-[10px] text-indigo-600">
                <span className="inline-block h-2 w-2 animate-spin rounded-full border border-indigo-400 border-t-transparent" />
                복원 중
              </span>
            )}
          </div>
          {hasAlloc ? (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-fg-muted">주식 할당</span>
              <span className="font-bold text-indigo-700">{fmtAmt(etfAllocKrw)}</span>
            </div>
          ) : (
            <span className="text-[10px] text-fg-muted">보유자산 로드 후 할당액 표시</span>
          )}
        </div>

        <p className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-800">
          입력된 개별종목은 추천 종목이 아니라, 섹터 노출·베타·변동성·R²·섹터 집중도를 점검하기 위한 분석 대상입니다.
        </p>
        <form onSubmit={handleAdd} className="mb-3 flex gap-2">
            <p className="hidden">
              입력된 개별종목은 추천 종목이 아니라, 섹터 노출·베타·변동성·R²·섹터 집중도를 점검하기 위한 분석 대상입니다.
            </p>
            <input
              ref={nameRef} value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null); }}
              placeholder="분석할 종목명 또는 6자리 코드" disabled={loading}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
          />
          <div className="relative flex items-center">
            <input
              type="number" min="0" step="0.1" value={amountBillion}
              onChange={(e) => setAmountBillion(e.target.value)}
              placeholder="0" disabled={loading}
              className="w-20 rounded-lg border border-border bg-surface px-2 py-2 pr-6 text-right text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="pointer-events-none absolute right-2 text-[10px] text-fg-muted">억</span>
          </div>
          <button
            type="submit" disabled={loading || !query.trim()}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            {loading ? (
              <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />분석 중</>
            ) : '추가'}
          </button>
        </form>

        {error && (
          <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</div>
        )}

        {planRows.length > 0 && hasAlloc && (
          <div className="mb-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-fg-muted">
                투입 <span className="font-bold text-fg">{fmtAmt(totalEnteredKrw)}</span>
                <span className="mx-1">/</span>
                할당 <span className="font-bold text-fg">{fmtAmt(etfAllocKrw)}</span>
              </span>
              <span className={`font-bold ${isOver ? 'text-rose-600' : 'text-emerald-600'}`}>
                {isOver ? `초과 ${fmtAmt(-remainingKrw)}` : `잔여 ${fmtAmt(remainingKrw)}`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className={`h-full rounded-full transition-all duration-300 ${isOver ? 'bg-rose-500' : 'bg-indigo-500'}`}
                style={{ width: `${fillRatioPct}%` }}
              />
            </div>
          </div>
        )}

        {planRows.length > 0 && (
          <>
            <ColHeader />
            <div className="space-y-1.5">
              {planRows.map((row) => (
                <PlanStockRow
                  key={row.analysis.stockCode} row={row} etfAllocKrw={etfAllocKrw}
                  onRemove={() => removePlan(row.analysis.stockCode)}
                  onAmountChange={(krw) => updatePlanAmount(row.analysis.stockCode, krw)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[11px]">
              <span className="flex-1 text-fg-muted">합계</span>
              <span className="w-[5.5rem] text-right font-bold text-fg">{fmtAmt(totalEnteredKrw)}</span>
              <span className="w-14 text-right font-bold text-indigo-700">
                {hasAlloc ? `${totalWeightPct.toFixed(1)}%` : '—'}
              </span>
              <span className="w-12" /><span className="w-14" /><span className="w-4" />
            </div>
          </>
        )}

        {planRows.length === 0 && !loading && !error && (
          <p className="py-3 text-center text-[11px] text-fg-muted">
            종목명·코드와 금액(억)을 입력하면 비중을 자동 계산합니다
          </p>
        )}
      </div>

      {/* ══ 섹션 3: 섹터 종합 분석 + ETF 추천 (보라색) ════════════════════ */}
      {sectorAnalysis && (
        <div>
          {/* 헤더 */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              <span className="text-xs font-bold text-fg">섹터 종합 분석</span>
            </div>
            <span className="text-[10px] text-fg-muted">
              {combinedHoldings.length}종목 · {fmtAmt(sectorAnalysis.totalKrw)}
            </span>
          </div>

          {/* 섹터 집중도 바 */}
          <div className="mb-3 space-y-2">
            {sectorAnalysis.buckets.map((b) => (
              <div key={b.sector} className="flex items-center gap-2">
                <span className={`w-[5rem] flex-shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-bold ${SECTOR_COLOR[b.sector] ?? SECTOR_COLOR.market}`}>
                  {b.sectorLabel}
                </span>
                <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${SECTOR_BAR[b.sector] ?? 'bg-gray-400'}`}
                    style={{ width: `${b.weightPct.toFixed(1)}%` }}
                  />
                </div>
                <span className="w-9 flex-shrink-0 text-right text-[11px] font-bold text-fg">
                  {b.weightPct.toFixed(0)}%
                </span>
                <span className="w-9 flex-shrink-0 text-[10px] text-fg-muted">
                  {b.count}종목
                </span>
              </div>
            ))}
          </div>

          {/* ETF 추천 카드 */}
          {sectorAnalysis.recommendations.length > 0 ? (
            <div className="space-y-2">
              {sectorAnalysis.recommendations.map((rec) => {
                const etf = SECTOR_ETF[rec.sector]!;
                const countTrigger  = rec.count >= RECOMMEND_MIN_STOCKS;
                const weightTrigger = rec.weightPct >= RECOMMEND_MIN_WEIGHT;
                const triggerLabel  = countTrigger
                  ? `동일 섹터 ${rec.count}종목 보유`
                  : `비중 ${rec.weightPct.toFixed(0)}%`;
                const bothTrigger   = countTrigger && weightTrigger;

                return (
                  <div
                    key={rec.sector}
                    className="rounded-xl border border-violet-200 bg-violet-50/70 px-3 py-3 text-xs"
                  >
                    {/* 제목 줄 */}
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-violet-500 text-[9px] font-bold text-white">
                        !
                      </span>
                      <span className="font-bold text-violet-900">
                        {rec.sectorLabel} — ETF 고려해볼 수 있습니다
                      </span>
                      <span className="ml-auto rounded-full border border-violet-200 bg-white px-1.5 py-0 text-[10px] text-violet-600">
                        {triggerLabel}{bothTrigger ? ' · 비중' : ''}
                      </span>
                    </div>

                    {/* 제안 텍스트 */}
                    <p className="mb-2 ml-5.5 text-[11px] leading-relaxed text-violet-700">
                      섹터 노출이 목적이라면, 개별 종목 대신 ETF가 분산·거래비용·관리 면에서
                      효율적일 수 있습니다. 종목 고유 알파를 노린다면 개별 종목이 유리합니다.
                    </p>

                    {/* ETF 칩 */}
                    <div className="ml-5.5 flex items-center gap-2 rounded-lg border border-violet-200 bg-white px-2.5 py-1.5">
                      <span className="text-[10px] text-violet-400">섹터 ETF 대안</span>
                      <span className="font-bold text-violet-800">{etf.name}</span>
                      <span className="text-[10px] text-violet-400">{etf.code}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 분산 — 추천 없음 */
            combinedHoldings.length >= 2 && (
              <div className="rounded-xl border border-border bg-surface px-3 py-2.5 text-center text-[11px] text-fg-muted">
                섹터가 분산돼 있어 ETF 전환 제안 없음
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
