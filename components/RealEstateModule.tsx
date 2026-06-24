"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { deriveMetrics } from "@/lib/realestate/derive";
import type { MarketValueResult, AptAreaResult } from "@/lib/realestate/fetch-market-value";
import { searchLawd } from "@/lib/realestate/lawd-codes";

interface Props {
  clientId: string;
}

type PropertyType = "apartment" | "officetel" | "house" | "land" | "presale_right";
type OwnershipType = "sole" | "joint";
type Usage = "primary_residence" | "rental" | "investment";
type LeaseType = "none" | "jeonse" | "monthly";
type MarketSource = "molit_realtxn" | "public_price" | "kb" | "manual";
type MarketConf = "high" | "medium" | "low";
type RateType = "fixed" | "variable";

interface Property {
  id: string;
  property_type: PropertyType;
  address: string | null;
  complex_name: string | null;
  area_m2: number | null;
  legal_dong_code: string | null;
  ownership_type: OwnershipType;
  ownership_share: number;
  usage: Usage;
  acquired_at: string | null;
  acquired_price: number | null;
  market_value: number | null;
  market_value_low: number | null;
  market_value_high: number | null;
  market_source: MarketSource | null;
  market_confidence: MarketConf | null;
  official_price: number | null;
  lease_type: LeaseType;
  deposit: number | null;
  monthly_rent: number | null;
  source: string;
  created_at: string;
}

interface Debt {
  id: string;
  property_id: string;
  lender: string | null;
  balance: number;
  interest_rate: number | null;
  rate_type: RateType | null;
  maturity_date: string | null;
  source: string;
  confidence: MarketConf | null;
}

const PROP_TYPE_LABEL: Record<PropertyType, string> = {
  apartment: "아파트", officetel: "오피스텔", house: "단독/다가구",
  land: "토지", presale_right: "분양권",
};
const USAGE_LABEL: Record<Usage, string> = {
  primary_residence: "실거주", rental: "임대", investment: "투자",
};
const LEASE_LABEL: Record<LeaseType, string> = { none: "없음", jeonse: "전세", monthly: "월세" };
const SOURCE_LABEL: Record<MarketSource, string> = {
  molit_realtxn: "국토부 실거래", public_price: "공시가격", kb: "KB시세", manual: "수동",
};

