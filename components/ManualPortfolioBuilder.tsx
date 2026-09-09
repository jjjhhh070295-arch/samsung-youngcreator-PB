"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { supabase } from "@/lib/supabase";
import PortfolioAnalyticsCards from "./PortfolioAnalyticsCards";
import KoreanStockTrendFilter from "./advisory/KoreanStockTrendFilter";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";
import { BOND_INSTRUMENT_CATALOG, type BondCatalogEntry } from "@/lib/advisory/bondInstrumentCatalog";
import {
  mergePortfolioPreviewRows,
  mergeTrendConfirmedIntoSelected,
  redistributeAssetClassWeights,
  sameInstrument,
  type PortfolioPreviewRow,
} from "@/lib/advisory/mergeTrendInstruments";
import {
  allocationExcessPctPoints,
  isAllocationTotalExact100,
  remainingPctForFinalTarget,
  updateAllocationWithCash,
} from "@/lib/manualPortfolioDraft";
import type { ManualPortfolioDraft } from "@/lib/manualPortfolioDraft";
import { getPortfolioDraft, savePortfolioDraft } from "@/lib/store";
import { floorToIncrement, requiresMarketQuote } from "@/lib/advisory/ipsPurchasePlan";
import { findQuoteBySymbol } from "@/lib/pricing/instrumentIdentity";
import type { PriceQuote } from "@/lib/pricing/types";
import type { PortfolioAnalyticsSnapshot } from "@/lib/returnAssumptions";
import { WON_PER_MANWON } from "@/lib/moneyManwon";

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

type SelectedInstrument = Instrument & {
  assetClass: AssetClass;
  weightWithinClass: number;
  designatedPrice?: number | null;
  quotationKind?: "share" | "bond_face" | "unit";
  quantityIncrement?: number;
  faceValue?: number | null;
  fxRate?: number | null;
  plannedQuantity?: number | null;
};

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

import MoneyManwonInput from "@/components/MoneyManwonInput";
import type { PortfolioWorkflowStep } from "@/lib/portfolioWorkflowStep";

export type ManualPortfolioBuilderProps = {
  pbId: string;
  clientId: string;
  totalAssetWon: number;
  onDraftChanged?: () => void;
  /** UI 페이지만 — 마운트 유지하면서 섹션 표시 전환 */
  step?: PortfolioWorkflowStep;
  onNavigateStep?: (step: PortfolioWorkflowStep) => void;
};

