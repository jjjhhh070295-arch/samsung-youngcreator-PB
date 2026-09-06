"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import PortfolioAnalyticsCards from "./PortfolioAnalyticsCards";
import KoreanStockTrendFilter from "./advisory/KoreanStockTrendFilter";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";
import { BOND_INSTRUMENT_CATALOG, type BondCatalogEntry } from "@/lib/advisory/bondInstrumentCatalog";
import {
  mergeTrendConfirmedIntoSelected,
  redistributeAssetClassWeights,
  sameInstrument,
} from "@/lib/advisory/mergeTrendInstruments";
import { updateAllocationWithCash } from "@/lib/manualPortfolioDraft";

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

function bondEntryToInstrument(entry: BondCatalogEntry): Instrument {
  return {
    symbol: entry.symbol,
    name: entry.name,
    exchange: entry.exchange,
    currency: entry.currency,
    kind: entry.kind,
    price: null,
    changePct: null,
    asOf: null,
    source: entry.source,
  };
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

  /** Move a small slice from cash into a target class if that class is currently 0%. */
  const ensureClassActive = useCallback((assetClass: AssetClass, minPct = 5) => {
    setAllocation((current) => {
      if (current[assetClass] > 0) return current;
      const take = Math.min(minPct, Math.max(0, current.cash));
      if (take <= 0) return current;
      return {
        ...current,
        [assetClass]: Math.round(take * 100) / 100,
        cash: Math.round((current.cash - take) * 100) / 100,
      };
    });
  }, []);

  const handleTrendSelection = useCallback((stocks: PbSelectedKoreanStock[], _equityPending: boolean) => {
    if (stocks.length === 0) return;
    setSelected((current) => redistributeAssetClassWeights(mergeTrendConfirmedIntoSelected(current, stocks), "domesticEquity"));
    ensureClassActive("domesticEquity");
    setActiveClass("domesticEquity");
  }, [ensureClassActive]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(clientId));
      if (raw) {
        const parsed = JSON.parse(raw) as { allocation?: Allocation; selected?: SelectedInstrument[]; savedAt?: string };
        if (parsed.allocation) {
          const restored = { ...EMPTY_ALLOCATION, ...parsed.allocation };
          const nonCashTotal = ASSET_CLASSES
            .filter((item) => item.id !== "cash")
            .reduce((sum, item) => sum + Math.max(0, Number(restored[item.id]) || 0), 0);
          if (nonCashTotal <= 100) {
            restored.cash = Math.round((100 - nonCashTotal) * 100) / 100;
          } else {
            const scale = 100 / nonCashTotal;
            ASSET_CLASSES.filter((item) => item.id !== "cash").forEach((item) => {
              restored[item.id] = Math.round(restored[item.id] * scale * 100) / 100;
            });
            restored.cash = 0;
          }
          setAllocation(restored);
        }
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
            // 보유주식은 고정 편입으로 유지하고, 신규 배분은 남은 자산 100%에서 시작한다.
            setAllocation(EMPTY_ALLOCATION);
          }
        }
      } finally {
        if (!cancelled) setLoadingHoldings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, totalAssetWon]);

  const investableWon = Math.max(0, totalAssetWon - realEstateWon);
  const existingTotalWon = existing.reduce((sum, row) => sum + row.valueKrw, 0);
  const allocatableWon = Math.max(0, investableWon - existingTotalWon);
  const total = Object.values(allocation).reduce((sum, value) => sum + value, 0);
  const isComplete = Math.abs(total - 100) < 0.001;
  const allocatedWon = allocatableWon * total / 100;
  const remainingPct = 100 - total;
  const remainingWon = allocatableWon - allocatedWon;

  const existingByClass = useMemo(() => ({
    domesticEquity: existing.filter((row) => row.assetClass === "domesticEquity").reduce((sum, row) => sum + row.valueKrw, 0),
    globalEquity: existing.filter((row) => row.assetClass === "globalEquity").reduce((sum, row) => sum + row.valueKrw, 0),
  }), [existing]);

  const allocationScale = investableWon > 0 ? allocatableWon / investableWon : 0;
  const finalAllocation = useMemo<Allocation>(() => ({
    domesticEquity: (investableWon > 0 ? existingByClass.domesticEquity / investableWon * 100 : 0) + allocation.domesticEquity * allocationScale,
    globalEquity: (investableWon > 0 ? existingByClass.globalEquity / investableWon * 100 : 0) + allocation.globalEquity * allocationScale,
    domesticBond: allocation.domesticBond * allocationScale,
    globalBond: allocation.globalBond * allocationScale,
    alternatives: allocation.alternatives * allocationScale,
    cash: allocation.cash * allocationScale,
  }), [allocation, allocationScale, existingByClass, investableWon]);

  const save = useCallback(() => {
    const now = new Date().toISOString();
    localStorage.setItem(storageKey(clientId), JSON.stringify({
      version: 2,
      allocation,
      finalAllocation,
      selected,
      investableWon,
      allocatableWon,
      savedAt: now,
    }));
    setSavedAt(now);
  }, [allocation, allocatableWon, clientId, finalAllocation, investableWon, selected]);

  const updateAllocation = (assetClass: AssetClass, value: number) => {
    if (assetClass === "cash") return;
    setAllocation((current) => updateAllocationWithCash(current, assetClass, value));
  };

  const updateAllocationAmount = (assetClass: AssetClass, amountEok: number) => {
    const percentage = allocatableWon > 0 ? (amountEok * 100_000_000 / allocatableWon) * 100 : 0;
    updateAllocation(assetClass, Math.round(percentage * 100) / 100);
  };

  const applyExistingHoldings = () => {
    setAllocation(EMPTY_ALLOCATION);
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

  const addInstrument = (instrument: Instrument, assetClass: AssetClass = activeClass) => {
    setSelected((current) => {
      if (current.some((item) => item.assetClass === assetClass && sameInstrument(item.symbol, instrument.symbol))) {
        return current;
      }
      return redistributeAssetClassWeights([...current, { ...instrument, assetClass, weightWithinClass: 0 }], assetClass);
    });
  };

  const addBondOption = (entry: BondCatalogEntry) => {
    ensureClassActive(entry.assetClass);
    addInstrument(bondEntryToInstrument(entry), entry.assetClass);
    setActiveClass(entry.assetClass);
  };

  const classValidationWarnings = useMemo(() => {
    return ASSET_CLASSES.filter((item) => item.searchable && allocation[item.id] > 0)
      .map((item) => {
        const items = selected.filter((row) => row.assetClass === item.id);
        const sum = items.reduce((acc, row) => acc + row.weightWithinClass, 0);
        if (items.length === 0) return `${item.label} 편입 종목이 없습니다.`;
        if (Math.abs(sum - 100) >= 0.001) return `${item.label} 내 비중 합계가 100%가 아닙니다. (현재 ${sum.toFixed(1)}%)`;
        return null;
      })
      .filter((msg): msg is string => Boolean(msg));
  }, [allocation, selected]);

  const selectedForClass = selected.filter((item) => item.assetClass === activeClass);
  const withinClassTotal = selectedForClass.reduce((sum, item) => sum + item.weightWithinClass, 0);
  const etnResults = results.filter((item) => /ETN/i.test(`${item.kind} ${item.name}`));
  const etfResults = results.filter((item) => !/ETN/i.test(`${item.kind} ${item.name}`) && /ETF/i.test(item.kind));
  const otherResults = results.filter((item) => /OTHER|DR|WARRANT/i.test(item.kind));
  const stockResults = results.filter((item) => !/ETF|ETN|OTHER|DR|WARRANT/i.test(`${item.kind} ${item.name}`));
  const visibleResults = resultType === "stock" ? stockResults : resultType === "etf" ? etfResults : resultType === "etn" ? etnResults : otherResults;
  const newPreviewRows = selected
    .filter((item) => allocation[item.assetClass] > 0)
    .map((item) => ({
      ...item,
      totalWeight: allocation[item.assetClass] * allocationScale * item.weightWithinClass / 100,
      amountWon: allocatableWon * allocation[item.assetClass] * item.weightWithinClass / 10_000,
      fixed: false,
    }));
  const existingPreviewRows = existing.map((item) => ({
    symbol: item.ticker || `HOLDING-${item.id}`,
    name: item.name,
    exchange: item.market || "기존 보유",
    currency: item.currency,
    kind: "기존 보유 주식",
    price: item.avg_price,
    changePct: null,
    asOf: null,
    source: "기본정보 기존 보유",
    assetClass: item.assetClass,
    weightWithinClass: 0,
    totalWeight: investableWon > 0 ? item.valueKrw / investableWon * 100 : 0,
    amountWon: item.valueKrw,
    fixed: true,
  }));
  const previewRows = [...existingPreviewRows, ...newPreviewRows];
  const analyticsSelected = previewRows.map((item) => ({
    ...item,
    weightWithinClass: finalAllocation[item.assetClass] > 0
      ? item.totalWeight / finalAllocation[item.assetClass] * 100
      : 0,
  }));
  const representedWeight = finalAllocation.cash + previewRows.reduce((sum, item) => sum + item.totalWeight, 0);
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
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">기존 보유주식 · 고정</p><p className="mt-0.5 text-sm font-black">{formatWon(existingTotalWon)}</p></div>
            <div className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2"><p className="text-[10px] text-emerald-200">배분 가능 자산</p><p className="mt-0.5 text-sm font-black">{formatWon(allocatableWon)}</p></div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">부동산 운용 제외</p><p className="mt-0.5 text-sm font-black">{formatWon(realEstateWon)}</p></div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-black text-blue-900">상담 기본정보의 기존 보유자산 반영</p>
            <p className="mt-0.5 text-[11px] text-blue-700">기존 보유주식 {formatWon(existingTotalWon)}은 고정 유지 · 나머지 {formatWon(allocatableWon)}만 신규 배분</p>
          </div>
          {loadingHoldings ? <span className="text-[11px] text-blue-600">보유자산 시세 확인 중…</span> : existing.length > 0 && <button type="button" onClick={applyExistingHoldings} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50">신규 배분 초기화</button>}
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
          <p className="mt-0.5 text-[10px] text-fg-muted">비현금 자산을 입력하면 나머지는 현금성 자산으로 자동 배분되어 항상 100%를 유지합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
            <button type="button" onClick={() => setInputMode("percent")} className={`rounded-md px-4 py-1.5 text-xs font-black transition ${inputMode === "percent" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>퍼센티지 %</button>
            <button type="button" onClick={() => setInputMode("amount")} disabled={allocatableWon <= 0} className={`rounded-md px-4 py-1.5 text-xs font-black transition disabled:opacity-40 ${inputMode === "amount" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>금액 억원</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSET_CLASSES.map((item) => {
          return (
            <label key={item.id} className={`group rounded-xl border p-4 transition ${item.id === "cash" ? "border-emerald-200 bg-emerald-50" : "border-border bg-white hover:-translate-y-0.5 hover:border-[#1428A0]/30 hover:shadow-sm"}`}>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-black text-fg">{item.label}</span>
                  <span className="block text-[10px] text-fg-muted">{item.description}</span>
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max={inputMode === "percent" ? 100 : allocatableWon / 100_000_000}
                    step="0.1"
                    value={inputMode === "percent" ? Number(allocation[item.id].toFixed(2)) : Number((allocatableWon * allocation[item.id] / 100 / 100_000_000).toFixed(2))}
                    onChange={(event) => inputMode === "percent" ? updateAllocation(item.id, Number(event.target.value)) : updateAllocationAmount(item.id, Number(event.target.value))}
                    disabled={item.id === "cash"}
                    className="w-24 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-right text-lg font-black text-fg outline-none transition focus:border-[#1428A0] focus:bg-white focus:ring-2 focus:ring-[#1428A0]/10"
                  />
                  <span className="min-w-7 text-xs font-bold text-fg-muted">{inputMode === "percent" ? "%" : "억원"}</span>
                </span>
              </span>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-gradient-to-r from-[#1428A0] to-[#4F67E8]" style={{ width: `${Math.min(allocation[item.id], 100)}%` }} /></span>
              <span className="mt-2 flex items-center justify-between text-[10px] text-fg-muted"><span>{inputMode === "percent" ? formatWon(allocatableWon * allocation[item.id] / 100) : `${allocation[item.id].toFixed(2)}%`}</span><span>{item.id === "cash" ? "자동 계산" : "배분 가능 자산 기준"}</span></span>
            </label>
          );
        })}
      </div>

      <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isComplete ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
        <div><p className={`text-sm font-black ${isComplete ? "text-emerald-800" : "text-amber-800"}`}>{isComplete ? "100% 배분이 완료되었습니다." : remainingPct > 0 ? `${remainingPct.toFixed(1)}% (${formatWon(Math.max(0, remainingWon))})를 더 배분하세요.` : `${Math.abs(remainingPct).toFixed(1)}% (${formatWon(Math.abs(remainingWon))})가 초과되었습니다.`}</p><p className="mt-0.5 text-[10px] text-fg-muted">{savedAt ? `마지막 저장 ${new Date(savedAt).toLocaleString("ko-KR")}` : "아직 저장되지 않은 초안입니다."}</p></div>
        <button type="button" onClick={save} disabled={!isComplete || loadingHoldings} className="btn-primary px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40">{loadingHoldings ? "보유자산 확인 중…" : "배분 확정 저장"}</button>
      </div>

      {isComplete && (
        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <p className="decision-kicker">Instrument selection</p>
            <h3 className="mt-1 text-base font-black text-fg">자산군별 종목 검색·선택</h3>
            <p className="mt-1 text-[11px] text-fg-muted">
              직접 검색으로 편입 종목을 고르고 자산군 내 비중을 입력합니다. 추세 필터·대표 채권은 아래 별도 섹션에서 추가할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ASSET_CLASSES.filter((item) => item.searchable && allocation[item.id] > 0).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveClass(item.id);
                  setResults([]);
                  setSearchError("");
                  setResultType("stock");
                }}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold ${activeClass === item.id ? "border-[#1428A0] bg-[#1428A0] text-white" : "border-border bg-white text-fg-muted"}`}
              >
                {item.label} {allocation[item.id]}%
              </button>
            ))}
          </div>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">
            국내 상장 ETF도 실제 노출 자산군에서 검색합니다. 예: KODEX 200은 국내주식, KODEX 미국S&amp;P500은 해외주식, 국채 ETF는 채권, 골드·원유 ETF는 상품·대체.
          </p>

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
                  <p className="mt-2 text-xs text-fg-muted">
                    직접 검색, 아래 추세 필터 확정, 또는 대표 채권 선택으로 편입 종목을 추가하세요.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedForClass.map((item) => (
                      <div key={`${item.assetClass}-${item.symbol}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-fg">{item.name}</p>
                          <p className="text-[10px] text-fg-muted">
                            {item.symbol}
                            {item.price != null ? ` · ${formatPrice(item.price, item.currency)}` : ""}
                            {item.source ? ` · ${item.source}` : ""}
                            {item.asOf ? ` · as-of ${item.asOf.slice(0, 10)}` : ""}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.weightWithinClass}
                          onChange={(event) => setSelected((current) => current.map((candidate) => candidate.assetClass === item.assetClass && candidate.symbol === item.symbol ? { ...candidate, weightWithinClass: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } : candidate))}
                          className="w-16 rounded border border-border px-2 py-1 text-right text-xs font-bold"
                        />
                        <span className="text-xs text-fg-muted">%</span>
                        <button type="button" onClick={() => setSelected((current) => redistributeAssetClassWeights(current.filter((candidate) => !(candidate.assetClass === item.assetClass && candidate.symbol === item.symbol)), item.assetClass))} className="text-xs font-bold text-rose-500">삭제</button>
                      </div>
                    ))}
                    {Math.abs(withinClassTotal - 100) >= 0.001 && (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">
                        {ASSET_CLASSES.find((a) => a.id === activeClass)?.label} 내 비중 합계가 100%가 아닙니다. (현재 {withinClassTotal.toFixed(1)}%)
                      </p>
                    )}
                  </div>
                )}
              </div>

              {classValidationWarnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {classValidationWarnings.map((msg) => (
                    <p key={msg} className="font-semibold">{msg}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {isComplete && (
        <div className="space-y-3 border-t border-border pt-4">
          <KoreanStockTrendFilter
            clientId={clientId}
            equityWeightPct={allocation.domesticEquity}
            onSelectionChange={handleTrendSelection}
          />
        </div>
      )}

      {isComplete && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#1428A0]">Bond selection</p>
            <h3 className="mt-1 text-base font-bold text-fg">대표 채권 선택</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              주요 채권형 상품을 선택하면 선택 종목과 포트폴리오에 반영됩니다.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {BOND_INSTRUMENT_CATALOG.map((entry) => {
                const already = selected.some(
                  (item) => item.assetClass === entry.assetClass && sameInstrument(item.symbol, entry.symbol),
                );
                const classLabel = entry.assetClass === "globalBond" ? "해외채권" : "국내채권";
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={already}
                    onClick={() => addBondOption(entry)}
                    className={`rounded-xl border p-3 text-left transition ${already ? "border-emerald-200 bg-emerald-50 opacity-80" : "border-border bg-surface-2 hover:border-[#1428A0] hover:bg-white"}`}
                  >
                    <span className="block text-xs font-black text-[#1428A0]">{entry.label}</span>
                    <span className="mt-0.5 block text-sm font-bold text-fg">{entry.name}</span>
                    <span className="mt-1 block text-[10px] text-fg-muted">
                      {classLabel} · {entry.kind}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-fg-muted">{entry.note}</span>
                    <span className={`mt-2 inline-block text-[10px] font-bold ${already ? "text-emerald-700" : "text-fg-muted"}`}>
                      {already ? "선택됨" : "선택 종목에 추가"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
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
              {ASSET_CLASSES.filter((item) => finalAllocation[item.id] > 0).map((item) => (
                <div key={item.id} style={{ width: `${finalAllocation[item.id]}%`, backgroundColor: ASSET_COLORS[item.id] }} title={`${item.label} ${finalAllocation[item.id]}%`} />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {ASSET_CLASSES.filter((item) => finalAllocation[item.id] > 0).map((item) => (
                <span key={item.id} className="flex items-center gap-1.5 text-[10px] font-semibold text-fg-muted"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ASSET_COLORS[item.id] }} />{item.label} {finalAllocation[item.id].toFixed(2)}%</span>
              ))}
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {ASSET_CLASSES.filter((item) => finalAllocation[item.id] > 0).map((asset) => {
                const items = previewRows.filter((item) => item.assetClass === asset.id);
                const classInternalTotal = allocation[asset.id] <= 0
                  ? 100
                  : items.filter((item) => !item.fixed).reduce((sum, item) => sum + item.weightWithinClass, 0);
                return (
                  <div key={asset.id} className="rounded-xl border border-border bg-surface-2 p-4">
                    <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                      <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: ASSET_COLORS[asset.id] }} /><div><p className="text-sm font-black text-fg">{asset.label}</p><p className="text-[10px] text-fg-muted">{formatWon(investableWon * finalAllocation[asset.id] / 100)}</p></div></div>
                      <span className="text-lg font-black text-[#1428A0]">{finalAllocation[asset.id].toFixed(2)}%</span>
                    </div>
                    {asset.id === "cash" ? (
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2"><div><p className="text-xs font-bold text-fg">현금성 자산</p><p className="text-[10px] text-fg-muted">비현금 신규 배분 후 자동 잔여금</p></div><span className="text-xs font-black text-fg">{formatWon(investableWon * finalAllocation.cash / 100)}</span></div>
                    ) : items.length === 0 ? (
                      <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-4 text-center"><p className="text-xs font-bold text-amber-800">편입 종목 미선택</p><p className="mt-1 text-[10px] text-amber-700">검색·추세 필터·대표 채권에서 {asset.label} 종목을 선택하세요.</p></div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {items.map((item) => (
                          <div key={`${item.fixed ? "fixed" : "new"}-${item.assetClass}-${item.symbol}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg bg-white px-3 py-2">
                            <div className="min-w-0"><p className="truncate text-xs font-bold text-fg">{item.name}({item.symbol}) {item.fixed ? <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">기존 보유 · 고정</span> : null}</p><p className="text-[10px] text-fg-muted">{item.fixed ? "기본정보에서 자동 반영" : `신규 배분 자산군 내 ${item.weightWithinClass}%`}{item.source ? ` · ${item.source}` : ""}</p></div>
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

            {existing.length > 0 && <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">기존 보유주식은 기본정보에서 고정 편입되며, 별도로 다시 검색하거나 선택하지 않아도 최종 구성과 분석에 계속 반영됩니다.</p>}
          </div>
        </section>
      )}
      <PortfolioAnalyticsCards key={clientId} allocation={finalAllocation} selected={analyticsSelected} complete={hydrated && !loadingHoldings && isComplete && instrumentAllocationComplete} />
    </section>
  );
}
