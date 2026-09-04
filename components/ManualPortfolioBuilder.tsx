"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import PortfolioAnalyticsCards from "./PortfolioAnalyticsCards";

type AssetClass =
  | "domesticEquity"
  | "globalEquity"
  | "domesticBond"
  | "globalBond"
  | "alternatives"
  | "cash";

type Allocation = Record<AssetClass, number>;

type Instrument = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  kind: string;
  price: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
};

type SelectedInstrument = Instrument & { assetClass: AssetClass; weightWithinClass: number };

type ExistingHolding = {
  id: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
  valueKrw: number;
  assetClass: "domesticEquity" | "globalEquity";
};

const ASSET_CLASSES: Array<{ id: AssetClass; label: string; description: string; searchable: boolean }> = [
  { id: "domesticEquity", label: "국내주식", description: "기존 국내주식 포함", searchable: true },
  { id: "globalEquity", label: "해외주식", description: "기존 해외주식 포함", searchable: true },
  { id: "domesticBond", label: "국내채권", description: "국채·회사채·채권 ETF", searchable: true },
  { id: "globalBond", label: "해외채권", description: "해외 국채·회사채·채권 ETF", searchable: true },
  { id: "alternatives", label: "상품·대체", description: "금·원자재·리츠 등", searchable: true },
  { id: "cash", label: "현금성", description: "예수금·MMF/RP", searchable: false },
];

const ASSET_COLORS: Record<AssetClass, string> = {
  domesticEquity: "#1428A0",
  globalEquity: "#4F67E8",
  domesticBond: "#0EA5E9",
  globalBond: "#14B8A6",
  alternatives: "#D97706",
  cash: "#64748B",
};

const EMPTY_ALLOCATION: Allocation = {
  domesticEquity: 0,
  globalEquity: 0,
  domesticBond: 0,
  globalBond: 0,
  alternatives: 0,
  cash: 100,
};

function storageKey(clientId: string) {
  return `pb-manual-portfolio-v1-${clientId}`;
}