export default function ManualPortfolioBuilder({
  pbId,
  clientId,
  totalAssetWon,
  onDraftChanged,
  step = "allocation",
  onNavigateStep,
}: ManualPortfolioBuilderProps) {
  const [allocation, setAllocation] = useState<Allocation>(EMPTY_ALLOCATION);
  const [selected, setSelected] = useState<SelectedInstrument[]>([]);
  const [existing, setExisting] = useState<ExistingHolding[]>([]);
  const [realEstateWon, setRealEstateWon] = useState(0);
  const [loadingHoldings, setLoadingHoldings] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const hasDraftRef = useRef(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<"db" | "local" | null>(null);
  const [saving, setSaving] = useState(false);
  const [trendChecked, setTrendChecked] = useState<string[]>([]);
  const [trendConfirmed, setTrendConfirmed] = useState<PbSelectedKoreanStock[]>([]);
  const [inputMode, setInputMode] = useState<"percent" | "amount">("percent");
  const [allocationInputDrafts, setAllocationInputDrafts] = useState<Partial<Record<AssetClass, string>>>({});
  const [activeClass, setActiveClass] = useState<AssetClass>("domesticEquity");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [resultType, setResultType] = useState<"stock" | "etf" | "etn" | "other">("stock");
  const [liveQuotes, setLiveQuotes] = useState<PriceQuote[]>([]);
  const [quoteFx, setQuoteFx] = useState(1350);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState<PortfolioAnalyticsSnapshot | null>(null);
  const allocationWarningRef = useRef<HTMLDivElement | null>(null);

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

  const handleTrendCheckedConfirmedChange = useCallback((nextChecked: string[], nextConfirmed: PbSelectedKoreanStock[]) => {
    setTrendChecked(nextChecked);
    setTrendConfirmed(nextConfirmed);
  }, []);

  // DB(portfolio_drafts) 우선 복원, 마이그레이션 미실행·오프라인이면 localStorage로 폴백.
  // DB에 값이 있으면 그 값이 최신이라고 보고 로컬 캐시도 그 값으로 맞춘다(store.ts에서 처리).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { draft, source } = await getPortfolioDraft(pbId, clientId);
      if (cancelled) return;
      if (draft?.allocation) {
        const restored = { ...EMPTY_ALLOCATION, ...draft.allocation } as Allocation;
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
      if (draft && Array.isArray(draft.selected)) setSelected(draft.selected as SelectedInstrument[]);
      if (draft?.savedAt) setSavedAt(draft.savedAt);
      if (draft?.trendChecked) setTrendChecked(draft.trendChecked);
      if (draft?.trendConfirmed) setTrendConfirmed(draft.trendConfirmed);
      if (draft?.analyticsSnapshot) setAnalyticsSnapshot(draft.analyticsSnapshot);
      setSavedTo(draft ? source : null);
      hasDraftRef.current = Boolean(draft);
      setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, [clientId, pbId]);

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
          if (!hasDraftRef.current) {
            // 보유주식은 고정 편입으로 유지하고, 신규 배분은 남은 자산 100%에서 시작한다.
            // hasDraftRef: DB/로컬 초안 복원(비동기)이 이 효과보다 늦게 끝나도 마지막에 실행되는
            // 쪽이 최종 상태를 결정하므로(복원이 끝나면 항상 restored 값으로 덮어씀) 순서 무관 안전하다.
            setAllocation(EMPTY_ALLOCATION);
          }
        }
      } finally {
        if (!cancelled) setLoadingHoldings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, totalAssetWon]);

  // 투자가능자산 = AUM 그대로. 부동산을 빼지 않는다.
  //   2026-09-08 자산 모델 변경(lib/assets.ts) 이후 totalAssetWon 으로 넘어오는
  //   client.assetSize 는 그 자체로 AUM(운용자산)이고 부동산은 AUM 밖에 따로 얹히는
  //   값이다. 예전 모델에서는 assetSize 가 "부동산 포함 총자산"이라 여기서 부동산을
  //   빼 투자가능자산을 역산했는데, 지금 그렇게 하면 이미 부동산이 빠져 있는 값에서
  //   한 번 더 빼는 이중 차감이 된다(이기량: 350억 → 279.8억, 부동산 70.2억만큼 과소).
  //   이 값은 아래 allocatableWon 을 거쳐 초안에 저장되고 IPS 확정 시 매수 예산으로
  //   쓰이므로, 표시만이 아니라 실제 배분 금액이 어긋난다.
  //   realEstateWon 은 아래 "부동산 (AUM 별도)" 카드에서 금액 표시로만 쓴다.
  const investableWon = Math.max(0, totalAssetWon);
  const existingTotalWon = existing.reduce((sum, row) => sum + row.valueKrw, 0);
  const allocatableWon = Math.max(0, investableWon - existingTotalWon);

  // 편입 종목 KIS 현재가 미리보기 — 확정 시와 동일 /api/prices 경로(검색가·지정가 미사용)
  useEffect(() => {
    const need = selected.filter((row) => requiresMarketQuote(row));
    if (need.length === 0) {
      setLiveQuotes([]);
      setQuotesError(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setQuotesLoading(true);
      setQuotesError(null);
      try {
        const res = await fetch("/api/prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tickers: need.map((row) => ({
              ticker: row.symbol,
              currency: (row.currency === "USD" ? "USD" : "KRW") as "KRW" | "USD",
            })),
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (Number(json.fxUsdKrw) > 0) setQuoteFx(Number(json.fxUsdKrw));
        setLiveQuotes(Array.isArray(json.quotes) ? json.quotes : []);
        if (!json.connected) setQuotesError("KIS 시세 미연결 — 확정 전 연결이 필요합니다.");
      } catch (e: any) {
        if (!cancelled) setQuotesError(e?.message || "시세 조회 실패");
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selected]);

  const total = Object.values(allocation).reduce((sum, value) => sum + value, 0);
  const isComplete = isAllocationTotalExact100(allocation);
  const overAllocated = total > 100 + 0.001;
  const excessPctPoints = allocationExcessPctPoints(allocation);
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
  const finalTotal = Object.values(finalAllocation).reduce((sum, value) => sum + value, 0);

  const save = useCallback(async (): Promise<boolean> => {
    if (!isAllocationTotalExact100(allocation)) {
      const excess = allocationExcessPctPoints(allocation);
      const msg =
        excess > 0
          ? `자산배분 합계가 100%를 ${excess.toFixed(1)}%p 초과했습니다. 배분 확정 저장 전에 100%로 조정해 주세요.`
          : `자산배분 합계가 100%가 아닙니다. (현재 ${Object.values(allocation).reduce((s, v) => s + v, 0).toFixed(1)}%)`;
      setSaveError(msg);
      allocationWarningRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    setSaveError(null);
    const now = new Date().toISOString();
    const draft: ManualPortfolioDraft = {
      version: 2,
      allocation,
      finalAllocation,
      selected,
      investableWon,
      allocatableWon,
      trendChecked,
      trendConfirmed,
      savedAt: now,
      ...(analyticsSnapshot ? { analyticsSnapshot } : {}),
    };
    setSaving(true);
    try {
      const { source } = await savePortfolioDraft(pbId, clientId, draft);
      hasDraftRef.current = true;
      setSavedAt(now);
      setSavedTo(source);
      onDraftChanged?.();
      return true;
    } catch (e: any) {
      setSaveError(e?.message ? `저장 실패: ${e.message}` : "저장에 실패했습니다. 다시 시도해 주세요.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [allocation, allocatableWon, analyticsSnapshot, clientId, finalAllocation, investableWon, onDraftChanged, pbId, selected, trendChecked, trendConfirmed]);

  const confirmInstruments = useCallback(async (): Promise<boolean> => {
    if (!isAllocationTotalExact100(allocation)) {
      setSaveError("자산배분 합계가 100%가 아닙니다. 자산배분 단계에서 조정해 주세요.");
      return false;
    }
    const warnings = ASSET_CLASSES.filter((item) => item.searchable && allocation[item.id] > 0)
      .map((item) => {
        const items = selected.filter((row) => row.assetClass === item.id);
        const sum = items.reduce((acc, row) => acc + row.weightWithinClass, 0);
        if (items.length === 0) return `${item.label} 편입 종목이 없습니다.`;
        if (Math.abs(sum - 100) >= 0.001) {
          return `${item.label} 내 비중 합계가 100%가 아닙니다. (현재 ${sum.toFixed(1)}%)`;
        }
        return null;
      })
      .filter((msg): msg is string => Boolean(msg));
    if (warnings.length) {
      setSaveError(warnings.join("\n"));
      return false;
    }
    return save();
  }, [allocation, save, selected]);

  const updateAllocation = (assetClass: AssetClass, value: number) => {
    if (assetClass === "cash") return;
    setAllocation((current) => updateAllocationWithCash(current, assetClass, value));
  };

  const fixedPctForClass = (assetClass: AssetClass) => {
    if (assetClass === "domesticEquity") return investableWon > 0 ? existingByClass.domesticEquity / investableWon * 100 : 0;
    if (assetClass === "globalEquity") return investableWon > 0 ? existingByClass.globalEquity / investableWon * 100 : 0;
    return 0;
  };

  /** 전체 포트폴리오 목표 비중을 남은 배분 가능 자산 기준 내부 비중으로 변환한다. */
  const updateFinalAllocation = (assetClass: AssetClass, finalPct: number) => {
    if (assetClass === "cash" || allocationScale <= 0) return;
    const fixedPct = fixedPctForClass(assetClass);
    const remainingAssetPct = remainingPctForFinalTarget(finalPct, fixedPct, allocationScale);
    updateAllocation(assetClass, Math.round(remainingAssetPct * 100) / 100);
  };

  const updateFinalAllocationAmount = (assetClass: AssetClass, amountManwon: number) => {
    const finalPct = investableWon > 0 ? ((amountManwon * WON_PER_MANWON) / investableWon) * 100 : 0;
    updateFinalAllocation(assetClass, finalPct);
  };

  const commitAllocationInput = (assetClass: AssetClass, rawValue: string) => {
    const value = Number(rawValue);
    if (rawValue.trim() !== "" && Number.isFinite(value)) {
      if (inputMode === "percent") updateFinalAllocation(assetClass, value);
      else updateFinalAllocationAmount(assetClass, value);
    }
    setAllocationInputDrafts((current) => {
      const next = { ...current };
      delete next[assetClass];
      return next;
    });
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
      const quotationKind: SelectedInstrument["quotationKind"] =
        assetClass === "domesticBond" || assetClass === "globalBond"
          ? /ETF|ETN/i.test(instrument.kind)
            ? "share"
            : "bond_face"
          : assetClass === "alternatives" && /WRAP|TRUST|ELS|ELB/i.test(instrument.kind)
            ? "unit"
            : "share";
      return redistributeAssetClassWeights(
        [
          ...current,
          {
            ...instrument,
            assetClass,
            weightWithinClass: 0,
            designatedPrice: null,
            quotationKind,
            quantityIncrement: quotationKind === "share" ? 1 : quotationKind === "bond_face" ? 1 : 0.0001,
            faceValue: quotationKind === "bond_face" ? 10_000 : null,
            fxRate: instrument.currency === "USD" ? null : 1,
            plannedQuantity: null,
          },
        ],
        assetClass,
      );
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
  const newPreviewRows: PortfolioPreviewRow[] = selected
    .filter((item) => allocation[item.assetClass] > 0)
    .map((item) => ({
      ...item,
      totalWeight: allocation[item.assetClass] * allocationScale * item.weightWithinClass / 100,
      amountWon: allocatableWon * allocation[item.assetClass] * item.weightWithinClass / 10_000,
      fixed: false,
      hasExisting: false,
      hasNew: true,
      fixedAmountWon: 0,
      newAmountWon: allocatableWon * allocation[item.assetClass] * item.weightWithinClass / 10_000,
      newWeightWithinClass: item.weightWithinClass,
    }));
  const existingPreviewRows: PortfolioPreviewRow[] = existing.map((item) => ({
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
    hasExisting: true,
    hasNew: false,
    fixedAmountWon: item.valueKrw,
    newAmountWon: 0,
    newWeightWithinClass: 0,
  }));
  const previewRows = mergePortfolioPreviewRows([...existingPreviewRows, ...newPreviewRows]);
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

  // 딥링크·새로고침으로 후속 단계 URL을 열면, 초안 복원 후 접근 가능 여부를 판정한다.
  // 저장/승인은 하지 않고 안내 후 이전 단계로만 되돌린다.
  useEffect(() => {
    if (!hydrated || loadingHoldings || !onNavigateStep) return;
    if (step === "allocation") return;
    if (!savedAt || !isComplete) {
      setSaveError("자산배분 확정 저장 후 다음 단계로 이동할 수 있습니다. 저장된 배분이 없으면 자산배분부터 진행해 주세요.");
      onNavigateStep("allocation");
      return;
    }
    if (step === "approval" && !instrumentAllocationComplete) {
      setSaveError(
        classValidationWarnings.length
          ? `종목선택 확정 후 포트폴리오승인으로 이동할 수 있습니다.\n${classValidationWarnings.join("\n")}`
          : "종목선택 확정 후 포트폴리오승인으로 이동할 수 있습니다.",
      );
      onNavigateStep("instruments");
    }
  }, [
    hydrated,
    loadingHoldings,
    step,
    savedAt,
    isComplete,
    instrumentAllocationComplete,
    classValidationWarnings,
    onNavigateStep,
  ]);

  const paneClass = (active: boolean, direction: "forward" | "back") =>
    active
      ? `space-y-5 ${direction === "back" ? "portfolio-step-pane-back" : "portfolio-step-pane"}`
      : "hidden";

  return (
    <section className="space-y-5 overflow-hidden rounded-2xl border border-[#1428A0]/15 bg-gradient-to-b from-[#F7F9FF] to-white p-4 shadow-sm md:p-5">
      <div
        className={paneClass(step === "allocation", "back")}
        aria-hidden={step !== "allocation"}
        {...(step !== "allocation" ? ({ inert: "" } as HTMLAttributes<HTMLDivElement>) : {})}
      >
      <div className="rounded-2xl bg-gradient-to-r from-[#071B4A] via-[#102B6B] to-[#1428A0] p-5 text-white shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">PB manual allocation workspace</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Portfolio Customizing</h2>
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-blue-100">PB가 고객의 기존 보유자산을 확인하고 자산군 비중과 편입 종목을 직접 설계합니다.</p>
          </div>
          <div className={`min-w-[210px] rounded-xl border px-4 py-3 ${isComplete ? "border-emerald-300/50 bg-emerald-400/15" : "border-amber-300/50 bg-amber-300/10"}`}>
            <div className="flex items-end justify-between gap-4">
              <div><p className="text-[10px] font-bold text-blue-100">전체 자산배분 합계</p><p className="mt-1 text-3xl font-black">{finalTotal.toFixed(1)}%</p></div>
              <span className={`mb-1 rounded-full px-2 py-1 text-[10px] font-black ${isComplete ? "bg-emerald-300 text-emerald-950" : "bg-amber-300 text-amber-950"}`}>{isComplete ? "배분 완료" : `${remainingPct > 0 ? "잔여" : "초과"} ${Math.abs(remainingPct).toFixed(1)}%`}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"><div className={`h-full rounded-full ${total > 100 ? "bg-rose-400" : isComplete ? "bg-emerald-300" : "bg-amber-300"}`} style={{ width: `${Math.min(total, 100)}%` }} /></div>
          </div>
        </div>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">투자가능자산</p><p className="mt-0.5 text-sm font-black">{formatWon(investableWon)}</p></div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">기존 보유주식 · 고정</p><p className="mt-0.5 text-sm font-black">{formatWon(existingTotalWon)}</p></div>
            <div className="rounded-xl border border-emerald-300/30 bg-emerald-300/10 px-3 py-2"><p className="text-[10px] text-emerald-200">배분 가능 자산</p><p className="mt-0.5 text-sm font-black">{formatWon(allocatableWon)}</p></div>
            <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] text-blue-200">부동산 (AUM 별도)</p><p className="mt-0.5 text-sm font-black">{formatWon(realEstateWon)}</p></div>
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
          <p className="mt-0.5 text-[10px] text-fg-muted">전체 투자가능자산 기준입니다. 기존 보유주식 비중은 고정하고, 변경한 비현금 자산 외의 잔여분은 현금성으로 자동 배분합니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
            <button type="button" onClick={() => { setAllocationInputDrafts({}); setInputMode("percent"); }} className={`rounded-md px-4 py-1.5 text-xs font-black transition ${inputMode === "percent" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>퍼센티지 %</button>
            <button type="button" onClick={() => { setAllocationInputDrafts({}); setInputMode("amount"); }} disabled={allocatableWon <= 0} className={`rounded-md px-4 py-1.5 text-xs font-black transition disabled:opacity-40 ${inputMode === "amount" ? "bg-[#1428A0] text-white shadow-sm" : "text-fg-muted"}`}>금액 만원</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ASSET_CLASSES.map((item) => {
          const fixedPct = fixedPctForClass(item.id);
          const fixedWon = item.id === "domesticEquity" || item.id === "globalEquity" ? existingByClass[item.id] : 0;
          return (
            <label key={item.id} className={`group rounded-xl border p-4 transition ${item.id === "cash" ? "border-emerald-200 bg-emerald-50" : "border-border bg-white hover:-translate-y-0.5 hover:border-[#1428A0]/30 hover:shadow-sm"}`}>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-black text-fg">{item.label}</span>
                  <span className="block text-[10px] text-fg-muted">{item.description}</span>
                </span>
                <span className="flex items-center gap-1">
                  {/* onFocus 가 event.currentTarget 이 아니라 event.target 을 읽는 이유:
                      setState 에 함수를 넘기면 React 는 그 업데이터를 즉시 실행하지 않고
                      다음 렌더의 useState 처리 중에 부른다. 그 시점이면 합성 이벤트의
                      currentTarget 은 이미 null 로 되돌려져 있어
                      "Cannot read properties of null (reading 'value')" 로 죽는다
                      (2026-09-08 배포본 실측 — 승인 완료 고객의 포트폴리오 탭에서 이 입력란에
                      포커스가 들어가는 순간 재현). target 은 React 가 지우지 않고, onFocus
                      에서는 포커스를 받은 input 자신이라 의미도 같다.
                      아래 onBlur·onKeyDown 은 동기 호출이라 currentTarget 을 그대로 쓴다. */}
                  <input
                    type="number"
                    min={inputMode === "percent" ? fixedPct : fixedWon / WON_PER_MANWON}
                    max={inputMode === "percent" ? 100 : investableWon / WON_PER_MANWON}
                    step="0.1"
                    value={allocationInputDrafts[item.id] ?? (inputMode === "percent" ? Number(finalAllocation[item.id].toFixed(2)) : Number((investableWon * finalAllocation[item.id] / 100 / WON_PER_MANWON).toFixed(2)))}
                    onFocus={(event) => setAllocationInputDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    onChange={(event) => setAllocationInputDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                    onBlur={(event) => commitAllocationInput(item.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    disabled={item.id === "cash"}
                    className="w-24 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-right text-lg font-black tabular-nums text-fg outline-none transition focus:border-[#1428A0] focus:bg-white focus:ring-2 focus:ring-[#1428A0]/10"
                  />
                  <span className="min-w-7 text-xs font-bold text-fg-muted">{inputMode === "percent" ? "%" : "만원"}</span>
                </span>
              </span>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-gradient-to-r from-[#1428A0] to-[#4F67E8]" style={{ width: `${Math.min(finalAllocation[item.id], 100)}%` }} /></span>
              <span className="mt-2 flex items-center justify-between text-[10px] text-fg-muted"><span>{inputMode === "percent" ? formatWon(investableWon * finalAllocation[item.id] / 100) : `${finalAllocation[item.id].toFixed(2)}%`}</span><span>{item.id === "cash" ? "자동 계산" : "전체 투자가능자산 기준"}</span></span>
              {fixedWon > 0 && <span className="mt-2 block rounded-md bg-blue-50 px-2 py-1.5 text-[10px] font-bold text-blue-700">기존 보유 고정 {formatWon(fixedWon)} · {fixedPct.toFixed(2)}% 포함</span>}
            </label>
          );
        })}
      </div>

      {overAllocated && (
        <div
          ref={allocationWarningRef}
          className="rounded-xl border border-rose-400 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800"
          role="alert"
        >
          자산배분 합계가 100%를 {excessPctPoints.toFixed(1)}%p 초과했습니다. 배분 확정 저장 전에
          100%로 조정해 주세요.
          <span className="mt-1 block text-xs font-semibold text-rose-700">
            현재 합계 {finalTotal.toFixed(1)}% · 초과 {excessPctPoints.toFixed(1)}%p
          </span>
        </div>
      )}
      {saveError && !overAllocated && (
        <div
          ref={allocationWarningRef}
          className="rounded-xl border border-rose-400 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800"
          role="alert"
        >
          {saveError}
        </div>
      )}

      <div className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${isComplete ? "border-emerald-200 bg-emerald-50" : overAllocated ? "border-rose-300 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
        <div>
          <p className={`text-sm font-black ${isComplete ? "text-emerald-800" : overAllocated ? "text-rose-800" : "text-amber-800"}`}>
            {isComplete
              ? "100% 배분이 완료되었습니다."
              : remainingPct > 0
                ? `${remainingPct.toFixed(1)}% (${formatWon(Math.max(0, remainingWon))})를 더 배분하세요.`
                : `자산배분 합계가 100%를 ${excessPctPoints.toFixed(1)}%p 초과했습니다.`}
          </p>
          <p className="mt-0.5 text-[10px] text-fg-muted">
            {savedAt
              ? `마지막 저장 ${new Date(savedAt).toLocaleString("ko-KR")} · ${savedTo === "db" ? "다른 기기와 공유됨" : "이 브라우저에만 저장됨(DB 마이그레이션 필요)"}`
              : "아직 저장되지 않은 초안입니다."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const ok = await save();
              if (ok) onNavigateStep?.("instruments");
            })();
          }}
          disabled={loadingHoldings || saving}
          className="btn-primary px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loadingHoldings ? "보유자산 확인 중…" : saving ? "저장 중…" : "배분 확정 저장"}
        </button>
      </div>
      </div>

      <div
        className={paneClass(step === "instruments", "forward")}
        aria-hidden={step !== "instruments"}
        {...(step !== "instruments" ? ({ inert: "" } as HTMLAttributes<HTMLDivElement>) : {})}
      >
      <div>
        <p className="text-sm font-black text-fg">02 종목선택</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">자산군별 편입 종목과 내부 비중을 확정합니다.</p>
      </div>
      {(isComplete || overAllocated || total > 0) && (
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
                {item.label} {finalAllocation[item.id].toFixed(2)}%
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
                    {selectedForClass.map((item) => {
                      const classBudget = allocatableWon * (allocation[item.assetClass] || 0) / 100;
                      const lineBudget = classBudget * (item.weightWithinClass || 0) / 100;
                      const currency = item.currency || "KRW";
                      const fx = currency === "USD" ? (item.fxRate && item.fxRate > 0 ? item.fxRate : quoteFx) : 1;
                      const budgetLocal = currency === "USD" ? lineBudget / fx : lineBudget;
                      const needsQuote = requiresMarketQuote(item);
                      const quote = needsQuote
                        ? findQuoteBySymbol(liveQuotes, item.symbol, currency)
                        : undefined;
                      const livePx =
                        quote?.price != null && Number.isFinite(quote.price) && quote.price > 0
                          ? Number(quote.price)
                          : null;
                      // 직접채권: 카탈로그/초안 price(%). 지정가·검색 폴백 없음.
                      const bondPx =
                        !needsQuote && item.quotationKind === "bond_face" && item.price != null && item.price > 0
                          ? item.price
                          : null;
                      const px = needsQuote ? livePx : bondPx;
                      let unitCost = px != null && px > 0 ? px : null;
                      if (
                        unitCost != null &&
                        item.quotationKind === "bond_face" &&
                        item.faceValue &&
                        px != null &&
                        px <= 200
                      ) {
                        unitCost = (item.faceValue * px) / 100;
                      }
                      const increment =
                        item.quantityIncrement && item.quantityIncrement > 0 ? item.quantityIncrement : 1;
                      const rawQty = unitCost && unitCost > 0 ? budgetLocal / unitCost : 0;
                      const calcQty = floorToIncrement(rawQty, increment);
                      const costLocal = unitCost != null ? calcQty * unitCost : null;
                      const costKrw =
                        costLocal != null ? (currency === "USD" ? costLocal * fx : costLocal) : null;
                      const remainder = costKrw != null ? Math.max(0, lineBudget - costKrw) : null;
                      const quoteLabel = quote?.is_live
                        ? "KIS 실시간"
                        : quote?.price != null
                          ? "KIS 종가/직전가"
                          : null;

                      return (
                      <div key={`${item.assetClass}-${item.symbol}`} className="rounded-lg border border-border bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-fg">{item.name}</p>
                          <p className="text-[10px] text-fg-muted">
                            {item.symbol}
                            {item.source ? ` · ${item.source}` : ""}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.weightWithinClass}
                          onChange={(event) => setSelected((current) => current.map((candidate) => candidate.assetClass === item.assetClass && candidate.symbol === item.symbol ? { ...candidate, weightWithinClass: Math.max(0, Math.min(100, Number(event.target.value) || 0)) } : candidate))}
                          className="w-16 rounded border border-border px-2 py-1 text-right text-xs font-bold"
                          aria-label="자산군 내 비중"
                        />
                        <span className="text-xs text-fg-muted">%</span>
                        <button type="button" onClick={() => setSelected((current) => redistributeAssetClassWeights(current.filter((candidate) => !(candidate.assetClass === item.assetClass && candidate.symbol === item.symbol)), item.assetClass))} className="text-xs font-bold text-rose-500">삭제</button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-fg-muted">
                          <span>배정 {formatWon(lineBudget)}</span>
                          {needsQuote ? (
                            <>
                              <span className="font-bold text-[#1428A0]">
                                현재가 {px != null ? formatPrice(px, currency) : quotesLoading ? "조회 중…" : "—"}
                              </span>
                              {quoteLabel ? <span>{quoteLabel}</span> : null}
                              {quote?.quote_time ? <span>시세시각 {quote.quote_time}</span> : null}
                              {quote?.as_of ? <span>조회 {quote.as_of.slice(11, 19)}</span> : null}
                              {quote?.error_message ? (
                                <span className="font-bold text-amber-700">{quote.error_message}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="font-bold text-fg">직접채권 호가 {px != null ? formatPrice(px, currency) : "—"}</span>
                          )}
                          {item.quotationKind === "bond_face" ? (
                            <label className="flex items-center gap-1 font-bold">
                              액면
                              <input
                                type="number"
                                min="0"
                                value={item.faceValue ?? ""}
                                onChange={(event) => {
                                  const next = event.target.value === "" ? null : Number(event.target.value);
                                  setSelected((current) =>
                                    current.map((candidate) =>
                                      candidate.assetClass === item.assetClass && candidate.symbol === item.symbol
                                        ? { ...candidate, faceValue: next != null && Number.isFinite(next) ? next : null }
                                        : candidate,
                                    ),
                                  );
                                }}
                                className="w-20 rounded border border-border px-1.5 py-0.5 text-right text-[10px] font-bold"
                              />
                            </label>
                          ) : null}
                          {currency === "USD" ? (
                            <span className="font-bold">FX {fx.toLocaleString("ko-KR")}</span>
                          ) : null}
                          <span className="font-bold text-fg">
                            예상 수량 {calcQty > 0 ? calcQty.toLocaleString("ko-KR") : "—"}
                            {increment !== 1 ? ` · 증분 ${increment}` : ""}
                          </span>
                          {costKrw != null ? (
                            <span className="font-bold text-[#1428A0]">
                              예상 매수금액 {formatWon(costKrw)}
                              {remainder != null && remainder > 0 ? ` · 잔여현금 ${formatWon(remainder)}` : ""}
                            </span>
                          ) : (
                            <span className="font-bold text-amber-700">
                              {needsQuote
                                ? "KIS 현재가 확보 후 수량·금액이 계산됩니다"
                                : "채권 호가·액면 확인 후 계산됩니다"}
                            </span>
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {quotesError ? (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-bold text-amber-700">{quotesError}</p>
                    ) : null}                    {Math.abs(withinClassTotal - 100) >= 0.001 && (
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

      {isComplete && hydrated && (
        <div className="space-y-3 border-t border-border pt-4">
          <KoreanStockTrendFilter
            equityWeightPct={allocation.domesticEquity}
            onSelectionChange={handleTrendSelection}
            initialChecked={trendChecked}
            initialConfirmed={trendConfirmed}
            onCheckedConfirmedChange={handleTrendCheckedConfirmedChange}
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

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-white/95 px-4 py-3 backdrop-blur md:-mx-5 md:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => onNavigateStep?.("allocation")}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-bold text-fg hover:bg-surface-2"
          >
            이전: 자산배분
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const ok = await confirmInstruments();
                if (ok) onNavigateStep?.("approval");
              })();
            }}
            disabled={saving}
            className="btn-primary px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "저장 중…" : "종목선택 확정"}
          </button>
        </div>
      </div>
      </div>

      <div
        className={paneClass(step === "approval", "forward")}
        aria-hidden={step !== "approval"}
        {...(step !== "approval" ? ({ inert: "" } as HTMLAttributes<HTMLDivElement>) : {})}
      >
      <div>
        <p className="text-sm font-black text-fg">03 포트폴리오승인</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">미리보기·분석·세전·세후를 확인한 뒤 승인합니다.</p>
      </div>
      {isComplete && (
        <section className="overflow-hidden rounded-2xl border border-[#1428A0]/20 bg-white shadow-sm">
          <div className="flex flex-col gap-3 bg-[#071B4A] p-5 text-white sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200">Custom portfolio preview</p>
              <h3 className="mt-1 text-xl font-black">Portfolio preview</h3>
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
                  : selected.filter((item) => item.assetClass === asset.id).reduce((sum, item) => sum + item.weightWithinClass, 0);
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
                            <div className="min-w-0"><p className="truncate text-xs font-bold text-fg">{item.name}({item.symbol}) {item.hasExisting ? <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">{item.hasNew ? "기존 보유 + 추가 매수" : "기존 보유 · 고정"}</span> : null}</p><p className="text-[10px] text-fg-muted">{item.hasExisting && item.hasNew ? `기존 ${formatWon(item.fixedAmountWon)} + 추가 ${formatWon(item.newAmountWon)} · 신규 배분 자산군 내 ${item.newWeightWithinClass}%` : item.hasExisting ? "기본정보에서 자동 반영" : `신규 배분 자산군 내 ${item.newWeightWithinClass}%`}{item.source ? ` · ${item.source}` : ""}</p></div>
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

            {existing.length > 0 && <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] leading-relaxed text-blue-700">기존 보유주식은 기본정보에서 고정 편입됩니다. 같은 종목을 추가 매수 대상으로 선택하면 기존 보유분과 신규 배분액을 합산한 하나의 최종 포지션으로 표시·분석됩니다.</p>}
          </div>
        </section>
      )}
      <PortfolioAnalyticsCards key={clientId} allocation={finalAllocation} selected={analyticsSelected} complete={hydrated && !loadingHoldings && isComplete && instrumentAllocationComplete} onAnalyticsSnapshot={setAnalyticsSnapshot} />
      </div>
    </section>
  );
}
