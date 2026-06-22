'use client';

import React, { useEffect, useRef, useState } from 'react';

// ── 공개 타입 (PortfolioPanel에서 import) ──────────────────────────────────
export interface ExistingHolding {
  name:      string;
  ticker:    string | null;
  evalKrw:   number; // qty × price × fx — PortfolioPanel에서 계산 완료
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
interface PlanRow {
  analysis:  StockAnalysis;
  amountKrw: number;
}

interface HoldingRow {
  holding:   ExistingHolding;
  analysis:  StockAnalysis | null;
  loadError: string | null;
}

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
  market:        'bg-gray-100 text-gray-600 border-gray-200',
};

function SectorFlags({ a }: { a: StockAnalysis }) {
  return (
    <>
      <span className={`rounded-full border px-1.5 py-0 text-[10px] font-bold ${SECTOR_COLOR[a.sector] ?? SECTOR_COLOR.market}`}>
        {a.sectorLabel}
      </span>
      {a.isUncovered && (
        <span className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0 text-[10px] text-gray-500">
          시장기준
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
      {/* 첫 줄: 종목명 + 배지들 */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="font-semibold text-slate-700">{h.name}</span>
        {h.ticker && <span className="text-slate-400">{h.ticker}</span>}
        <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0 text-[9px] text-slate-400">
          보유
        </span>
        {isLoading && (
          <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-1.5 py-0 text-[10px] text-slate-400">
            <span className="inline-block h-2 w-2 animate-spin rounded-full border border-slate-400 border-t-transparent" />
            분석 중
          </span>
        )}
        {loadError && (
          <span className="rounded-full border border-rose-100 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-400">
            조회 실패
          </span>
        )}
        {a && <SectorFlags a={a} />}
      </div>

      {/* 둘째 줄: 금액·비중·베타·변동성 */}
      <div className="flex items-center gap-2">
        <span className="w-[5.5rem] text-right font-semibold text-slate-700">
          {fmtAmt(h.evalKrw)}
        </span>
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
  row,
  etfAllocKrw,
  onRemove,
  onAmountChange,
}: {
  row:            PlanRow;
  etfAllocKrw:   number;
  onRemove:       () => void;
  onAmountChange: (krw: number) => void;
}) {
  const { analysis: a, amountKrw } = row;
  const weightPct = etfAllocKrw > 0 && amountKrw > 0 ? (amountKrw / etfAllocKrw) * 100 : null;

  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs">
      {/* 첫 줄: 종목명 + 배지들 */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="font-semibold text-fg">{a.stockName}</span>
        <span className="text-fg-muted">{a.stockCode}</span>
        <SectorFlags a={a} />
      </div>

      {/* 둘째 줄: 금액(인라인 편집)·비중·베타·변동성·제거 */}
      <div className="flex items-center gap-2">
        <div className="relative flex items-center">
          <input
            type="number"
            min="0"
            step="0.1"
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
          {weightPct !== null ? (
            <span className="font-bold text-indigo-700">{weightPct.toFixed(1)}%</span>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </div>
        <div className="w-12 text-right text-fg-muted">
          {a.isUncovered ? '—' : `β ${a.beta.toFixed(2)}`}
        </div>
        <div className="w-14 text-right text-fg-muted">
          {a.isUncovered ? '' : `σ ${a.volatilityAnnual.toFixed(1)}%`}
        </div>
        <div className="flex-1" />
        <button onClick={onRemove} className="text-fg-muted hover:text-rose-500" title="제거">
          ✕
        </button>
      </div>
    </div>
  );
}

// ── 컬럼 헤더 행 ─────────────────────────────────────────────────────────
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
}: {
  etfAllocKrw:       number;
  existingHoldings?: ExistingHolding[];
}) {
  // ── 기존 보유 분석 ─────────────────────────────────────────────────────
  const [holdingRows,    setHoldingRows]    = useState<HoldingRow[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);

  useEffect(() => {
    if (existingHoldings.length === 0) {
      setHoldingRows([]);
      return;
    }
    let cancelled = false;
    setHoldingsLoading(true);
    // 즉시 이름/금액 표시하면서 분석 중 스피너 표시
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
      setHoldingRows(
        existingHoldings.map((h, i) => {
          const r = results[i];
          return {
            holding:   h,
            analysis:  r.status === 'fulfilled' ? r.value : null,
            loadError: r.status === 'rejected'
              ? String((r as PromiseRejectedResult).reason)
              : null,
          };
        }),
      );
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
  const nameRef = useRef<HTMLInputElement>(null);

  // ── 파생값 ─────────────────────────────────────────────────────────────
  const totalHoldingsKrw  = existingHoldings.reduce((s, h) => s + h.evalKrw, 0);
  const hasAlloc          = etfAllocKrw > 0;
  const totalEnteredKrw   = planRows.reduce((s, r) => s + r.amountKrw, 0);
  const remainingKrw      = etfAllocKrw - totalEnteredKrw;
  const fillRatioPct      = hasAlloc ? Math.min((totalEnteredKrw / etfAllocKrw) * 100, 100) : 0;
  const isOver            = hasAlloc && remainingKrw < 0;
  const totalWeightPct    = hasAlloc && etfAllocKrw > 0 ? (totalEnteredKrw / etfAllocKrw) * 100 : 0;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const already = planRows.find((r) => r.analysis.stockCode === q || r.analysis.stockName === q);
    if (already) {
      setError(`${already.analysis.stockName}은(는) 이미 추가됐습니다.`);
      return;
    }
    const billion   = parseFloat(amountBillion);
    const amountKrw = Number.isFinite(billion) && billion > 0
      ? Math.round(billion * 1_0000_0000)
      : 0;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sector-analysis/stock?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: StockAnalysis = await res.json();
      setPlanRows((prev) => [...prev, { analysis: data, amountKrw }]);
      setQuery('');
      setAmountBillion('');
      nameRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 실패');
    } finally {
      setLoading(false);
    }
  }

  function removePlan(code: string) {
    setPlanRows((prev) => prev.filter((r) => r.analysis.stockCode !== code));
  }

  function updatePlanAmount(code: string, amountKrw: number) {
    setPlanRows((prev) =>
      prev.map((r) => r.analysis.stockCode === code ? { ...r, amountKrw } : r),
    );
  }

  return (
    <div className="space-y-4 border-t border-border pt-4">

      {/* ══════════════════════════════════════════════════════════
          섹션 1: 고객 기존 보유주식 (회색, 읽기 전용)
      ══════════════════════════════════════════════════════════ */}
      {existingHoldings.length > 0 && (
        <div>
          {/* 헤더 */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <span className="text-xs font-bold text-fg">고객 기존 보유주식</span>
              {holdingsLoading && (
                <span className="text-[10px] text-fg-muted">섹터 분석 중…</span>
              )}
            </div>
            {totalHoldingsKrw > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-fg-muted">합계</span>
                <span className="font-bold text-slate-600">{fmtAmt(totalHoldingsKrw)}</span>
              </div>
            )}
          </div>

          {/* 컬럼 헤더 */}
          <div className="mb-1 flex items-center gap-2 px-1 text-[10px] text-fg-muted">
            <span className="flex-1">종목 · 섹터</span>
            <span className="w-[5.5rem] text-right">평가금액</span>
            <span className="w-14 text-right">비중</span>
            <span className="w-12 text-right">베타</span>
            <span className="w-14 text-right">변동성</span>
            <span className="w-4" />
          </div>

          {/* 종목 행들 */}
          <div className="space-y-1.5">
            {holdingRows.map((row) => (
              <HoldingDisplayRow
                key={row.holding.ticker ?? row.holding.name}
                row={row}
                totalKrw={totalHoldingsKrw}
              />
            ))}
          </div>

          {/* 합계 행 */}
          {holdingRows.length >= 2 && (
            <div className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-[11px]">
              <span className="flex-1 text-slate-500">합계</span>
              <span className="w-[5.5rem] text-right font-bold text-slate-700">
                {fmtAmt(totalHoldingsKrw)}
              </span>
              <span className="w-14 text-right text-slate-500">100%</span>
              <span className="w-12" />
              <span className="w-14" />
              <span className="w-4" />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          섹션 2: 신규 종목 계획 (파란색, 편집 가능)
      ══════════════════════════════════════════════════════════ */}
      <div>
        {/* 헤더 */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            <span className="text-xs font-bold text-fg">신규 종목 계획</span>
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

        {/* 입력 폼 */}
        <form onSubmit={handleAdd} className="mb-3 flex gap-2">
          <input
            ref={nameRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setError(null); }}
            placeholder="종목명 또는 6자리 코드"
            disabled={loading}
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
          />
          <div className="relative flex items-center">
            <input
              type="number"
              min="0"
              step="0.1"
              value={amountBillion}
              onChange={(e) => setAmountBillion(e.target.value)}
              placeholder="0"
              disabled={loading}
              className="w-20 rounded-lg border border-border bg-surface px-2 py-2 pr-6 text-right text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="pointer-events-none absolute right-2 text-[10px] text-fg-muted">억</span>
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            {loading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                분석 중
              </>
            ) : '추가'}
          </button>
        </form>

        {/* 에러 */}
        {error && (
          <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
            {error}
          </div>
        )}

        {/* 합계 바 */}
        {planRows.length > 0 && hasAlloc && (
          <div className="mb-3 rounded-xl border border-border bg-surface px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-fg-muted">
                투입{' '}
                <span className="font-bold text-fg">{fmtAmt(totalEnteredKrw)}</span>
                <span className="mx-1 text-fg-muted">/</span>
                할당{' '}
                <span className="font-bold text-fg">{fmtAmt(etfAllocKrw)}</span>
              </span>
              <span className={`font-bold ${isOver ? 'text-rose-600' : 'text-emerald-600'}`}>
                {isOver
                  ? `초과 ${fmtAmt(-remainingKrw)}`
                  : `잔여 ${fmtAmt(remainingKrw)}`}
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

        {/* 종목 리스트 */}
        {planRows.length > 0 && (
          <>
            <ColHeader />
            <div className="space-y-1.5">
              {planRows.map((row) => (
                <PlanStockRow
                  key={row.analysis.stockCode}
                  row={row}
                  etfAllocKrw={etfAllocKrw}
                  onRemove={() => removePlan(row.analysis.stockCode)}
                  onAmountChange={(krw) => updatePlanAmount(row.analysis.stockCode, krw)}
                />
              ))}
            </div>
            {planRows.length >= 1 && (
              <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[11px]">
                <span className="flex-1 text-fg-muted">합계</span>
                <span className="w-[5.5rem] text-right font-bold text-fg">
                  {fmtAmt(totalEnteredKrw)}
                </span>
                <span className="w-14 text-right font-bold text-indigo-700">
                  {hasAlloc ? `${totalWeightPct.toFixed(1)}%` : '—'}
                </span>
                <span className="w-12" />
                <span className="w-14" />
                <span className="w-4" />
              </div>
            )}
          </>
        )}

        {planRows.length === 0 && !loading && !error && (
          <p className="py-3 text-center text-[11px] text-fg-muted">
            종목명·코드와 금액(억)을 입력하면 비중을 자동 계산합니다
          </p>
        )}
      </div>
    </div>
  );
}
