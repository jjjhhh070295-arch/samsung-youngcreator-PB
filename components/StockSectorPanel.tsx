'use client';

import React, { useRef, useState } from 'react';

// ── API 응답 타입 (sectorMap.ts SectorAnalysisResult 미러) ──────────────────
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

interface StockRow {
  analysis:  StockAnalysis;
  amountKrw: number; // 원 단위 내부 저장
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

// ── 섹터 배지 색상 ─────────────────────────────────────────────────────────
const SECTOR_COLOR: Record<string, string> = {
  semiconductor: 'bg-blue-100 text-blue-800 border-blue-200',
  battery:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  bio:           'bg-purple-100 text-purple-800 border-purple-200',
  finance:       'bg-amber-100 text-amber-800 border-amber-200',
  energy_chem:   'bg-orange-100 text-orange-800 border-orange-200',
  steel:         'bg-slate-100 text-slate-700 border-slate-200',
  it:            'bg-cyan-100 text-cyan-800 border-cyan-200',
  auto:          'bg-rose-100 text-rose-800 border-rose-200',
  healthcare:    'bg-pink-100 text-pink-800 border-pink-200',
  market:        'bg-gray-100 text-gray-600 border-gray-200',
};

// ── 종목 행 컴포넌트 ────────────────────────────────────────────────────────
function StockRow({
  row,
  etfAllocKrw,
  onRemove,
  onAmountChange,
}: {
  row:            StockRow;
  etfAllocKrw:   number;
  onRemove:       () => void;
  onAmountChange: (krw: number) => void;
}) {
  const { analysis: a, amountKrw } = row;
  const hasAlloc  = etfAllocKrw > 0;
  const weightPct = hasAlloc && amountKrw > 0 ? (amountKrw / etfAllocKrw) * 100 : null;
  const sectorCls = SECTOR_COLOR[a.sector] ?? SECTOR_COLOR.market;

  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs">
      {/* 첫 줄: 종목명 + 플래그 배지들 */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className="font-semibold text-fg">{a.stockName}</span>
        <span className="text-fg-muted">{a.stockCode}</span>
        <span className={`rounded-full border px-1.5 py-0 text-[10px] font-bold ${sectorCls}`}>
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
      </div>

      {/* 둘째 줄: 금액 입력 + 비중 + 베타 + 제거 */}
      <div className="flex items-center gap-2">
        {/* 금액 인라인 편집 */}
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

        {/* 비중 */}
        <div className="w-14 text-right">
          {weightPct !== null ? (
            <span className="font-bold text-indigo-700">{weightPct.toFixed(1)}%</span>
          ) : (
            <span className="text-fg-muted">—</span>
          )}
        </div>

        {/* 베타 */}
        <div className="w-12 text-right text-fg-muted">
          {a.isUncovered ? '—' : `β ${a.beta.toFixed(2)}`}
        </div>

        {/* 변동성 */}
        <div className="w-14 text-right text-fg-muted">
          {a.isUncovered ? '' : `σ ${a.volatilityAnnual.toFixed(1)}%`}
        </div>

        <div className="flex-1" />

        {/* 제거 */}
        <button
          onClick={onRemove}
          className="text-fg-muted hover:text-rose-500"
          title="제거"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function StockSectorPanel({ etfAllocKrw }: { etfAllocKrw: number }) {
  const [query,         setQuery]         = useState('');
  const [amountBillion, setAmountBillion] = useState('');  // 억 단위 입력 문자열
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [stocks,        setStocks]        = useState<StockRow[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  // 파생값
  const hasAlloc       = etfAllocKrw > 0;
  const totalEnteredKrw = stocks.reduce((s, r) => s + r.amountKrw, 0);
  const remainingKrw    = etfAllocKrw - totalEnteredKrw;
  const fillRatioPct    = hasAlloc ? Math.min((totalEnteredKrw / etfAllocKrw) * 100, 100) : 0;
  const isOver          = hasAlloc && remainingKrw < 0;
  const totalWeightPct  = hasAlloc && etfAllocKrw > 0 ? (totalEnteredKrw / etfAllocKrw) * 100 : 0;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // 중복 방지
    const already = stocks.find((r) => r.analysis.stockCode === q || r.analysis.stockName === q);
    if (already) {
      setError(`${already.analysis.stockName}은(는) 이미 추가됐습니다.`);
      return;
    }

    // 금액 파싱
    const billion  = parseFloat(amountBillion);
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
      setStocks((prev) => [...prev, { analysis: data, amountKrw }]);
      setQuery('');
      setAmountBillion('');
      nameRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 실패');
    } finally {
      setLoading(false);
    }
  }

  function removeStock(code: string) {
    setStocks((prev) => prev.filter((r) => r.analysis.stockCode !== code));
  }

  function updateAmount(code: string, amountKrw: number) {
    setStocks((prev) =>
      prev.map((r) => r.analysis.stockCode === code ? { ...r, amountKrw } : r),
    );
  }

  return (
    <div className="border-t border-border pt-4">
      {/* ── 섹션 헤더 ─────────────────────────────────────────────────── */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-indigo-500" />
          <span className="text-xs font-bold text-fg">종목 비중 계획</span>
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

      {/* ── 입력 폼 ────────────────────────────────────────────────────── */}
      <form onSubmit={handleAdd} className="mb-3 flex gap-2">
        {/* 종목명/코드 */}
        <input
          ref={nameRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(null); }}
          placeholder="종목명 또는 6자리 코드"
          disabled={loading}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        />

        {/* 금액 (억 단위) */}
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

      {/* ── 에러 ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {/* ── 합계 바 (종목이 있을 때) ──────────────────────────────────── */}
      {stocks.length > 0 && hasAlloc && (
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

      {/* ── 종목 리스트 ───────────────────────────────────────────────── */}
      {stocks.length > 0 && (
        <>
          {/* 컬럼 헤더 */}
          <div className="mb-1 flex items-center gap-2 px-1 text-[10px] text-fg-muted">
            <span className="flex-1">종목 · 섹터</span>
            <span className="w-[5.5rem] text-right">금액</span>
            <span className="w-14 text-right">비중</span>
            <span className="w-12 text-right">베타</span>
            <span className="w-14 text-right">변동성</span>
            <span className="w-4" />
          </div>

          <div className="space-y-1.5">
            {stocks.map((row) => (
              <StockRow
                key={row.analysis.stockCode}
                row={row}
                etfAllocKrw={etfAllocKrw}
                onRemove={() => removeStock(row.analysis.stockCode)}
                onAmountChange={(krw) => updateAmount(row.analysis.stockCode, krw)}
              />
            ))}
          </div>

          {/* 합계 행 */}
          {stocks.length >= 1 && (
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

      {stocks.length === 0 && !loading && !error && (
        <p className="py-3 text-center text-[11px] text-fg-muted">
          종목명·코드와 금액(억)을 입력하면 비중을 자동 계산합니다
        </p>
      )}
    </div>
  );
}
