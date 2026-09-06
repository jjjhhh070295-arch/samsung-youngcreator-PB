"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { deriveMetrics } from "@/lib/realestate/derive";
import type { MarketValueResult, AptAreaResult } from "@/lib/realestate/fetch-market-value";
import { searchLawd } from "@/lib/realestate/lawd-codes";

interface Props {
  clientId: string;
  /**
   * 부동산 평가액 합계가 바뀌었을 때 호출. 상단 자산 비중 바를 다시 그리게 한다.
   * 대출(debt) 변경은 비중 계산에 안 들어가므로 알리지 않는다.
   */
  onAssetsChanged?: () => void;
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
    // official_price(공시가격): 폼 입력란 제거됨(어디서도 안 읽히는 필드) — DB 컬럼은 유지,
    // insert 시 항상 null로 보낸다(handleSave 참고).
    lease_type: "none" as LeaseType,
    deposit: "",
    monthly_rent: "",
  };
}

function emptyDebtForm() {
  return { lender: "", balance: "", interest_rate: "", rate_type: "fixed" as RateType, maturity_date: "", confidence: "medium" as MarketConf };
}

export default function RealEstateModule({ clientId, onAssetsChanged }: Props) {
  const [tab, setTab] = useState<"saved" | "add">("saved");
  const [properties, setProperties] = useState<Property[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDebt, setExpandedDebt] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false); // 저장된 부동산 상세보기 — 화면 상태만, DB 저장 안 함
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

  // 대출 추가 상태 (property별 — "저장된 부동산" 탭에서 기존 물건에 대출 추가할 때)
  const [debtFormProp, setDebtFormProp] = useState<string | null>(null);
  const [debtForm, setDebtForm] = useState(emptyDebtForm());
  const [savingDebt, setSavingDebt] = useState(false);

  // ── "부동산 추가" 3단계 마법사 상태 (조회 → 평형 선택 → 확인/저장) ──
  const [addStep, setAddStep] = useState<"search" | "results" | "confirm">("search");
  const [searchComplexName, setSearchComplexName] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<MarketValueResult | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 저장 전 임시 대출 초안 — 신규 물건은 아직 property_id가 없어 handleSave에서 물건 저장 직후 이어붙인다.
  const [addDebtDraft, setAddDebtDraft] = useState({ lender: "", balance: "", interest_rate: "", rate_type: "fixed" as RateType, maturity_date: "" });

  const resetAddWizard = () => {
    setAddStep("search");
    setSearchComplexName("");
    setSearchResult(null);
    setManualEntry(false);
    setShowAdvanced(false);
    setAddDebtDraft({ lender: "", balance: "", interest_rate: "", rate_type: "fixed", maturity_date: "" });
    setForm(emptyForm());
    setLawdSearch("");
    setAreaUnit("m2");
  };

  const handleSearchComplex = async () => {
    if (!form.legal_dong_code || !searchComplexName.trim()) return;
    setSearching(true);
    setForm((p) => ({ ...p, complex_name: searchComplexName.trim() }));
    try {
      const res = await fetch("/api/realestate-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legalDongCode: form.legal_dong_code, complexName: searchComplexName.trim() }),
      });
      const data: MarketValueResult = await res.json();
      setSearchResult(data);
    } catch {
      setSearchResult({
        value: null, low: null, high: null, confidence: "low", source: "molit_realtxn",
        sampleSize: 0, note: "네트워크 오류", connected: false, freshness: "참고용", areaBreakdown: [],
      });
    }
    setSearching(false);
    setAddStep("results");
  };

  const pickArea = (area: AptAreaResult) => {
    const confidence: MarketConf = area.sampleSize >= 3 ? "high" : area.sampleSize >= 1 ? "medium" : "low";
    setForm((p) => ({
      ...p,
      area_m2: String(area.area),
      market_value: area.median != null ? String(area.median) : "",
      market_value_low: area.low != null ? String(area.low) : "",
      market_value_high: area.high != null ? String(area.high) : "",
      market_source: "molit_realtxn",
      market_confidence: confidence,
    }));
    setManualEntry(false);
    setAddStep("confirm");
  };

  const handleManualEntry = () => {
    setForm((p) => ({ ...p, market_source: "manual" }));
    setManualEntry(true);
    setAddStep("confirm");
  };

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
    // 시세 없이 저장되면 이 부동산이 0원으로 잡혀 헤리티지 상속세 계산이 과소 추정된다 — 반드시 막는다.
    if (!form.market_value || Number(form.market_value) <= 0) {
      setMsg({ ok: false, text: "추정 시세를 입력해야 저장할 수 있습니다 — 시세가 없으면 이 부동산이 0원으로 계산돼 상속세 등 자산 평가가 과소 추정됩니다." });
      return;
    }
    if (!form.property_type) { setMsg({ ok: false, text: "물건 종류를 선택하세요." }); return; }
    if (!form.address && !form.complex_name) { setMsg({ ok: false, text: "주소 또는 단지명을 입력하세요." }); return; }
    setSaving(true);
    setMsg(null);
    const shareVal = Number(form.ownership_share) / 100;
    const { data, error } = await supabase.from("client_real_estate").insert([{
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
      official_price: null, // 폼에서 입력란 제거됨(어디서도 안 읽히는 필드) — DB 컬럼은 유지
      lease_type: form.lease_type,
      deposit: form.deposit ? Number(form.deposit) : null,
      monthly_rent: form.monthly_rent ? Number(form.monthly_rent) : null,
      source: "manual",
    }]).select().single();

    if (error || !data) {
      setMsg({ ok: false, text: `저장 실패: ${error?.message ?? "알 수 없는 오류"}` });
      setSaving(false);
      return;
    }

    // 3단계에서 입력한 대출 초안이 있으면 방금 저장된 물건에 이어 붙인다.
    if (addDebtDraft.balance) {
      await supabase.from("client_real_estate_debt").insert([{
        property_id: data.id,
        lender: addDebtDraft.lender || null,
        balance: Number(addDebtDraft.balance),
        interest_rate: addDebtDraft.interest_rate ? Number(addDebtDraft.interest_rate) : null,
        rate_type: addDebtDraft.rate_type || null,
        maturity_date: addDebtDraft.maturity_date || null,
        source: "manual",
        confidence: "medium",
      }]);
    }

    setMsg({ ok: true, text: "부동산 자산이 저장되었습니다." });
    await load();
    onAssetsChanged?.();
    setTimeout(() => { setMsg(null); resetAddWizard(); setTab("saved"); }, 800);
    setSaving(false);
  };

  const deleteProperty = async (id: string) => {
    if (!supabase) return;
    setDeletingProp(id);
    await supabase.from("client_real_estate").delete().eq("id", id);
    setProperties((p) => p.filter((x) => x.id !== id));
    setDebts((d) => d.filter((x) => x.property_id !== id));
    setDeletingProp(null);
    onAssetsChanged?.();
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
      onAssetsChanged?.();
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
        onAssetsChanged?.();
      }
    } catch {
      setLookupResult((prev) => ({ ...prev, [p.id]: { value: null, low: null, high: null, confidence: "low", source: "molit_realtxn", sampleSize: 0, note: "네트워크 오류", connected: false, freshness: "참고용" as const, areaBreakdown: [] } }));
    }
    setLookingUp(null);
  };

  const tabBar = (
    <div className="flex gap-1 mb-4 border-b border-border">
      {([["saved", `저장된 부동산${properties.length > 0 ? ` (${properties.length})` : ""}`], ["add", "부동산 추가"]] as const).map(([t, label]) => (
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

    // 압축 요약 바용 물건명 한 줄. 1~2건은 전부 보여준다. 3건부터는 항상 앞 2개 + "외 N건"으로
    // 줄인다 — 이름 3개를 다 넣으면 한 줄 폭에서 자주 모자라 글자가 중간에 잘리므로(예: "은..."),
    // 아예 짧은 형태로 고정해 잘림 없이 통째로 보이게 한다(그래도 넘치면 truncate가 "…"로 안전망).
    const propertyNames = properties.map((p) => p.complex_name || p.address || "주소 미입력");
    const propertyNameSummary =
      propertyNames.length <= 2
        ? propertyNames.join(" · ")
        : `${propertyNames.slice(0, 2).join(" · ")} 외 ${propertyNames.length - 2}건`;

    // 대출 추가/수정 폼 — "연결 대출 N건" 아코디언 안에서도, 대출이 하나도 없을 때도 재사용한다.
    const debtAddForm = (propertyId: string) => (
      <div className="rounded-lg border border-dashed border-border p-2.5 space-y-2">
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
              onClick={() => handleAddDebt(propertyId)}>
              {savingDebt ? "저장 중…" : "추가"}
            </button>
          </div>
        </div>
      </div>
    );

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
            {/* 압축 요약 바 — 평소엔 이것만 보임. 좌: 금액·건수 / 가운데: 물건명 / 우: 버튼 */}
            <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="shrink-0">
                <span className="text-lg font-bold text-fg">{formatW(totals.totalValue)}</span>
                <span className="ml-1.5 text-sm text-fg-muted">· {properties.length}채</span>
                {totals.totalDebt > 0 && (
                  <p className="mt-0.5 text-[11px] text-fg-muted">
                    부채 {formatW(totals.totalDebt)} · 순자산 {formatW(totals.totalEquity)}
                  </p>
                )}
              </div>
              <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">{propertyNameSummary}</p>
              <div className="flex shrink-0 gap-2">
                <button className="btn-primary text-sm py-1.5 px-4" onClick={() => setShowDetail((v) => !v)}>
                  {showDetail ? "접기" : "상세보기"}
                </button>
              </div>
            </div>

            {showDetail && (
            <>
            {/* 카드 목록 — 섹션 전체 폭 사용, 세로 나열(상단 압축 요약 바가 총계 역할을 대신하므로 별도 요약 패널 없음) */}
            <div className="grid grid-cols-1 gap-[14px]">
                {properties.map((p) => {
                  const pDebts = debts.filter((d) => d.property_id === p.id);
                  const m = deriveMetrics(p, pDebts);
                  const isExpanded = expandedDebt === p.id;
                  const isAddingDebt = debtFormProp === p.id;

                  return (
                    <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                      {/* 카드 헤더 */}
                      <div className="px-4 py-3">
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
                            <p className="text-sm font-semibold text-fg">
                              {p.complex_name || p.address || "주소 미입력"}
                              {p.area_m2 && <span className="text-xs font-normal text-fg-muted ml-1">{p.area_m2}m²</span>}
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
                                className="text-xs font-semibold px-2 py-1 rounded-lg bg-[#1428A0] text-white hover:bg-[#0f1e7a] disabled:opacity-50 transition-colors"
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
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                            <span className="font-semibold text-fg text-sm">{formatW(p.market_value)}</span>
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
                          <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1">
                            ⚠ 추정 시세 미입력 — 우측 &ldquo;시세 조회&rdquo; 버튼을 누르거나 직접 입력하세요.
                          </p>
                        )}

                        {/* 국토부 API 조회 결과 */}
                        {lookupResult[p.id] && (() => {
                          const res = lookupResult[p.id];
                          // 성공
                          if (res.value != null) return (
                            <div className="mt-2 text-xs px-2.5 py-1.5 rounded-lg border bg-green-50 border-green-200 text-green-700">
                              ✓ 국토부 실거래 {res.sampleSize}건 → {formatW(res.value)} 저장됨 · {res.note}
                            </div>
                          );
                          // 면적 불일치 — 같은 단지 면적 선택 UI
                          if (res.areaBreakdown && res.areaBreakdown.length > 0) return (
                            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
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
                                      className="flex flex-col items-start text-xs rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 hover:bg-[#1428A0] hover:text-white hover:border-[#1428A0] transition-colors group"
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
                            <div className="mt-2 text-xs px-2.5 py-1.5 rounded-lg border bg-red-50 border-red-200 text-red-600">
                              ✕ {res.note}
                            </div>
                          );
                        })()}

                        {/* 파생 지표 — 대출·임대 정보가 없으면 LTV/임대수익률 타일은 자리만 차지하므로 숨긴다.
                            카드가 좁아도 기본 3개 타일(지분가치/주담대+부채/순자산)은 항상 3열로 유지한다. */}
                        {(() => {
                          const priced = p.market_value != null;
                          const hasDebtInfo = priced && (m.totalDebt > 0 || m.depositLiability > 0);
                          const hasRentalYield = m.rentalYield != null;
                          const tiles: [string, string, string][] = [
                            ["지분 가치", priced ? formatW(m.myValue) : "—", "text-fg"],
                            ["주담대+부채", priced || m.totalDebt > 0 ? formatW(m.totalDebt + m.depositLiability) : "—", "text-red-500"],
                            ["순자산", priced ? formatW(m.equity) : "—", priced && m.equity < 0 ? "text-red-500" : "text-green-600"],
                          ];
                          if (hasDebtInfo) {
                            tiles.push(["LTV", pct(m.ltv), m.ltv != null && m.ltv > 0.8 ? "text-red-500" : m.ltv != null && m.ltv > 0.6 ? "text-amber-600" : "text-fg-muted"]);
                          }
                          if (hasRentalYield) {
                            tiles.push(["임대수익률", pct(m.rentalYield), "text-[#1428A0]"]);
                          }
                          // Tailwind JIT는 소스에 리터럴로 존재하는 클래스만 생성한다 — 템플릿 보간 금지.
                          const GRID_COLS: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };
                          return (
                            <div className={`mt-2 grid gap-1.5 text-center ${GRID_COLS[tiles.length] ?? "grid-cols-3"}`}>
                              {tiles.map(([label, val, cls]) => (
                                <div key={label} className="rounded-lg bg-surface-2 px-1 py-1.5">
                                  <p className="text-[8px] text-fg-muted mb-0.5 leading-tight">{label}</p>
                                  <p className={`text-xs font-bold ${cls}`}>{val}</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {/* 임대 정보 */}
                        {p.lease_type !== "none" && (
                          <p className="mt-1.5 text-xs text-fg-muted">
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

                      {/* 대출 섹션 — 등록된 대출이 있을 때만 아코디언(연결 대출 N건)을 보여준다.
                          없으면 "연결 대출 — 없음" 줄 자체를 그리지 않고, 추가 링크만 남긴다. */}
                      {pDebts.length > 0 ? (
                        <div className="border-t border-border">
                          <button
                            className="w-full flex items-center justify-between px-4 py-2 text-xs text-fg-muted hover:bg-surface-2 transition-colors"
                            onClick={() => setExpandedDebt(isExpanded ? null : p.id)}
                          >
                            <span><span className="font-semibold">연결 대출</span> {pDebts.length}건</span>
                            <span>{isExpanded ? "▲" : "▼"}</span>
                          </button>

                          {isExpanded && (
                            <div className="px-4 pb-3 space-y-1.5">
                              {pDebts.map((d) => (
                                <div key={d.id} className="flex items-center gap-3 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
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

                              {isAddingDebt ? debtAddForm(p.id) : (
                                <button className="text-xs text-[#1428A0] hover:underline font-medium"
                                  onClick={() => { setDebtFormProp(p.id); setExpandedDebt(p.id); }}>
                                  + 대출 추가
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="border-t border-border px-4 py-2">
                          {isAddingDebt ? debtAddForm(p.id) : (
                            <button className="text-xs text-[#1428A0] hover:underline font-medium"
                              onClick={() => setDebtFormProp(p.id)}>
                              + 대출 추가
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            <p className="text-[10px] text-fg-muted/70 text-center pt-2">
              ※ 추정시세는 실거래 기반 참고값입니다. 중요한 의사결정 전 감정평가·KB시세로 보정하세요.
            </p>
            </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── 부동산 추가 탭 — 조회(1) → 평형 선택(2) → 확인/저장(3) ──
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

  const STEP_LABEL: [typeof addStep, string][] = [
    ["search", "1. 조회 입력"],
    ["results", "2. 평형별 결과"],
    ["confirm", "3. 확인 후 저장"],
  ];

  return (
    <div>
      {tabBar}

      {/* 진행 표시 */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        {STEP_LABEL.map(([step, label], i) => (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && <span className="text-fg-muted">→</span>}
            <span className={`rounded-full px-3 py-1 font-semibold ${addStep === step ? "bg-[#1428A0] text-white" : "bg-surface-2 text-fg-muted"}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* 1단계 — 조회 입력: 지역 + 단지명만 */}
      {addStep === "search" && (
        <div className="max-w-md space-y-4">
          <div ref={lawdRef} className="relative">
            <label className="label">지역 선택 (법정동코드) *</label>
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

          <div>
            <label className="label">단지명 *</label>
            <input
              className="input"
              placeholder="예: 래미안 퍼스티지"
              value={searchComplexName}
              onChange={(e) => setSearchComplexName(e.target.value)}
            />
          </div>

          <button
            className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50"
            disabled={!form.legal_dong_code || !searchComplexName.trim() || searching}
            onClick={handleSearchComplex}
          >
            {searching ? "조회 중…" : "조회"}
          </button>
          {/* 지역은 타이핑만으로는 확정되지 않는다(드롭다운 항목을 눌러야 코드가 잡힌다).
              그 전까지 버튼이 비활성인데 이유가 화면에 없어 "검색이 안 된다"로 보였다. */}
          {!searching && (!form.legal_dong_code || !searchComplexName.trim()) && (
            <p className="text-xs text-fg-muted">
              {!form.legal_dong_code
                ? "지역을 목록에서 선택하세요 — 입력만으로는 법정동코드가 확정되지 않습니다."
                : "단지명을 입력하세요."}
            </p>
          )}
        </div>
      )}

      {/* 2단계 — 평형별 결과 */}
      {addStep === "results" && searchResult && (
        <div className="space-y-4">
          <button type="button" className="text-xs text-fg-muted hover:text-fg" onClick={() => setAddStep("search")}>← 다시 검색</button>

          {searchResult.areaBreakdown.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">전용면적</th>
                    <th className="px-4 py-2 text-right font-semibold">추정 시세</th>
                    <th className="px-4 py-2 text-right font-semibold">최근 거래건수</th>
                    <th className="px-4 py-2 text-center font-semibold">신뢰도</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {searchResult.areaBreakdown.map((area) => {
                    const confidence: MarketConf = area.sampleSize >= 3 ? "high" : area.sampleSize >= 1 ? "medium" : "low";
                    return (
                      <tr key={area.area} className="border-t border-border hover:bg-surface-2">
                        <td className="px-4 py-3 font-semibold text-fg whitespace-nowrap">
                          {area.area}㎡ <span className="font-normal text-fg-muted">({area.pyeong}평)</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-[#1428A0] whitespace-nowrap">{formatW(area.median)}</td>
                        <td className="px-4 py-3 text-right text-fg-muted whitespace-nowrap">{area.sampleSize}건</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${confidence === "high" ? "bg-green-50 text-green-700" : confidence === "low" ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-600"}`}>
                            {confidence === "high" ? "신뢰도 높음" : confidence === "low" ? "신뢰도 낮음" : "신뢰도 보통"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" className="btn-outline text-xs py-1 px-3" onClick={() => pickArea(area)}>선택</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              {searchResult.note || "일치하는 거래를 찾지 못했습니다."}
            </div>
          )}

          <button type="button" className="w-full btn-outline py-2.5 text-sm font-semibold" onClick={handleManualEntry}>
            직접 입력하기
          </button>
        </div>
      )}

      {/* 3단계 — 확인 후 저장 */}
      {addStep === "confirm" && (
        <div className="space-y-5">
          <button
            type="button"
            className="text-xs text-fg-muted hover:text-fg"
            onClick={() => setAddStep(manualEntry ? "search" : "results")}
          >
            ← {manualEntry ? "다시 검색" : "다른 평형 선택"}
          </button>

          <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
            <p className="text-sm font-semibold text-fg">{form.complex_name || "단지명 미입력"}</p>
            <p className="text-xs text-fg-muted mt-0.5">{lawdSearch || form.legal_dong_code}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label mb-0">전용면적</label>
                <div className="flex overflow-hidden rounded-lg border border-border text-[11px] font-semibold">
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
            </div>
            <div>
              <label className="label">추정 시세 (원) *</label>
              <input className="input" type="number" placeholder="예: 500000000"
                value={form.market_value}
                onChange={f("market_value")} />
              {form.market_value != "" && (
                <p className="text-xs text-fg-muted mt-0.5">{formatW(Number(form.market_value))}</p>
              )}
            </div>
          </div>

          {!manualEntry && form.market_confidence && (
            <p className="text-xs text-fg-muted">
              국토부 실거래 기반 · 신뢰도 {form.market_confidence === "high" ? "높음" : form.market_confidence === "low" ? "낮음" : "보통"} — PB가 필요하면 위 시세를 직접 조정할 수 있습니다.
            </p>
          )}

          {/* 대출 (있으면 여기서 추가 — 저장 시 물건과 함께 연결된다) */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">대출 (있으면 추가)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-[10px]">대출기관</label>
                <input className="input text-sm" placeholder="예: 국민은행"
                  value={addDebtDraft.lender}
                  onChange={(e) => setAddDebtDraft((p) => ({ ...p, lender: e.target.value }))} />
              </div>
              <div>
                <label className="label text-[10px]">대출 잔액 (원)</label>
                <input className="input text-sm" type="number" placeholder="0"
                  value={addDebtDraft.balance}
                  onChange={(e) => setAddDebtDraft((p) => ({ ...p, balance: e.target.value }))} />
              </div>
              <div>
                <label className="label text-[10px]">금리 (%)</label>
                <input className="input text-sm" type="number" placeholder="3.5"
                  value={addDebtDraft.interest_rate}
                  onChange={(e) => setAddDebtDraft((p) => ({ ...p, interest_rate: e.target.value }))} />
              </div>
              <div>
                <label className="label text-[10px]">만기일</label>
                <input className="input text-sm" type="date"
                  value={addDebtDraft.maturity_date}
                  onChange={(e) => setAddDebtDraft((p) => ({ ...p, maturity_date: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* 직접 입력 (접이식) — 나머지 필드는 지우지 않고 기본값으로 채운 채 접어둔다 */}
          <div className="rounded-xl border border-border">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-fg hover:bg-surface-2"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <span>직접 입력 (물건 종류·지분율·보유형태·용도·취득·임대 등)</span>
              <span className="text-fg-muted">{showAdvanced ? "▲" : "▼"}</span>
            </button>
            {showAdvanced && (
              <div className="space-y-4 border-t border-border p-4">
                <div className="grid grid-cols-2 gap-3">
                  {sel("물건 종류", "property_type", [
                    ["apartment", "아파트"], ["officetel", "오피스텔"], ["house", "단독/다가구"],
                    ["land", "토지"], ["presale_right", "분양권"],
                  ])}
                  {inp("주소", "address", "text", "예: 서울 서초구 반포동 1234")}
                  {sel("보유형태", "ownership_type", [["sole", "단독명의"], ["joint", "공동명의/지분"]])}
                  <div>
                    <label className="label">지분율 (%)</label>
                    <input className="input" type="number" placeholder="100" min={1} max={100}
                      value={form.ownership_share}
                      onChange={f("ownership_share")}
                      disabled={form.ownership_type === "sole"} />
                  </div>
                  {sel("용도", "usage", [
                    ["primary_residence", "실거주"], ["rental", "임대"], ["investment", "투자"],
                  ])}
                  {inp("취득일", "acquired_at", "date")}
                  {inp("취득가액 (원)", "acquired_price", "number", "0")}
                  {sel("임대형태", "lease_type", [
                    ["none", "없음 (직접 거주·공실)"], ["jeonse", "전세"], ["monthly", "월세"],
                  ])}
                  {form.lease_type !== "none" && inp("보증금 (원)", "deposit", "number", "0")}
                  {form.lease_type === "monthly" && inp("월세 (원/월)", "monthly_rent", "number", "0")}
                  {inp("시세 하한 (원)", "market_value_low", "number", "")}
                  {inp("시세 상한 (원)", "market_value_high", "number", "")}
                  {sel("시세 출처", "market_source", [
                    ["manual", "수동 입력"], ["molit_realtxn", "국토부 실거래"],
                    ["public_price", "공시가격"], ["kb", "KB시세"],
                  ])}
                  {sel("신뢰도", "market_confidence", [
                    ["high", "높음"], ["medium", "보통"], ["low", "낮음"],
                  ])}
                </div>
              </div>
            )}
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
        </div>
      )}
    </div>
  );
}