function formatWon(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억원`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatPrice(value: number | null, currency: string) {
  if (value == null) return "시세 확인 불가";
  return `${currency === "KRW" ? "₩" : "$"}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}`;
}

export default function ManualPortfolioBuilder({ clientId, totalAssetWon }: { clientId: string; totalAssetWon: number }) {
  const [allocation, setAllocation] = useState<Allocation>(EMPTY_ALLOCATION);
  const [selected, setSelected] = useState<SelectedInstrument[]>([]);
  const [existing, setExisting] = useState<ExistingHolding[]>([]);
  const [realEstateWon, setRealEstateWon] = useState(0);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"percent" | "amount">("percent");
  const [activeClass, setActiveClass] = useState<AssetClass>("domesticEquity");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [resultType, setResultType] = useState<"stock" | "etf" | "etn" | "other">("stock");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(clientId));
      if (raw) {
        const parsed = JSON.parse(raw) as { allocation?: Allocation; selected?: SelectedInstrument[]; savedAt?: string };
        if (parsed.allocation) setAllocation({ ...EMPTY_ALLOCATION, ...parsed.allocation });
        if (Array.isArray(parsed.selected)) setSelected(parsed.selected);
        if (parsed.savedAt) setSavedAt(parsed.savedAt);
      }
    } catch {
      // 손상된 로컬 초안은 기본값으로 시작합니다.
    }
    setHydrated(true);
  }, [clientId]);

  useEffect(() => {
    if (!supabase) {
      setLoadingHoldings(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [{ data: holdingRows }, { data: propertyRows }] = await Promise.all([
          supabase
            .from("client_holdings")
            .select("id, name, ticker, market, currency, quantity, avg_price")
            .eq("client_id", clientId),
          supabase
            .from("client_real_estate")
            .select("market_value, ownership_share")
            .eq("client_id", clientId),
        ]);
        const rows = holdingRows ?? [];
        const priced = await Promise.all(rows.map(async (holding: any) => {
          let livePrice: number | null = null;
          if (holding.ticker || holding.name) {
            try {
              const response = await fetch(`/api/ticker/quote?q=${encodeURIComponent(holding.ticker || holding.name)}`, { cache: "no-store" });
              const payload = await response.json();
              if (payload.ok) livePrice = payload.quote?.price ?? null;
            } catch {
              // 평균단가로 폴백합니다.
            }
          }
          const isGlobal = holding.currency === "USD" || /NASDAQ|NYSE|AMEX|US/i.test(holding.market ?? "");
          const fx = isGlobal ? 1350 : 1;
          return {
            ...holding,
            valueKrw: Math.round((holding.quantity ?? 0) * (livePrice ?? holding.avg_price ?? 0) * fx),
            assetClass: isGlobal ? "globalEquity" : "domesticEquity",
          } as ExistingHolding;
        }));
        const propertyValue = (propertyRows ?? []).reduce(
          (sum: number, row: any) => sum + Number(row.market_value ?? 0) * Number(row.ownership_share ?? 1),
          0,
        );
        if (!cancelled) {
          setExisting(priced.filter((row) => row.valueKrw > 0));
          setRealEstateWon(propertyValue);
          if (!localStorage.getItem(storageKey(clientId))) {
            const investable = Math.max(totalAssetWon - propertyValue, priced.reduce((sum, row) => sum + row.valueKrw, 0));
            const domesticPct = investable > 0
              ? Math.round((priced.filter((row) => row.assetClass === "domesticEquity").reduce((sum, row) => sum + row.valueKrw, 0) / investable) * 1000) / 10
              : 0;
            const globalPct = investable > 0
              ? Math.round((priced.filter((row) => row.assetClass === "globalEquity").reduce((sum, row) => sum + row.valueKrw, 0) / investable) * 1000) / 10
              : 0;
            setAllocation({
              ...EMPTY_ALLOCATION,
              domesticEquity: domesticPct,
              globalEquity: globalPct,
              cash: Math.max(0, Math.round((100 - domesticPct - globalPct) * 10) / 10),
            });
          }
        }
      } finally {
        if (!cancelled) setLoadingHoldings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, totalAssetWon]);

  const investableWon = Math.max(0, totalAssetWon - realEstateWon);
  const total = Object.values(allocation).reduce((sum, value) => sum + value, 0);
  const isComplete = Math.abs(total - 100) < 0.001;
  const allocatedWon = investableWon * total / 100;
  const remainingPct = 100 - total;
  const remainingWon = investableWon - allocatedWon;

  const existingByClass = useMemo(() => ({
    domesticEquity: existing.filter((row) => row.assetClass === "domesticEquity").reduce((sum, row) => sum + row.valueKrw, 0),
    globalEquity: existing.filter((row) => row.assetClass === "globalEquity").reduce((sum, row) => sum + row.valueKrw, 0),
  }), [existing]);

  const save = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(storageKey(clientId), JSON.stringify({ allocation, selected, savedAt: now }));
    setSavedAt(now);
  }, [allocation, clientId, selected]);

  const updateAllocation = (assetClass: AssetClass, value: number) => {
    setAllocation((current) => ({ ...current, [assetClass]: Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) }));
  };

  const updateAllocationAmount = (assetClass: AssetClass, amountEok: number) => {
    const percentage = investableWon > 0 ? (amountEok * 100_000_000 / investableWon) * 100 : 0;
    updateAllocation(assetClass, Math.round(percentage * 100) / 100);
  };

  const fillRemainingWithCash = () => {
    const nonCashTotal = Object.entries(allocation)
      .filter(([key]) => key !== "cash")
      .reduce((sum, [, value]) => sum + value, 0);
    setAllocation((current) => ({ ...current, cash: Math.max(0, Math.round((100 - nonCashTotal) * 100) / 100) }));
  };

  const applyExistingHoldings = () => {
    const domesticPct = investableWon > 0 ? Math.round((existingByClass.domesticEquity / investableWon) * 10000) / 100 : 0;
    const globalPct = investableWon > 0 ? Math.round((existingByClass.globalEquity / investableWon) * 10000) / 100 : 0;
    setAllocation({ ...EMPTY_ALLOCATION, domesticEquity: domesticPct, globalEquity: globalPct, cash: Math.max(0, Math.round((100 - domesticPct - globalPct) * 100) / 100) });
  };

  const search = async () => {
    if (!query.trim() || activeClass === "cash") return;
    setSearching(true);
    setSearchError("");
    setResults([]);
    try {
      const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(query.trim())}&assetClass=${activeClass}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || "검색에 실패했습니다.");
      const nextResults = (payload.results ?? []) as Instrument[];
      setResults(nextResults);
      setResultType(
        nextResults.some((item) => !/ETF|ETN|OTHER|DR|WARRANT/i.test(item.kind))
          ? "stock"
          : nextResults.some((item) => /ETF/i.test(item.kind) && !/ETN/i.test(item.kind))
            ? "etf"
            : nextResults.some((item) => /ETN/i.test(item.kind))
              ? "etn"
              : "other",
      );
      if (!nextResults.length) setSearchError("해당 자산군에서 일치하는 종목을 찾지 못했습니다.");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "검색에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  };

  const addInstrument = (instrument: Instrument) => {
    setSelected((current) => {
      if (current.some((item) => item.assetClass === activeClass && item.symbol === instrument.symbol)) return current;
      const sameClassCount = current.filter((item) => item.assetClass === activeClass).length;
      return [...current, { ...instrument, assetClass: activeClass, weightWithinClass: sameClassCount === 0 ? 100 : 0 }];
    });
  };

  const selectedForClass = selected.filter((item) => item.assetClass === activeClass);
  const withinClassTotal = selectedForClass.reduce((sum, item) => sum + item.weightWithinClass, 0);
  const etnResults = results.filter((item) => /ETN/i.test(`${item.kind} ${item.name}`));
  const etfResults = results.filter((item) => !/ETN/i.test(`${item.kind} ${item.name}`) && /ETF/i.test(item.kind));
  const otherResults = results.filter((item) => /OTHER|DR|WARRANT/i.test(item.kind));
  const stockResults = results.filter((item) => !/ETF|ETN|OTHER|DR|WARRANT/i.test(`${item.kind} ${item.name}`));
  const visibleResults = resultType === "stock" ? stockResults : resultType === "etf" ? etfResults : resultType === "etn" ? etnResults : otherResults;
  const previewRows = selected
    .filter((item) => allocation[item.assetClass] > 0)
    .map((item) => ({
      ...item,
      totalWeight: allocation[item.assetClass] * item.weightWithinClass / 100,
      amountWon: investableWon * allocation[item.assetClass] * item.weightWithinClass / 10_000,
    }));
  const representedWeight = allocation.cash + previewRows.reduce((sum, item) => sum + item.totalWeight, 0);
  const instrumentAllocationComplete = ASSET_CLASSES
    .filter((item) => item.searchable && allocation[item.id] > 0)
    .every((item) => {
      const items = selected.filter((selectedItem) => selectedItem.assetClass === item.id);
      return items.length > 0 && Math.abs(items.reduce((sum, selectedItem) => sum + selectedItem.weightWithinClass, 0) - 100) < 0.001;
    });

  return (
    <section className="space-y-5 overflow-hidden rounded-2xl border border-[#1428A0]/15 bg-gradient-to-b from-[#F7F9FF] to-white p-4 shadow-sm md:p-5">
      <div className="rounded-2xl bg-gradient-to-r from-[#071B4A] via-[#102B6B] to-[#1428A0] p-5 text-white shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">PB manual allocation workspace</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Portfolio Customizing</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-blue-100">PB가 고객의 기존 보유자산을 확인하고 자산군 비중과 편입 종목을 직접 설계합니다.</p>
          </div>
          <div className={`min-w-[210px] rounded-xl border px-4 py-3 ${isComplete ? "border-emerald-300/50 bg-emerald-400/15" : "border-amber-300/50 bg-amber-300/10"}`}>
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-[10px] font-bold text-blue-100">배분 합계</p><p className="mt-1 text-3xl font-black">{total.toFixed(1)}%</p></div>
              <span className={`mb-1 rounded-full px-2 py-1 text-[10px] font-black ${isComplete ? "bg-emerald-300 text-emerald-950" : "bg-amber-300 text-amber-950"}`}>{isComplete ? "배분 완료" : `${remainingPct > 0 ? "잔여" : "초과"} ${Math.abs(remainingPct).toFixed(1)}%`}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className={`h-full rounded-full ${total > 100 ? "bg-rose-400" : isComplete ? "bg-emerald-300" : "bg-amber-300"}`} style={{ width: `${Math.min(total, 100)}%` }} /></div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">투자가능자산</p><p className="mt-0.5 text-sm font-black">{formatWon(investableWon)}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">현재 배분금액</p><p className="mt-0.5 text-sm font-black">{formatWon(allocatedWon)}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">잔여·초과금액</p><p className={`mt-0.5 text-sm font-black ${remainingWon < 0 ? "text-rose-300" : "text-white"}`}>{remainingWon < 0 ? "-" : ""}{formatWon(Math.abs(remainingWon))}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">부동산 운용 제외</p><p className="mt-0.5 text-sm font-black">{formatWon(realEstateWon)}</p></div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black text-blue-900">상담 기본정보의 기존 보유자산 반영</p>
            <p className="mt-0.5 text-[11px] text-blue-700">투자가능자산 {formatWon(investableWon)} 기준 · 부동산 {formatWon(realEstateWon)} 제외</p>
          </div>
          {loadingHoldings ? <span className="text-[11px] text-blue-600">보유자산 시세 확인 중…</span> : existing.length > 0 && <button type="button" onClick={applyExistingHoldings} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50">기존 보유비중으로 초기화</button>}
        </div>
        {!loadingHoldings && existing.length === 0 ? (
          <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-fg-muted">기본정보에 저장된 보유주식이 없습니다.</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(["domesticEquity", "globalEquity"] as const).map((assetClass) => (
              <div key={assetClass} className="rounded-lg border border-blue-100 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-fg">기존 {assetClass === "domesticEquity" ? "국내주식" : "해외주식"}</p>
                  <span className="text-xs font-black text-[#1428A0]">
                    {formatWon(existingByClass[assetClass])} · {investableWon > 0 ? ((existingByClass[assetClass] / investableWon) * 100).toFixed(1) : "0.0"}%
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-fg-muted">
                  {existing.filter((row) => row.assetClass === assetClass).map((row) => row.name).join(" · ") || "보유 없음"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black text-fg">입력 기준</p>
          <p className="mt-0.5 text-[10px] text-fg-muted">두 방식은 실시간으로 자동 환산됩니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
            <button type="button" onClick={() => setInputMode("percent")} className={`rounded-md px-4 py-1.5 text-xs font-black transition ${inputMode === "percent" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>퍼센티지 %</button>
            <button type="button" onClick={() => setInputMode("amount")} disabled={investableWon <= 0} className={`rounded-md px-4 py-1.5 text-xs font-black transition disabled:opacity-40 ${inputMode === "amount" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>금액 억원</button>
          </div>
          <button type="button" onClick={fillRemainingWithCash} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100">잔여분을 현금성으로 채우기</button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSET_CLASSES.map((item) => {
          const existingPct = item.id === "domesticEquity" || item.id === "globalEquity"
            ? (investableWon > 0 ? (existingByClass[item.id] / investableWon) * 100 : 0)
            : 0;
          const belowExisting = existingPct > allocation[item.id] + 0.05;
          return (
            <label key={item.id} className={`group rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${belowExisting ? "border-amber-300 bg-amber-50" : "border-border bg-white hover:border-[#1428A0]/30"}`}>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-black text-fg">{item.label}</span>
                  <span className="block text-[10px] text-fg-muted">{item.description}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max={inputMode === "percent" ? 100 : investableWon / 100_000_000}
                    step="0.1"
                    value={inputMode === "percent" ? Number(allocation[item.id].toFixed(2)) : Number((investableWon * allocation[item.id] / 100 / 100_000_000).toFixed(2))}
                    onChange={(event) => inputMode === "percent" ? updateAllocation(item.id, Number(event.target.value)) : updateAllocationAmount(item.id, Number(event.target.value))}
                    className="w-24 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-right text-lg font-black text-fg outline-none transition focus:border-[#1428A0] focus:bg-white focus:ring-2 focus:ring-[#1428A0]/10"
                  />
                  <span className="min-w-7 text-xs font-bold text-fg-muted">{inputMode === "percent" ? "%" : "억원"}</span>
                </span>
              </span>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-gradient-to-r from-[#1428A0] to-[#4F67E8]" style={{ width: `${Math.min(allocation[item.id], 100)}%` }} /></span>
              <span className="mt-2 flex items-center justify-between text-[10px] text-fg-muted"><span>{inputMode === "percent" ? formatWon(investableWon * allocation[item.id] / 100) : `${allocation[item.id].toFixed(2)}%`}</span><span>전체 투자가능자산 기준</span></span>
              {belowExisting && <span className="mt-2 block text-[10px] font-bold text-amber-700">기존 보유 {existingPct.toFixed(1)}%보다 낮음 — 매도 필요분 확인</span>}
            </label>
          );
        })}
      </div>

      <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div><p className={`text-sm font-black ${isComplete ? "text-emerald-800" : "text-amber-800"}`}>{isComplete ? "100% 배분이 완료되었습니다." : remainingPct > 0 ? `${remainingPct.toFixed(1)}% (${formatWon(Math.max(0, remainingWon))})를 더 배분하세요.` : `${Math.abs(remainingPct).toFixed(1)}% (${formatWon(Math.abs(remainingWon))})가 초과되었습니다.`}</p><p className="mt-0.5 text-[10px] text-fg-muted">{savedAt ? `마지막 저장 ${new Date(savedAt).toLocaleString("ko-KR")}` : "아직 저장되지 않은 초안입니다."}</p></div>
        <button type="button" onClick={save} disabled={!isComplete} className="btn-primary px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">배분 확정 저장</button>
      </div>

      {isComplete && (
        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <p className="decision-kicker">Instrument selection</p>
            <h3 className="mt-1 text-base font-black text-fg">자산군별 종목 검색·선택</h3>
            <p className="mt-1 text-[11px] text-fg-muted">국내는 Naver Finance, 해외는 Yahoo Finance에서 현재가와 종목 정보를 조회합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ASSET_CLASSES.filter((item) => item.searchable && allocation[item.id] > 0).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setActiveClass(item.id); setResults([]); setSearchError(""); setResultType("stock"); }}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${activeClass === item.id ? "border-[#1428A0] bg-[#1428A0] text-white" : "border-border bg-white text-fg-muted"}`}
              >
                {item.label} {allocation[item.id]}%
              </button>
            ))}
          </div>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">국내 상장 ETF도 실제 노출 자산군에서 검색합니다. 예: KODEX 200은 국내주식, KODEX 미국S&amp;P500은 해외주식, 국채 ETF는 채권, 골드·원유 ETF는 상품·대체.</p>

          {allocation[activeClass] > 0 && activeClass !== "cash" && (
            <>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") search(); }}
                  placeholder={activeClass.startsWith("domestic") ? "종목명 또는 코드 검색" : "영문 종목명 또는 티커 검색"}
                  className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-[#1428A0]"
                />
                <button type="button" onClick={search} disabled={searching || !query.trim()} className="btn-primary px-4 py-2 text-sm disabled:opacity-40">{searching ? "검색 중…" : "실시간 검색"}</button>
              </div>
              {searchError && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{searchError}</p>}
              {results.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-border">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setResultType("stock")} className={`border-b-2 px-4 py-2 text-xs font-black transition ${resultType === "stock" ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>개별종목 <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">{stockResults.length}</span></button>
                      <button type="button" onClick={() => setResultType("etf")} className={`border-b-2 px-4 py-2 text-xs font-black transition ${resultType === "etf" ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>ETF <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">{etfResults.length}</span></button>
                      <button type="button" onClick={() => setResultType("etn")} className={`border-b-2 px-4 py-2 text-xs font-black transition ${resultType === "etn" ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>ETN <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">{etnResults.length}</span></button>
                      <button type="button" onClick={() => setResultType("other")} className={`border-b-2 px-4 py-2 text-xs font-black transition ${resultType === "other" ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>기타상품 <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px]">{otherResults.length}</span></button>
                    </div>
                    <span className="text-[10px] text-fg-muted">총 {results.length}개</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                  {visibleResults.map((item) => (
                    <button key={item.symbol} type="button" onClick={() => addInstrument(item)} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-white p-3 text-left hover:border-[#1428A0]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-fg">{item.name}</span>
                        <span className="mt-0.5 block text-[10px] text-fg-muted">{item.symbol} · {item.exchange} · {item.source}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-xs font-black text-fg">{formatPrice(item.price, item.currency)}</span>
                        <span className={`block text-[10px] ${(item.changePct ?? 0) >= 0 ? "text-rose-600" : "text-blue-600"}`}>{item.changePct == null ? "" : `${item.changePct >= 0 ? "+" : ""}${item.changePct.toFixed(2)}%`}</span>
                      </span>
                    </button>
                  ))}
                  </div>
                  {visibleResults.length === 0 && <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-8 text-center"><p className="text-xs font-bold text-fg-muted">이 탭에 해당하는 검색 결과가 없습니다.</p></div>}
                </div>
              )}

              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-fg">선택 종목 · 자산군 내 비중</p>
                  <span className={`text-xs font-black ${withinClassTotal === 100 || selectedForClass.length === 0 ? "text-emerald-700" : "text-amber-700"}`}>{withinClassTotal}% / 100%</span>
                </div>
                {selectedForClass.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-muted">검색 결과에서 편입할 종목을 선택하세요.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedForClass.map((item) => (
                      <div key={`${item.assetClass}-${item.symbol}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-3 py-2">
                        <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-fg">{item.name}</p><p className="text-[10px] text-fg-muted">{item.symbol}</p></div>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.weightWithinClass}
                          onChange={(event) => setSelected((current) => current.map((candidate) => candidate.assetClass === item.assetClass && candidate.symbol === item.symbol ? { ...candidate, weightWithinClass: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } : candidate))}
                          className="w-16 rounded border border-border px-2 py-1 text-right text-xs font-bold"
                        />
                        <span className="text-xs text-fg-muted">%</span>
                        <button type="button" onClick={() => setSelected((current) => current.filter((candidate) => !(candidate.assetClass === item.assetClass && candidate.symbol === item.symbol)))} className="text-xs font-bold text-rose-500">삭제</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {isComplete && (
        <section className="overflow-hidden rounded-2xl border border-[#1428A0]/20 bg-white shadow-sm">
          <div className="flex flex-col gap-3 bg-[#071B4A] p-5 text-white sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Custom portfolio preview</p>
              <h3 className="mt-1 text-xl font-black">선택 포트폴리오</h3>
              <p className="mt-1 text-xs text-blue-100">입력한 자산군 비중과 종목별 내부 비중을 결합한 최종 구성입니다.</p>
            </div>
            <div className={`rounded-xl border px-4 py-2 text-right ${instrumentAllocationComplete ? "border-emerald-300/40 bg-emerald-400/15" : "border-amber-300/40 bg-amber-300/10"}`}>
              <p className="text-[10px] text-blue-100">종목까지 반영된 비중</p>
              <p className="text-2xl font-black">{representedWeight.toFixed(2)}%</p>
              <p className={`text-[10px] font-bold ${instrumentAllocationComplete ? "text-emerald-200" : "text-amber-200"}`}>{instrumentAllocationComplete ? "종목 배분 완료" : "미선택 또는 내부 비중 확인 필요"}</p>
            </div>
          </div>

          <div className="p-4 md:p-5">
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
              {ASSET_CLASSES.filter((item) => allocation[item.id] > 0).map((item) => (
                <div key={item.id} style={{ width: `${allocation[item.id]}%`, backgroundColor: ASSET_COLORS[item.id] }} title={`${item.label} ${allocation[item.id]}%`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {ASSET_CLASSES.filter((item) => allocation[item.id] > 0).map((item) => (
                <span key={item.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-fg-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ASSET_COLORS[item.id] }} />{item.label} {allocation[item.id].toFixed(2)}%</span>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {ASSET_CLASSES.filter((item) => allocation[item.id] > 0).map((asset) => {
                const items = previewRows.filter((item) => item.assetClass === asset.id);
                const classInternalTotal = items.reduce((sum, item) => sum + item.weightWithinClass, 0);
                return (
                  <div key={asset.id} className="rounded-xl border border-border bg-surface-2 p-4">
                    <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                      <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: ASSET_COLORS[asset.id] }} /><div><p className="text-sm font-black text-fg">{asset.label}</p><p className="text-[10px] text-fg-muted">{formatWon(investableWon * allocation[asset.id] / 100)}</p></div></div>
                      <span className="text-lg font-black text-[#1428A0]">{allocation[asset.id].toFixed(2)}%</span>
                    </div>
                    {asset.id === "cash" ? (
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2"><div><p className="text-xs font-bold text-fg">현금성 자산</p><p className="text-[10px] text-fg-muted">예수금·MMF/RP 편입 전 대기자금</p></div><span className="text-xs font-black text-fg">{formatWon(investableWon * allocation.cash / 100)}</span></div>
                    ) : items.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-center"><p className="text-xs font-bold text-amber-800">편입 종목 미선택</p><p className="mt-1 text-[10px] text-amber-700">위 검색 영역에서 {asset.label} 종목 또는 ETF를 선택하세요.</p></div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {items.map((item) => (
                          <div key={`${item.assetClass}-${item.symbol}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg bg-white px-3 py-2">
                            <div className="min-w-0"><p className="truncate text-xs font-bold text-fg">{item.name}</p><p className="text-[10px] text-fg-muted">{item.symbol} · 자산군 내 {item.weightWithinClass}%</p></div>
                            <div className="text-right"><p className="text-xs font-black text-[#1428A0]">전체 {item.totalWeight.toFixed(2)}%</p><p className="text-[10px] text-fg-muted">{formatWon(item.amountWon)}</p></div>
                          </div>
                        ))}
                        {Math.abs(classInternalTotal - 100) > 0.001 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">자산군 내부 비중 {classInternalTotal}% / 100% — {Math.abs(100 - classInternalTotal).toFixed(1)}% 조정 필요</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {existing.length > 0 && <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">기존 보유주식은 국내·해외주식 자산군 비중에 반영되어 있습니다. 최종 편입 종목 구성에는 보유를 유지할 종목을 검색해 선택하세요.</p>}
          </div>
        </section>
      )}
      <PortfolioAnalyticsCards allocation={allocation} selected={selected} complete={hydrated && isComplete && instrumentAllocationComplete} />
    </section>
  );
}