function formatW(n: number | null) {
  if (n == null) return "—";
  if (Math.abs(n) >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (Math.abs(n) >= 10_000) return (n / 10_000).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

function pct(n: number | null) {
  if (n == null) return "—";
  return (n * 100).toFixed(1) + "%";
}

// ── 빈 폼 ──
function emptyForm() {
  return {
    property_type: "apartment" as PropertyType,
    address: "",
    complex_name: "",
    area_m2: "",
    legal_dong_code: "",
    ownership_type: "sole" as OwnershipType,
    ownership_share: "100",
    usage: "primary_residence" as Usage,
    acquired_at: "",
    acquired_price: "",
    market_value: "",
    market_value_low: "",
    market_value_high: "",
    market_source: "manual" as MarketSource,
    market_confidence: "medium" as MarketConf,
    official_price: "",
    lease_type: "none" as LeaseType,
    deposit: "",
    monthly_rent: "",
  };
}

function emptyDebtForm() {
  return { lender: "", balance: "", interest_rate: "", rate_type: "fixed" as RateType, maturity_date: "", confidence: "medium" as MarketConf };
}

export default function RealEstateModule({ clientId }: Props) {
  const [tab, setTab] = useState<"saved" | "add">("saved");
  const [properties, setProperties] = useState<Property[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null);
  const [deletingProp, setDeletingProp] = useState<string | null>(null);
  const [deletingDebt, setDeletingDebt] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<Record<string, MarketValueResult>>({});

  // 폼 상태
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 지역 검색 자동완성
  const [lawdSearch, setLawdSearch] = useState("");
  const [lawdDropdown, setLawdDropdown] = useState(false);
  const lawdRef = useRef<HTMLDivElement>(null);

  // 면적 단위 토글
  const [areaUnit, setAreaUnit] = useState<"m2" | "pyeong">("m2");
  const PYEONG = 3.305785;
  const areaM2FromForm = form.area_m2
    ? areaUnit === "pyeong"
      ? Number(form.area_m2) * PYEONG
      : Number(form.area_m2)
    : null;

  // 대출 추가 상태 (property별)
  const [debtFormProp, setDebtFormProp] = useState<string | null>(null);
  const [debtForm, setDebtForm] = useState(emptyDebtForm());
  const [savingDebt, setSavingDebt] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const { data: props } = await supabase
      .from("client_real_estate")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    const propList = (props as Property[]) ?? [];
    setProperties(propList);
    if (propList.length > 0) {
      const { data: dtsReal } = await supabase
        .from("client_real_estate_debt")
        .select("*")
        .in("property_id", propList.map((p) => p.id));
      setDebts((dtsReal as Debt[]) ?? []);
    } else {
      setDebts([]);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const f = (key: keyof ReturnType<typeof emptyForm>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));

  const handleSave = async () => {
    if (!supabase) return;
    if (!form.property_type) { setMsg({ ok: false, text: "물건 종류를 선택하세요." }); return; }
    if (!form.address && !form.complex_name) { setMsg({ ok: false, text: "주소 또는 단지명을 입력하세요." }); return; }
    setSaving(true);
    setMsg(null);
    const shareVal = Number(form.ownership_share) / 100;
    const { error } = await supabase.from("client_real_estate").insert([{
      client_id: clientId,
      owner_party_id: clientId,
      property_type: form.property_type,
      address: form.address || null,
      complex_name: form.complex_name || null,
      area_m2: areaM2FromForm != null ? Math.round(areaM2FromForm * 100) / 100 : null,
      legal_dong_code: form.legal_dong_code || null,
      ownership_type: form.ownership_type,
      ownership_share: shareVal,
      usage: form.usage,
      acquired_at: form.acquired_at || null,
      acquired_price: form.acquired_price ? Number(form.acquired_price) : null,
      market_value: form.market_value ? Number(form.market_value) : null,
      market_value_low: form.market_value_low ? Number(form.market_value_low) : null,
      market_value_high: form.market_value_high ? Number(form.market_value_high) : null,
      market_source: form.market_source,
      market_confidence: form.market_confidence,
      official_price: form.official_price ? Number(form.official_price) : null,
      lease_type: form.lease_type,
      deposit: form.deposit ? Number(form.deposit) : null,
      monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : null,
      source: "manual",
    }]);
    if (error) {
      setMsg({ ok: false, text: `저장 실패: ${error.message}` });
    } else {
      setMsg({ ok: true, text: "부동산 자산이 저장되었습니다." });
      setForm(emptyForm());
      setLawdSearch("");
      setAreaUnit("m2");
      await load();
      setTimeout(() => { setMsg(null); setTab("saved"); }, 800);
    }
    setSaving(false);
  };

  const deleteProperty = async (id: string) => {
    if (!supabase) return;
    setDeletingProp(id);
    await supabase.from("client_real_estate").delete().eq("id", id);
    setProperties((p) => p.filter((x) => x.id !== id));
    setDebts((d) => d.filter((x) => x.property_id !== id));
    setDeletingProp(null);
  };

  const handleAddDebt = async (propertyId: string) => {
    if (!supabase || !debtForm.balance) return;
    setSavingDebt(true);
    const { error } = await supabase.from("client_real_estate_debt").insert([{
      property_id: propertyId,
      lender: debtForm.lender || null,
      balance: Number(debtForm.balance),
      interest_rate: debtForm.interest_rate ? Number(debtForm.interest_rate) : null,
      rate_type: debtForm.rate_type || null,
      maturity_date: debtForm.maturity_date || null,
      source: "manual",
      confidence: debtForm.confidence,
    }]);
    if (!error) {
      await load();
      setDebtFormProp(null);
      setDebtForm(emptyDebtForm());
    }
    setSavingDebt(false);
  };

  const deleteDebt = async (id: string) => {
    if (!supabase) return;
    setDeletingDebt(id);
    await supabase.from("client_real_estate_debt").delete().eq("id", id);
    setDebts((d) => d.filter((x) => x.id !== id));
    setDeletingDebt(null);
  };

  const handleAreaPick = async (prop: Property, area: AptAreaResult) => {
    console.log("[handleAreaPick] 클릭:", { propId: prop.id, area: area.area, median: area.median });

    if (!supabase || area.median == null) {
      console.warn("[handleAreaPick] 조기 반환 — supabase:", !!supabase, "median:", area.median);
      return;
    }

    const confidence: MarketConf =
      area.sampleSize >= 3 ? "high" : area.sampleSize >= 1 ? "medium" : "low";

    // ① 낙관적 업데이트: Supabase 왕복 전에 로컬 상태 즉시 반영
    console.log("[handleAreaPick] 로컬 상태 즉시 갱신 →", { area_m2: area.area, market_value: area.median });
    setProperties((prev) =>
      prev.map((p) =>
        p.id === prop.id
          ? {
              ...p,
              area_m2:           area.area,
              market_value:      area.median,
              market_value_low:  area.low,
              market_value_high: area.high,
              market_source:     "molit_realtxn" as MarketSource,
              market_confidence: confidence,
            }
          : p,
      ),
    );
    setLookupResult((prev) => ({
      ...prev,
      [prop.id]: {
        ...prev[prop.id],
        value:      area.median,
        low:        area.low,
        high:       area.high,
        confidence,
        sampleSize: area.sampleSize,
        note:       area.correctionNote,
      },
    }));

    // ② Supabase 저장 (비동기 — UI는 이미 갱신된 상태)
    console.log("[handleAreaPick] Supabase 저장 시작");
    const { error } = await supabase.from("client_real_estate").update({
      area_m2:           area.area,
      market_value:      area.median,
      market_value_low:  area.low,
      market_value_high: area.high,
      market_source:     "molit_realtxn",
      market_confidence: confidence,
    }).eq("id", prop.id);

    if (error) {
      console.error("[handleAreaPick] Supabase 저장 실패:", error);
    } else {
      console.log("[handleAreaPick] Supabase 저장 성공 — load() 호출");
      await load();
      console.log("[handleAreaPick] load() 완료");
    }
  };

  const lookupMarketValue = async (p: Property) => {
    if (!p.legal_dong_code || !p.complex_name || !p.area_m2) return;
    setLookingUp(p.id);
    try {
      const res = await fetch("/api/realestate-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalDongCode: p.legal_dong_code,
          complexName: p.complex_name,
          areaM2: p.area_m2,
        }),
      });
      const data: MarketValueResult = await res.json();
      setLookupResult((prev) => ({ ...prev, [p.id]: data }));

      // 조회 성공 + 값 있으면 Supabase 업데이트
      if (data.value != null && supabase) {
        await supabase.from("client_real_estate").update({
          market_value: data.value,
          market_value_low: data.low,
          market_value_high: data.high,
          market_source: "molit_realtxn",
          market_confidence: data.confidence,
        }).eq("id", p.id);
        await load();
      }
    } catch {
      setLookupResult((prev) => ({ ...prev, [p.id]: { value: null, low: null, high: null, confidence: "low", source: "molit_realtxn", sampleSize: 0, note: "네트워크 오류", connected: false, freshness: "참고용" as const, areaBreakdown: [] } }));
    }
    setLookingUp(null);
  };

  const tabBar = (
    <div className="flex gap-1 mb-4 border-b border-border">
      {([["saved", `저장된 부동산${properties.length > 0 ? ` (${properties.length})` : ""}`], ["add", "직접 추가"]] as const).map(([t, label]) => (
        <button key={t} onClick={() => setTab(t as "saved" | "add")}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── 저장된 부동산 탭 ──
  if (tab === "saved") {
    // 전체 포트폴리오 요약
    const totals = properties.reduce((acc, p) => {
      const pDebts = debts.filter((d) => d.property_id === p.id);
      const m = deriveMetrics(p, pDebts);
      return {
        totalValue: acc.totalValue + m.myValue,
        totalDebt: acc.totalDebt + m.totalDebt + m.depositLiability,
        totalEquity: acc.totalEquity + m.equity,
        investable: acc.investable + m.investableEquity,
      };
    }, { totalValue: 0, totalDebt: 0, totalEquity: 0, investable: 0 });

    return (
      <div>
        {tabBar}
        {loading ? (
          <p className="py-8 text-center text-sm text-fg-muted">불러오는 중…</p>
        ) : properties.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-fg-muted mb-3">등록된 부동산 자산이 없습니다.</p>
            <button className="btn-primary text-sm px-5" onClick={() => setTab("add")}>부동산 추가하기</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 포트폴리오 요약 */}
            <div className="rounded-xl border border-border bg-surface-2 px-5 py-4">
              <p className="text-xs font-semibold text-fg-muted mb-3 uppercase tracking-wide">부동산 전체 요약</p>
              <div className="grid grid-cols-4 gap-4 text-center">
                {[
                  ["총 자산 가치", formatW(totals.totalValue), "text-fg"],
                  ["총 부채", formatW(totals.totalDebt), "text-red-500"],
                  ["순자산 기여", formatW(totals.totalEquity), totals.totalEquity >= 0 ? "text-green-600" : "text-red-500"],
                  ["투자가능 자산", formatW(totals.investable), "text-[#1428A0]"],
                ].map(([label, val, cls]) => (
                  <div key={label as string}>
                    <p className="text-[10px] text-fg-muted mb-1">{label as string}</p>
                    <p className={`text-base font-bold ${cls}`}>{val as string}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button className="btn-outline text-xs py-1 px-3" onClick={() => setTab("add")}>+ 부동산 추가</button>
            </div>

            {/* 개별 물건 카드 */}
            {properties.map((p) => {
              const pDebts = debts.filter((d) => d.property_id === p.id);
              const m = deriveMetrics(p, pDebts);
              const isExpanded = expandedDebt === p.id;
              const isAddingDebt = debtFormProp === p.id;

              return (
                <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                  {/* 카드 헤더 */}
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 mb-1">
                          <span className="badge-navy text-[10px]">{PROP_TYPE_LABEL[p.property_type]}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.usage === "primary_residence" ? "bg-blue-50 text-blue-700 border border-blue-200" : p.usage === "rental" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                            {USAGE_LABEL[p.usage]}
                          </span>
                          {p.ownership_type === "joint" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                              지분 {(p.ownership_share * 100).toFixed(0)}%
                            </span>
                          )}
                        </div>
                        <p className="font-semibold text-fg">
                          {p.complex_name || p.address || "주소 미입력"}
                          {p.area_m2 && <span className="text-sm font-normal text-fg-muted ml-1">{p.area_m2}m²</span>}
                        </p>
                        {p.address && p.complex_name && (
                          <p className="text-xs text-fg-muted mt-0.5">{p.address}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.legal_dong_code && p.complex_name && p.area_m2 ? (
                          <button
                            onClick={() => lookupMarketValue(p)}
                            disabled={lookingUp === p.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#1428A0] text-white hover:bg-[#0f1e7a] disabled:opacity-50 transition-colors"
                          >
                            {lookingUp === p.id ? (
                              <span className="flex items-center gap-1">
                                <span className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                                조회 중
                              </span>
                            ) : "시세 조회"}
                          </button>
                        ) : (
                          <span className="text-[10px] text-fg-muted" title="법정동코드·단지명·면적을 입력하면 시세 자동조회 가능합니다">조회불가</span>
                        )}
                        <button onClick={() => deleteProperty(p.id)} disabled={deletingProp === p.id}
                          className="text-red-400 hover:text-red-600 font-bold text-sm disabled:opacity-40">✕</button>
                      </div>
                    </div>

                    {/* 시세 */}
                    {p.market_value != null ? (
                      <div className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
                        <span className="font-semibold text-fg text-base">{formatW(p.market_value)}</span>
                        {(p.market_value_low || p.market_value_high) && (
                          <span>({formatW(p.market_value_low)} ~ {formatW(p.market_value_high)})</span>
                        )}
                        {p.market_source && <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">{SOURCE_LABEL[p.market_source]}</span>}
                        {p.market_confidence && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.market_confidence === "high" ? "bg-green-50 text-green-700" : p.market_confidence === "low" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-600"}`}>
                            {p.market_confidence === "high" ? "신뢰도 높음" : p.market_confidence === "low" ? "신뢰도 낮음" : "신뢰도 보통"}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1">
                        ⚠ 추정 시세 미입력 — 우측 &ldquo;시세 조회&rdquo; 버튼을 누르거나 직접 입력하세요.
                      </p>
                    )}

                    {/* 국토부 API 조회 결과 */}
                    {lookupResult[p.id] && (() => {
                      const res = lookupResult[p.id];
                      // 성공
                      if (res.value != null) return (
                        <div className="mt-2 text-xs px-3 py-1.5 rounded-lg border bg-green-50 border-green-200 text-green-700">
                          ✓ 국토부 실거래 {res.sampleSize}건 → {formatW(res.value)} 저장됨 · {res.note}
                        </div>
                      );
                      // 면적 불일치 — 같은 단지 면적 선택 UI
                      if (res.areaBreakdown && res.areaBreakdown.length > 0) return (
                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                          <p className="text-xs text-amber-700 font-medium mb-2">
                            {p.area_m2 != null ? `${p.area_m2}㎡ 거래 없음 —` : ""} 같은 단지 거래 면적을 선택하세요
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {res.areaBreakdown.map((area) => {
                              const badge = area.freshness === "확정" ? "🟢" : area.freshness === "추정" ? "🟡" : "🔴";
                              return (
                                <button
                                  key={area.area}
                                  onClick={() => handleAreaPick(p, area)}
                                  className="flex flex-col items-start text-xs rounded-lg border border-amber-300 bg-white px-3 py-2 hover:bg-[#1428A0] hover:text-white hover:border-[#1428A0] transition-colors group"
                                >
                                  <span className="font-bold text-fg group-hover:text-white">{area.area}㎡ ({area.pyeong}평)</span>
                                  <span className="text-fg-muted group-hover:text-white/80">{badge} {area.freshness} · {area.sampleSize}건</span>
                                  <span className="text-[#1428A0] font-semibold group-hover:text-white">{formatW(area.median)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                      // 데이터 자체 없음
                      return (
                        <div className="mt-2 text-xs px-3 py-1.5 rounded-lg border bg-red-50 border-red-200 text-red-600">
                          ✕ {res.note}
                        </div>
                      );
                    })()}

                    {/* 파생 지표 */}
                    {(() => {
                      const priced = p.market_value != null;
                      return (
                        <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                          {[
                            ["지분 가치", priced ? formatW(m.myValue) : "—", "text-fg"],
                            ["주담대+부채", priced || m.totalDebt > 0 ? formatW(m.totalDebt + m.depositLiability) : "—", "text-red-500"],
                            ["순자산", priced ? formatW(m.equity) : "—", priced && m.equity < 0 ? "text-red-500" : "text-green-600"],
                            ["LTV", pct(m.ltv), m.ltv != null && m.ltv > 0.8 ? "text-red-500" : m.ltv != null && m.ltv > 0.6 ? "text-amber-600" : "text-fg-muted"],
                            ["임대수익률", m.rentalYield != null ? pct(m.rentalYield) : "—", "text-[#1428A0]"],
                          ].map(([label, val, cls]) => (
                            <div key={label as string} className="rounded-lg bg-surface-2 px-2 py-2">
                              <p className="text-[9px] text-fg-muted mb-0.5">{label as string}</p>
                              <p className={`text-sm font-bold ${cls}`}>{val as string}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* 임대 정보 */}
                    {p.lease_type !== "none" && (
                      <p className="mt-2 text-xs text-fg-muted">
                        {LEASE_LABEL[p.lease_type]}
                        {p.deposit != null && ` · 보증금 ${formatW(p.deposit)}`}
                        {p.monthly_rent != null && ` · 월세 ${formatW(p.monthly_rent)}/월`}
                      </p>
                    )}

                    {/* 취득 정보 */}
                    {(p.acquired_at || p.acquired_price) && (
                      <p className="mt-1 text-xs text-fg-muted">
                        취득{p.acquired_at ? ` ${p.acquired_at}` : ""}
                        {p.acquired_price != null && ` · 취득가 ${formatW(p.acquired_price)}`}
                      </p>
                    )}
                  </div>

                  {/* 대출 섹션 */}
                  <div className="border-t border-border">
                    <button
                      className="w-full flex items-center justify-between px-5 py-2.5 text-xs text-fg-muted hover:bg-surface-2 transition-colors"
                      onClick={() => setExpandedDebt(isExpanded ? null : p.id)}
                    >
                      <span>
                        <span className="font-semibold">연결 대출</span>
                        {pDebts.length > 0 ? ` ${pDebts.length}건` : " — 없음"}
                      </span>
                      <span>{isExpanded ? "▲" : "▼"}</span>
                    </button>

                    {isExpanded && (
                      <div className="px-5 pb-4 space-y-2">
                        {pDebts.map((d) => (
                          <div key={d.id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-xs">
                            <div className="flex-1">
                              <span className="font-medium text-fg">{d.lender || "대출기관 미입력"}</span>
                              <span className="text-fg-muted ml-2">잔액 {formatW(d.balance)}</span>
                              {d.interest_rate != null && <span className="text-fg-muted ml-2">금리 {d.interest_rate}%</span>}
                              {d.rate_type && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-gray-100 rounded">{d.rate_type === "fixed" ? "고정" : "변동"}</span>}
                              {d.maturity_date && <span className="text-fg-muted ml-2">만기 {d.maturity_date}</span>}
                            </div>
                            <button onClick={() => deleteDebt(d.id)} disabled={deletingDebt === d.id}
                              className="text-red-400 hover:text-red-600 font-bold disabled:opacity-40">✕</button>
                          </div>
                        ))}

                        {isAddingDebt ? (
                          <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                ["대출기관", "lender", "text", "예: 국민은행"],
                                ["잔액 (원) *", "balance", "number", "0"],
                                ["금리 (%)", "interest_rate", "number", "3.5"],
                                ["만기일", "maturity_date", "date", ""],
                              ].map(([label, key, type, ph]) => (
                                <div key={key as string}>
                                  <label className="label text-[10px]">{label as string}</label>
                                  <input className="input text-xs py-1" type={type as string} placeholder={ph as string}
                                    value={(debtForm as Record<string, string>)[key as string]}
                                    onChange={(e) => setDebtForm((p) => ({ ...p, [key as string]: e.target.value }))} />
                                </div>
                              ))}
                            </div>
                            <div className="flex items-center gap-2">
                              <select className="input text-xs py-1 w-auto" value={debtForm.rate_type}
                                onChange={(e) => setDebtForm((p) => ({ ...p, rate_type: e.target.value as RateType }))}>
                                <option value="fixed">고정금리</option>
                                <option value="variable">변동금리</option>
                              </select>
                              <div className="flex gap-1.5 ml-auto">
                                <button className="btn-ghost text-xs py-1 px-3" onClick={() => { setDebtFormProp(null); setDebtForm(emptyDebtForm()); }}>취소</button>
                                <button className="btn-primary text-xs py-1 px-3 disabled:opacity-50" disabled={!debtForm.balance || savingDebt}
                                  onClick={() => handleAddDebt(p.id)}>
                                  {savingDebt ? "저장 중…" : "추가"}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <button className="text-xs text-[#1428A0] hover:underline font-medium"
                            onClick={() => { setDebtFormProp(p.id); setExpandedDebt(p.id); }}>
                            + 대출 추가
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <p className="text-[10px] text-fg-muted/70 text-center pt-2">
              ※ 추정시세는 실거래 기반 참고값입니다. 중요한 의사결정 전 감정평가·KB시세로 보정하세요.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── 직접 추가 탭 ──
  const inp = (label: string, key: keyof ReturnType<typeof emptyForm>, type = "text", ph = "", required = false) => (
    <div>
      <label className="label">{label}{required && " *"}</label>
      <input className="input" type={type} placeholder={ph}
        value={form[key] as string}
        onChange={f(key)} />
    </div>
  );

  const sel = (label: string, key: keyof ReturnType<typeof emptyForm>, opts: [string, string][]) => (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={form[key] as string} onChange={f(key)}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      {tabBar}
      <div className="space-y-5">
        {/* 섹션 1: 물건 기본 */}
        <div>
          <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wide">물건 기본</p>
          <div className="grid grid-cols-2 gap-3">
            {sel("물건 종류 *", "property_type", [
              ["apartment", "아파트"], ["officetel", "오피스텔"], ["house", "단독/다가구"],
              ["land", "토지"], ["presale_right", "분양권"],
            ])}
            {inp("단지명", "complex_name", "text", "예: 래미안 퍼스티지")}
            {inp("주소", "address", "text", "예: 서울 서초구 반포동 1234")}
            {/* 지역 검색 자동완성 */}
            <div ref={lawdRef} className="relative">
              <label className="label">지역 검색 (법정동코드)</label>
              <input
                className="input"
                placeholder="예: 강남구, 분당구, 해운대구"
                value={lawdSearch}
                onChange={(e) => {
                  setLawdSearch(e.target.value);
                  setLawdDropdown(true);
                  if (!e.target.value) setForm((p) => ({ ...p, legal_dong_code: "" }));
                }}
                onFocus={() => { if (lawdSearch) setLawdDropdown(true); }}
                onBlur={() => setTimeout(() => setLawdDropdown(false), 150)}
              />
              {lawdDropdown && searchLawd(lawdSearch).length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 bg-white border border-border rounded-xl shadow-lg mt-1 overflow-hidden max-h-48 overflow-y-auto">
                  {searchLawd(lawdSearch).map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex items-center justify-between"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm((p) => ({ ...p, legal_dong_code: l.code }));
                        setLawdSearch(l.name);
                        setLawdDropdown(false);
                      }}
                    >
                      <span>{l.name}</span>
                      <span className="text-xs text-fg-muted">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.legal_dong_code && (
                <p className="text-xs text-[#1428A0] mt-0.5">코드 확정: {form.legal_dong_code}</p>
              )}
            </div>
            {/* 전용면적 + 단위 토글 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="label mb-0">전용면적</label>
                <div className="flex rounded-lg overflow-hidden border border-border text-[11px] font-semibold">
                  {(["m2", "pyeong"] as const).map((u) => (
                    <button key={u} type="button"
                      className={`px-2 py-0.5 transition-colors ${areaUnit === u ? "bg-[#1428A0] text-white" : "bg-white text-fg-muted hover:bg-surface-2"}`}
                      onClick={() => setAreaUnit(u)}>
                      {u === "m2" ? "m²" : "평"}
                    </button>
                  ))}
                </div>
              </div>
              <input className="input" type="number" step="0.01"
                placeholder={areaUnit === "m2" ? "84.5" : "25.6"}
                value={form.area_m2}
                onChange={f("area_m2")} />
              {form.area_m2 && areaUnit === "pyeong" && (
                <p className="text-xs text-fg-muted mt-0.5">
                  ≈ {(Number(form.area_m2) * PYEONG).toFixed(2)} m²로 저장됩니다
                </p>
              )}
              {form.area_m2 && areaUnit === "m2" && (
                <p className="text-xs text-fg-muted mt-0.5">
                  ≈ {(Number(form.area_m2) / PYEONG).toFixed(1)} 평
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 섹션 2: 보유 현황 */}
        <div>
          <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wide">보유 현황</p>
          <div className="grid grid-cols-2 gap-3">
            {sel("보유형태 *", "ownership_type", [["sole", "단독명의"], ["joint", "공동명의/지분"]])}
            <div>
              <label className="label">지분율 (%)</label>
              <input className="input" type="number" placeholder="100" min={1} max={100}
                value={form.ownership_share}
                onChange={f("ownership_share")}
                disabled={form.ownership_type === "sole"} />
            </div>
            {sel("용도 *", "usage", [
              ["primary_residence", "실거주"], ["rental", "임대"], ["investment", "투자"],
            ])}
            {inp("취득일", "acquired_at", "date")}
            {inp("취득가액 (원)", "acquired_price", "number", "0")}
          </div>
        </div>

        {/* 섹션 3: 시세 */}
        <div>
          <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wide">시세 <span className="text-amber-500 normal-case font-normal">← 입력해야 순자산·LTV가 계산됩니다</span></p>
          <div className="grid grid-cols-2 gap-3">
            {inp("추정 시세 (원) *", "market_value", "number", "예: 500000000")}
            {inp("시세 하한 (원)", "market_value_low", "number", "")}
            {inp("시세 상한 (원)", "market_value_high", "number", "")}
            {sel("시세 출처", "market_source", [
              ["manual", "수동 입력"], ["molit_realtxn", "국토부 실거래"],
              ["public_price", "공시가격"], ["kb", "KB시세"],
            ])}
            {sel("신뢰도", "market_confidence", [
              ["high", "높음"], ["medium", "보통"], ["low", "낮음"],
            ])}
            {inp("공시가격 (원)", "official_price", "number", "세금 base")}
          </div>
        </div>

        {/* 섹션 4: 임대 현황 */}
        <div>
          <p className="text-xs font-semibold text-fg-muted mb-2 uppercase tracking-wide">임대 현황</p>
          <div className="grid grid-cols-2 gap-3">
            {sel("임대형태", "lease_type", [
              ["none", "없음 (직접 거주·공실)"], ["jeonse", "전세"], ["monthly", "월세"],
            ])}
            {form.lease_type !== "none" && inp("보증금 (원)", "deposit", "number", "0")}
            {form.lease_type === "monthly" && inp("월세 (원/월)", "monthly_rent", "number", "0")}
          </div>
        </div>

        {msg && (
          <p className={`rounded-lg px-4 py-2 text-sm font-medium ${msg.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {msg.ok ? "✓ " : "✕ "}{msg.text}
          </p>
        )}

        <button
          className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "저장 중…" : "부동산 자산 저장"}
        </button>
        <p className="text-[10px] text-fg-muted/70 text-center">
          ※ 취득가·공시가격·지분율을 정확히 입력하면 순자산·투자가능자산이 자동 계산됩니다.
        </p>
      </div>
    </div>
  );
}
