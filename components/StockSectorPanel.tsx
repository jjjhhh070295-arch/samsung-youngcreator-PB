'use client';

import React, { useRef, useState } from 'react';

// ── API 응답 타입 (sectorMap.ts SectorAnalysisResult 미러) ──────────────────
interface MultiSectorEntry {
  sector:      string;
  sectorLabel: string;
  etfTicker:   string;
  weightPct:   number;
}

interface ReliabilityInfo {
  r2:      number;
  isLow:   boolean;
  message: string;
}

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

// ── 섹터별 색상 ────────────────────────────────────────────────────────────
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

function sectorBadge(sector: string, label: string) {
  const cls = SECTOR_COLOR[sector] ?? SECTOR_COLOR.market;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

// ── 개별 종목 카드 ──────────────────────────────────────────────────────────
function StockCard({
  analysis,
  onRemove,
}: {
  analysis: StockAnalysis;
  onRemove: () => void;
}) {
  const { stockName, stockCode, sectorLabel, sector, etfName, beta, volatilityAnnual,
          alphaAnnual, r2, periodMonths, rangeStart, rangeEnd,
          isUncovered, multiSector, reliability } = analysis;

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3 text-xs">
      {/* 헤더 */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold text-fg">{stockName}</span>
          <span className="text-fg-muted">{stockCode}</span>
          {sectorBadge(sector, sectorLabel)}
          {isUncovered && (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] text-gray-500">
              시장 기준
            </span>
          )}
        </div>
        <button
          onClick={onRemove}
          className="ml-1 flex-shrink-0 text-fg-muted hover:text-rose-500"
          title="제거"
        >
          ✕
        </button>
      </div>

      {/* 지표 그리드 */}
      {!isUncovered && (
        <div className="mb-2 grid grid-cols-4 gap-1">
          <div className="rounded-lg bg-surface p-1.5 text-center">
            <div className="text-[10px] text-fg-muted">베타</div>
            <div className="font-bold text-fg">{beta.toFixed(2)}</div>
          </div>
          <div className="rounded-lg bg-surface p-1.5 text-center">
            <div className="text-[10px] text-fg-muted">변동성</div>
            <div className="font-bold text-fg">{volatilityAnnual.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-surface p-1.5 text-center">
            <div className="text-[10px] text-fg-muted">알파(연)</div>
            <div className={`font-bold ${alphaAnnual >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {alphaAnnual >= 0 ? '+' : ''}{alphaAnnual.toFixed(1)}%
            </div>
          </div>
          <div className="rounded-lg bg-surface p-1.5 text-center">
            <div className="text-[10px] text-fg-muted">R²</div>
            <div className={`font-bold ${reliability.isLow ? 'text-amber-600' : 'text-fg'}`}>
              {r2.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* 플래그 */}
      <div className="space-y-1">
        {/* R² 낮음 */}
        {reliability.isLow && (
          <div className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
            <span>⚠</span>
            <span>R² {r2.toFixed(2)} — 섹터ETF 설명력 낮음. 참고용으로만 활용하세요.</span>
          </div>
        )}

        {/* 복수 섹터 */}
        {multiSector && multiSector.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-indigo-700">
            <span className="font-bold">복수 섹터:</span>
            {multiSector.map((s) => (
              <span key={s.etfTicker} className="rounded border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px]">
                {s.sectorLabel} {s.weightPct.toFixed(1)}%
              </span>
            ))}
          </div>
        )}

        {/* 미커버 */}
        {isUncovered && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-500">
            섹터ETF 미편입 종목 — KOSPI 벤치마크 사용
          </div>
        )}

        {/* ETF + 기간 */}
        {!isUncovered && (
          <div className="text-[10px] text-fg-muted">
            기준 ETF: {etfName} · {rangeStart} ~ {rangeEnd} ({periodMonths}개월)
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────────
export default function StockSectorPanel() {
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [stocks, setStocks]     = useState<StockAnalysis[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    // 중복 방지: 이미 추가된 코드/이름이면 스킵
    const already = stocks.find(
      (s) => s.stockCode === q || s.stockName === q,
    );
    if (already) {
      setError(`${already.stockName}은(는) 이미 추가됐습니다.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sector-analysis/stock?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data: StockAnalysis = await res.json();
      setStocks((prev) => [data, ...prev]);
      setQuery('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 실패');
    } finally {
      setLoading(false);
    }
  }

  function removeStock(code: string) {
    setStocks((prev) => prev.filter((s) => s.stockCode !== code));
  }

  return (
    <div className="border-t border-border pt-4">
      {/* 섹션 헤더 */}
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
        <span className="text-xs font-bold text-fg">종목 섹터 분석</span>
        <span className="text-[10px] text-fg-muted">종목명 또는 6자리 코드</span>
      </div>

      {/* 입력 폼 */}
      <form onSubmit={handleSearch} className="mb-3 flex gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(null); }}
          placeholder="예: SK하이닉스  /  000660"
          disabled={loading}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {loading ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              분석 중
            </>
          ) : '분석'}
        </button>
      </form>

      {/* 에러 */}
      {error && (
        <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      )}

      {/* 결과 리스트 */}
      {stocks.length > 0 && (
        <div className="space-y-2">
          {stocks.map((s) => (
            <StockCard
              key={s.stockCode}
              analysis={s}
              onRemove={() => removeStock(s.stockCode)}
            />
          ))}
        </div>
      )}

      {stocks.length === 0 && !loading && !error && (
        <p className="text-center text-[11px] text-fg-muted py-3">
          종목을 입력하면 섹터·베타·변동성을 분석합니다
        </p>
      )}
    </div>
  );
}
