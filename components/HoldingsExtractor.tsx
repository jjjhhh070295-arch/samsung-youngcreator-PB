"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Holding, ExtractResult, Confidence } from "@/lib/validate-holdings";
import { computeRow } from "@/lib/pricing/types";
import { formatKRWShort } from "@/lib/format";
import { pickAutoSelection, type LookupHit } from "@/lib/instruments/lookup";

interface Props {
  clientId: string;
}

// Supabase에서 가져오는 정적 데이터
interface SavedHolding {
  id: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
  confidence: string | null;
  source: string;
  created_at: string;
}

// 시세 조회 후 계산된 표시용 데이터
interface SavedWithPrice extends SavedHolding {
  live_price: number | null;
  eval_amount: number | null;
  pnl: number | null;
  return_pct: number | null;
  priced: boolean;
}

type Row = Omit<Holding, "eval_amount" | "pnl_amount" | "return_pct"> & { _key: string };

type Confidence_ = Confidence;

function newRow(): Row {
  return {
    _key: Math.random().toString(36).slice(2),
    name: "",
    ticker: null,
    market: null,
    currency: "KRW",
    quantity: 0,
    avg_price: null,
    current_price: null,
    confidence: "medium",
    notes: null,
    validation: "ok",
  };
}

function toRows(holdings: Holding[]): Row[] {
  return holdings.map((h) => ({
    _key: Math.random().toString(36).slice(2),
    name: h.name,
    ticker: h.ticker,
    market: h.market,
    currency: h.currency,
    quantity: h.quantity,
    avg_price: h.avg_price,
    current_price: h.current_price,
    confidence: h.confidence,
    notes: h.notes,
    validation: h.validation,
  }));
}

const fmt = (n: number | null, decimals = 0) =>
  n == null ? "—" : n.toLocaleString("ko-KR", { maximumFractionDigits: decimals });

export default function HoldingsExtractor({ clientId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"saved" | "extract" | "manual">("saved");

  // ── 직접 추가 폼 ──
  const emptyForm = () => ({ name: "", ticker: "", market: "", currency: "KRW", quantity: "", avg_price: "" });
  const [form, setForm] = useState(emptyForm());
  const [manualSaving, setManualSaving] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 종목명 → 코드 조회 상태(직접 추가 폼).
  // idle=아직 조회 안 함, checking=조회 중, found=코드 확정, choose=후보 여러 개,
  // not_found=검색 결과 없음.
  //
  // 예전에는 onBlur 로 한 번만 조회하고 코드가 잡히면 코드 입력란을 숨겼다. 두 가지가
  // 문제였다 — ① 후보가 여러 개일 때 고를 방법이 없다 ② 자동 매핑이 틀려도 고칠 수 없다.
  // 이제 타이핑 중 검색해 후보를 보여주고, 코드 입력란은 항상 열어 둔다.
  const [nameResolve, setNameResolve] = useState<
    "idle" | "checking" | "found" | "choose" | "not_found"
  >("idle");
  const [hits, setHits] = useState<LookupHit[]>([]);
  /** 실시간 검색이 죽어 정적 맵으로 답한 경우 사용자에게 한계를 알린다. */
  const [lookupSource, setLookupSource] = useState<"naver" | "static" | "none">("none");
  // 타이핑마다 요청이 나가지 않게 디바운스하고, 늦게 온 이전 응답이 최신 결과를
  // 덮어쓰지 않게 이전 요청을 취소한다. 상대가 비공식 엔드포인트라 특히 조심한다.
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupAbort = useRef<AbortController | null>(null);

  // ── 저장된 종목 ──
  const [saved, setSaved] = useState<SavedHolding[]>([]);
  const [priceMap, setPriceMap] = useState<Map<string, number | null>>(new Map());
  const [fxUsdKrw, setFxUsdKrw] = useState(1350);
  const [kisConnected, setKisConnected] = useState<boolean | null>(null); // null=미조회
  const [priceLoading, setPriceLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const fetchPrices = useCallback(async (holdings: SavedHolding[]) => {
    const tickers = holdings
      .filter((h) => h.ticker)
      .map((h) => ({ ticker: h.ticker!, currency: (h.currency === "USD" ? "USD" : "KRW") as "KRW" | "USD" }));
    console.log("[fetchPrices] 조회 요청 종목코드:", tickers.map((t) => t.ticker));
    if (tickers.length === 0) {
      console.warn("[fetchPrices] 종목코드 없음 → /api/prices 호출 안 함, kisConnected=false");
      setKisConnected(false);
      return;
    }
    setPriceLoading(true);
    try {
      const res = await fetch("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      const json = await res.json();
      setKisConnected(!!json.connected);
      setFxUsdKrw(json.fxUsdKrw ?? 1350);
      const map = new Map<string, number | null>();
      for (const q of json.quotes ?? []) map.set(q.ticker, q.price ?? null);
      setPriceMap(map);
    } catch {
      setKisConnected(false);
    } finally {
      setPriceLoading(false);
    }
  }, []);

  // 코드 없는 종목에 자동으로 종목코드 매핑 (종목명 → 코드 서버 조회)
  const autoResolveTickers = useCallback(async (holdings: SavedHolding[]) => {
    if (!supabase) return holdings;
    const noTicker = holdings.filter((h) => !h.ticker);
    if (noTicker.length === 0) return holdings;
    console.log("[autoResolveTickers] 코드 없는 종목:", noTicker.map((h) => `${h.name}(${h.currency})`));

    try {
      const res = await fetch("/api/resolve-tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: noTicker.map((h) => h.name) }),
      });
      const json = await res.json();
      const tickerMap: Record<string, string | null> = json.tickers ?? {};
      console.log("[autoResolveTickers] 매핑 결과:", tickerMap);

      // 매핑된 종목만 Supabase 업데이트
      const updates = noTicker.filter((h) => tickerMap[h.name]);
      await Promise.all(
        updates.map((h) =>
          supabase!.from("client_holdings").update({ ticker: tickerMap[h.name] }).eq("id", h.id),
        ),
      );

      // 로컬 상태도 즉시 반영
      return holdings.map((h) =>
        tickerMap[h.name] ? { ...h, ticker: tickerMap[h.name] } : h,
      );
    } catch (e) {
      console.error("[autoResolveTickers] 오류:", e);
      return holdings;
    }
  }, [supabase]);

  // 수동 "코드 자동 매핑" 버튼 핸들러
  const handleAutoResolve = async () => {
    setResolving(true);
    setResolveMsg(null);
    const updated = await autoResolveTickers(saved);
    setSaved(updated);
    const found = updated.filter((h) => h.ticker).length;
    const total  = updated.length;
    setResolveMsg(`${found}/${total}개 코드 매핑 완료`);
    fetchPrices(updated);
    setResolving(false);
  };

  const loadSaved = useCallback(async () => {
    if (!supabase) { setSavedLoading(false); return; }
    setSavedLoading(true);
    const { data } = await supabase
      .from("client_holdings")
      .select("id, name, ticker, market, currency, quantity, avg_price, confidence, source, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    let rows = (data as SavedHolding[]) ?? [];
    setSaved(rows);
    setSavedLoading(false);
    // 코드 없는 종목 자동 매핑 시도
    rows = await autoResolveTickers(rows);
    setSaved(rows);
    fetchPrices(rows);
  }, [clientId, fetchPrices, autoResolveTickers]);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const savedWithPrices: SavedWithPrice[] = saved.map((h) => {
    const live_price = h.ticker ? (priceMap.get(h.ticker) ?? null) : null;
    const computed = computeRow({ quantity: h.quantity, avg_price: h.avg_price, currency: h.currency }, { price: live_price }, fxUsdKrw);
    return {
      ...h,
      live_price,
      eval_amount: computed.evalAmount,
      pnl: computed.pnl,
      return_pct: computed.returnPct,
      priced: computed.priced,
    };
  });

  // 비중(%) = 평가금액 / 전체 평가금액 합계 × 100. 평가금액 못 구한 종목은 분모·분자 모두 제외(— 표시).
  // 반올림 오차는 비중이 가장 큰 종목에서 흡수해 합계가 정확히 100.0%가 되게 한다.
  const totalEval = savedWithPrices.reduce((sum, h) => sum + (h.eval_amount ?? 0), 0);
  const rawWeights = savedWithPrices.map((h) =>
    h.eval_amount != null && totalEval > 0 ? (h.eval_amount / totalEval) * 100 : null,
  );
  const roundedWeights = rawWeights.map((w) => (w == null ? null : Math.round(w * 10) / 10));
  const weightSum = roundedWeights.reduce((s: number, w) => s + (w ?? 0), 0);
  const diff = Math.round((100 - weightSum) * 10) / 10;
  if (Math.abs(diff) >= 0.05) {
    let maxIdx = -1;
    let maxW = -Infinity;
    roundedWeights.forEach((w, i) => {
      if (w != null && w > maxW) { maxW = w; maxIdx = i; }
    });
    if (maxIdx >= 0) roundedWeights[maxIdx] = Math.round(((roundedWeights[maxIdx] ?? 0) + diff) * 10) / 10;
  }
  const savedWithWeights = savedWithPrices
    .map((h, i) => ({ ...h, weightPct: roundedWeights[i] }))
    .sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));

  const deleteHolding = async (id: string) => {
    if (!supabase) return;
    setDeleting(id);
    await supabase.from("client_holdings").delete().eq("id", id);
    setSaved((prev) => prev.filter((h) => h.id !== id));
    setDeleting(null);
  };

  // ── 추출 상태 ──
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [phase, setPhase] = useState<"idle" | "analyzing" | "review">("idle");
  const [broker, setBroker] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    const next = arr.map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    setImages((prev) => [...prev, ...next].slice(0, 10));
  }, []);

  const removeImage = (i: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const analyze = async () => {
    if (!images.length) return;
    setError(null);
    setPhase("analyzing");
    try {
      const encoded = await Promise.all(
        images.map(
          (img) =>
            new Promise<{ mime_type: string; data: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                const [header, data] = dataUrl.split(",");
                const mime_type = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
                resolve({ mime_type, data });
              };
              reader.onerror = reject;
              reader.readAsDataURL(img.file);
            })
        )
      );

      const res = await fetch("/api/extract-holdings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: encoded }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "추출 실패");
        setPhase("idle");
        return;
      }

      const { holdings, warnings: warns, broker: b } = json as ExtractResult;
      setBroker(b ?? null);
      setRows(toRows(holdings));
      setWarnings(warns ?? []);
      setPhase("review");
    } catch {
      setError("네트워크 오류");
      setPhase("idle");
    }
  };

  const updateRow = (key: string, field: keyof Row, value: unknown) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
  };

  const deleteRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r._key !== key));
  };

  // v2: 정적 필드만 저장
  const handleSave = async () => {
    if (!supabase) {
      setSaveMsg({ ok: false, text: "Supabase 연결 없음 — 로컬 모드에서는 저장 불가" });
      return;
    }
    setSaving(true);
    setSaveMsg(null);

    const inserts = rows
      .filter((r) => r.name.trim())
      .map(({ _key: _k, validation: _v, current_price: _cp, notes: _n, ...r }) => ({
        client_id: clientId,
        owner_party_id: clientId,
        name: r.name.trim(),
        ticker: r.ticker || null,
        market: r.market || null,
        currency: r.currency,
        quantity: Number(r.quantity) || 0,
        avg_price: r.avg_price != null ? Number(r.avg_price) : null,
        source: "ocr",
        confidence: r.confidence,
      }));

    const { error: err } = await supabase.from("client_holdings").insert(inserts);
    if (err) {
      setSaveMsg({ ok: false, text: `저장 실패: ${err.message}` });
    } else {
      setSaveMsg({ ok: true, text: `${inserts.length}개 종목 저장 완료` });
      await loadSaved();
      setTimeout(() => { reset(); setTab("saved"); }, 800);
    }
    setSaving(false);
  };

  const reset = () => {
    images.forEach((img) => URL.revokeObjectURL(img.url));
    setImages([]);
    setPhase("idle");
    setBroker(null);
    setRows([]);
    setWarnings([]);
    setSaveMsg(null);
    setError(null);
  };

  /** 후보 1건을 폼에 반영한다. 목록에서 고르거나 정확 일치로 자동 확정될 때 쓴다. */
  const applyHit = (hit: LookupHit) => {
    setForm((p) => ({
      ...p,
      name: hit.name,           // 네이버 표기로 정규화한다("jyp" → "JYP Ent.")
      ticker: hit.code,
      market: hit.market,
      currency: hit.currency,
    }));
    setHits([]);
    setNameResolve("found");
  };

  // 종목명 입력 중 실시간 검색(/api/instruments/lookup). 디바운스 300ms.
  //
  // 코드만 받고 시세는 건드리지 않는다 — 현재가는 저장 후 기존 KIS 경로(/api/prices)가
  // 계산한다. 검색 단계에서 시세를 섞으면 타이핑 한 번에 시세 API 가 수십 번 나간다.
  const runLookup = useCallback((raw: string) => {
    const q = raw.trim();
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupAbort.current?.abort();

    if (q.length < 2) { setHits([]); setNameResolve("idle"); return; }

    setNameResolve("checking");
    lookupTimer.current = setTimeout(async () => {
      const ac = new AbortController();
      lookupAbort.current = ac;
      try {
        const res = await fetch(`/api/instruments/lookup?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        const json = await res.json();
        const results: LookupHit[] = Array.isArray(json?.results) ? json.results : [];
        setLookupSource(json?.source ?? "none");

        // 고를 여지가 없으면 자동 확정한다 — 후보가 1건이거나, 정확 일치가 1건일 때.
        // "삼성전자"는 관련 ETF 9건과 같이 와도 정확 일치는 보통주 1건이고,
        // "두산퓨얼셀"도 우선주가 같이 오지만 정확 일치는 보통주뿐이라 바로 잡힌다.
        const exact = pickAutoSelection(q, results);
        if (exact) { applyHit(exact); return; }

        setHits(results);
        setNameResolve(results.length > 0 ? "choose" : "not_found");
      } catch (e: any) {
        if (e?.name === "AbortError") return; // 다음 타이핑이 이어받는다
        // 라우트가 폴백까지 실패해도 코드 직접 입력 경로는 열려 있다.
        setHits([]);
        setNameResolve("not_found");
      }
    }, 300);
  }, []);

  // 언마운트 시 예약된 조회와 진행 중 요청을 정리한다.
  useEffect(() => () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupAbort.current?.abort();
  }, []);

  const handleManualSave = async () => {
    if (!form.name.trim() || !form.quantity) return;
    if (!form.ticker.trim()) {
      setManualMsg({ ok: false, text: "종목코드가 필요합니다. 자동으로 안 채워졌다면 코드를 직접 입력해주세요." });
      return;
    }
    if (!supabase) { setManualMsg({ ok: false, text: "Supabase 연결 없음" }); return; }
    setManualSaving(true);
    setManualMsg(null);
    const { error: err } = await supabase.from("client_holdings").insert([{
      client_id: clientId,
      owner_party_id: clientId,
      name: form.name.trim(),
      ticker: form.ticker || null,
      market: form.market || null,
      currency: form.currency,
      quantity: Number(form.quantity) || 0,
      avg_price: form.avg_price ? Number(form.avg_price) : null,
      source: "manual",
      confidence: "high",
    }]);
    if (err) {
      setManualMsg({ ok: false, text: `저장 실패: ${err.message}` });
    } else {
      setManualMsg({ ok: true, text: "저장 완료" });
      setForm(emptyForm());
      setNameResolve("idle");
      setHits([]);
      setLookupSource("none");
      await loadSaved();
      setTimeout(() => { setManualMsg(null); setTab("saved"); }, 800);
    }
    setManualSaving(false);
  };

  // ── 탭 바 ──
  const tabBar = (
    <div className="flex gap-1 mb-4 border-b border-border">
      {(["saved", "extract", "manual"] as const).map((t) => {
        const labels = { saved: `저장된 종목${saved.length > 0 ? ` (${saved.length})` : ""}`, extract: "MTS 추출", manual: "직접 추가" };
        return (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${t === tab ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {labels[t]}
          </button>
        );
      })}
    </div>
  );

  // ── 저장된 종목 탭 ──
  if (tab === "saved") {
    const kisStatus = kisConnected === null ? null : kisConnected;
    return (
      <div>
        {tabBar}
        {savedLoading ? (
          <p className="py-8 text-center text-sm text-fg-muted">불러오는 중…</p>
        ) : saved.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-fg-muted mb-3">저장된 보유종목이 없습니다.</p>
            <button className="btn-primary text-sm px-5" onClick={() => setTab("extract")}>MTS 캡쳐로 추출하기</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="text-xs text-fg-muted">총 {saved.length}개 종목</p>
                {priceLoading && <span className="text-xs text-fg-muted/70 animate-pulse">시세 조회 중…</span>}
                {!priceLoading && kisStatus === false && (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 border border-gray-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-400 inline-block" />
                      시세 미연결
                    </span>
                    <button
                      className="text-xs px-2 py-0.5 rounded-full border border-blue-200 text-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50"
                      disabled={resolving}
                      onClick={handleAutoResolve}
                    >
                      {resolving ? "매핑 중…" : "코드 자동 매핑"}
                    </button>
                    {resolveMsg && (
                      <span className="text-xs text-green-600">{resolveMsg}</span>
                    )}
                  </>
                )}
                {!priceLoading && kisStatus === true && (
                  <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-600 rounded-full px-2 py-0.5 border border-green-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
                    KIS 실시간
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button className="btn-outline text-xs py-1 px-3" onClick={() => setTab("extract")}>+ 새로 추출</button>
                <button className="text-xs py-1 px-3 rounded-lg border border-red-300 text-red-500 hover:bg-red-50 transition-colors" onClick={() => setDeleteAllOpen(true)}>전체 삭제</button>
              </div>
            </div>

            {deleteAllOpen && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-700 mb-2">보유종목 전체를 삭제할까요?</p>
                <p className="text-xs text-red-500 mb-3">저장된 {saved.length}개 종목이 모두 삭제됩니다. 되돌릴 수 없습니다.</p>
                <div className="flex gap-2">
                  <button className="btn-ghost text-xs px-4 py-1.5" onClick={() => setDeleteAllOpen(false)}>취소</button>
                  <button
                    className="text-xs px-4 py-1.5 rounded-lg bg-red-500 text-white font-bold hover:bg-red-600 transition-colors disabled:opacity-50"
                    disabled={deleting === "all"}
                    onClick={async () => {
                      if (!supabase) return;
                      setDeleting("all");
                      await supabase.from("client_holdings").delete().eq("client_id", clientId);
                      setSaved([]);
                      setDeleting(null);
                      setDeleteAllOpen(false);
                    }}
                  >
                    {deleting === "all" ? "삭제 중…" : "전체 삭제"}
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-2 text-fg-muted">
                    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[100px]">종목</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">수량</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">평균단가</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">현재가</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">평가금액</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">비중</th>
                    <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">평가손익</th>
                    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">신뢰도</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {savedWithWeights.map((h) => (
                    <tr key={h.id} className="border-t border-border hover:bg-surface-2 transition-colors">
                      {/* 종목: 이름+시장 배지 / 코드·통화 — 표시만 합침, 데이터는 그대로 */}
                      <td className="px-3 py-2 whitespace-nowrap min-w-[100px]">
                        <div className="flex items-center gap-1.5 font-medium text-fg">
                          <span>{h.name}</span>
                          {h.market && <span className="badge-muted text-[10px]">{h.market}</span>}
                        </div>
                        <div className="mt-0.5 text-[10px] text-fg-muted">
                          {h.ticker ?? "—"} · {h.currency}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">{fmt(h.quantity)}</td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">{fmt(h.avg_price)}</td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">
                        {h.live_price != null ? fmt(h.live_price) : <span className="text-fg-muted/50">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">
                        {h.priced && h.eval_amount != null ? formatKRWShort(h.eval_amount) : <span className="text-fg-muted/50">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-fg tabular-nums">
                        {h.weightPct != null ? `${h.weightPct.toFixed(1)}%` : <span className="text-fg-muted/50">—</span>}
                      </td>
                      {/* 평가손익: 금액(굵게) / 수익률%(작게) — 표시만 합침 */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {h.priced && h.pnl != null ? (
                          <>
                            <div className={`font-medium ${(h.pnl ?? 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                              {(h.pnl >= 0 ? "+" : "") + formatKRWShort(h.pnl)}
                            </div>
                            {h.return_pct != null && (
                              <div className={(h.return_pct ?? 0) >= 0 ? "text-green-600" : "text-red-500"}>
                                {(h.return_pct >= 0 ? "+" : "") + h.return_pct.toFixed(2) + "%"}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-fg-muted/50">—</span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${h.confidence === "low" ? "text-amber-600" : h.confidence === "high" ? "text-green-600" : "text-fg-muted"}`}>
                        {h.confidence === "high" ? "높음" : h.confidence === "low" ? "낮음" : "보통"}
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => deleteHolding(h.id)} disabled={deleting === h.id} className="text-red-400 hover:text-red-600 font-bold disabled:opacity-40">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10px] text-fg-muted/70">
              {kisStatus ? "현재가 · 평가금액 · 손익 — KIS OpenAPI 실시간 조회" : "현재가 · 평가금액 · 손익 — KIS API 키 등록 후 표시됩니다"}
            </p>
          </>
        )}
      </div>
    );
  }

  // ── 직접 추가 탭 ──
  if (tab === "manual") {
    const field = (key: string, label: string, type = "text", placeholder = "") => (
      <div>
        <label className="label">{label}</label>
        <input
          className="input"
          type={type}
          placeholder={placeholder}
          value={(form as Record<string, string>)[key]}
          onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
        />
      </div>
    );
    return (
      <div>
        {tabBar}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">종목명 *</label>
              <input
                className="input"
                type="text"
                placeholder="예: 삼성전자"
                value={form.name}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((p) => ({ ...p, name: v }));
                  runLookup(v);
                }}
              />
              {nameResolve === "checking" && (
                <p className="mt-1 text-xs text-fg-muted">검색 중…</p>
              )}
              {nameResolve === "found" && (
                <p className="mt-1 text-xs text-fg-muted">
                  {form.name.trim()} · {form.ticker} · {form.currency}
                  {form.market ? ` · ${form.market}` : ""}
                </p>
              )}
              {nameResolve === "not_found" && (
                <p className="mt-1 text-xs text-amber-600">
                  검색 결과가 없습니다. 아래에 종목코드를 직접 입력해주세요
                </p>
              )}
              {/* 후보가 여럿이면 고르게 한다. 접두사가 겹치는 다른 회사를 임의로
                  집어 버리는 사고(두산퓨얼셀 → 두산)를 UI 에서도 막는다. */}
              {nameResolve === "choose" && hits.length > 0 && (
                <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-white">
                  {hits.slice(0, 8).map((h) => (
                    <button
                      key={`${h.nation}-${h.code}`}
                      type="button"
                      onClick={() => applyHit(h)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2"
                    >
                      <span className="truncate font-medium text-fg">
                        {h.name}
                        {h.kind === "우선주" && (
                          <span className="ml-1 text-[10px] text-amber-600">우선주</span>
                        )}
                      </span>
                      <span className="shrink-0 text-fg-muted">
                        {h.code} · {h.market}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {lookupSource === "static" && nameResolve !== "idle" && (
                <p className="mt-1 text-xs text-amber-600">
                  실시간 검색에 연결하지 못해 간이 목록에서 찾았습니다. 결과가 없으면 코드를 직접 입력해주세요
                </p>
              )}
            </div>
            {field("quantity", "수량 *", "number", "0")}
            {field("avg_price", "평균단가", "number", "0")}
            {/* 코드·시장·통화는 항상 열어 둔다. 예전에는 자동 매핑이 성공하면 숨겼는데,
                그러면 매핑이 틀렸을 때 사용자가 고칠 방법이 없었다. */}
            {field("ticker", "종목코드 *", "text", "예: 005930 / NVDA")}
            {field("market", "시장", "text", "KOSPI / KOSDAQ / NASDAQ")}
            <div>
              <label className="label">통화</label>
              <select className="input" value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}>
                <option value="KRW">KRW</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-fg-muted/70">※ 현재가 · 평가금액 · 손익은 저장 시 생략되며, 조회 시 KIS API로 실시간 계산됩니다.</p>

          {manualMsg && (
            <p className={`rounded-lg px-4 py-2 text-sm font-medium ${manualMsg.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {manualMsg.ok ? "✓ " : "✕ "}{manualMsg.text}
            </p>
          )}
          <button
            className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50"
            disabled={!form.name.trim() || !form.quantity || !form.ticker.trim() || manualSaving}
            onClick={handleManualSave}
          >
            {manualSaving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    );
  }

  // ── 이미지 패널 (MTS 추출 탭 공통) ──
  const imagePanel = (
    <div className="flex flex-col gap-2 w-full md:w-[58%] shrink-0">
      {/* 헤더: 추가 버튼 + 장수 + 전체삭제 */}
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-border text-xs text-fg-muted hover:border-[#1428A0] hover:text-[#1428A0] transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          📎 캡쳐 추가
        </button>
        {images.length > 0 && (
          <>
            <span className="text-xs text-fg-muted">{images.length}장</span>
            <button
              className="ml-auto text-xs text-red-400 hover:text-red-600 transition-colors"
              onClick={() => {
                images.forEach((img) => URL.revokeObjectURL(img.url));
                setImages([]);
              }}
            >
              전체 삭제
            </button>
          </>
        )}
      </div>

      {/* 이미지 목록: 패널 폭을 꽉 채우고, 컨테이너 높이를 제한해 내부 스크롤 */}
      <div className="flex flex-col gap-3 overflow-y-auto max-h-[55vh] md:max-h-[65vh]">
        {images.map((img, i) => (
          <div key={img.url} className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={`캡쳐 ${i + 1}`}
              className="w-full rounded-xl border border-border bg-surface-2 cursor-zoom-in shadow-card"
              onClick={() => window.open(img.url, "_blank")}
            />
            {/* 삭제 버튼: 항상 표시, 이미지 우상단 */}
            <button
              className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/40 hover:bg-red-500 text-white text-xs font-bold flex items-center justify-center shadow transition-colors"
              onClick={(e) => { e.stopPropagation(); removeImage(i); }}
              title="이 사진 삭제"
            >✕</button>
            <p className="text-[9px] text-center text-fg-muted mt-1">
              {i + 1} / {images.length} · 클릭하면 원본 크게 보기
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  // ── 검수 테이블 (review) ──
  if (phase === "review") {
    const lowCount = rows.filter((r) => r.confidence === "low").length;

    return (
      <div>
        {tabBar}
        <div className="flex flex-col md:flex-row gap-5 items-start">
          {imagePanel}
          <div className="w-full md:flex-1 md:min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-fg">
                  {broker ? `${broker} · ` : ""}추출된 보유종목 {rows.length}개
                </p>
                <p className="text-xs text-fg-muted mt-0.5">
                  {images.length}장 분석 완료 ·{" "}
                  {lowCount > 0 && <span className="text-amber-600">신뢰도 낮음 {lowCount}건 </span>}
                  셀 클릭해 수정 후 확정하세요.
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn-outline text-sm" onClick={reset}>다시 업로드</button>
                <button className="btn-outline text-sm" onClick={() => setRows((prev) => [...prev, newRow()])}>+ 행 추가</button>
                <button className="btn-primary text-sm px-5" onClick={handleSave} disabled={saving || rows.length === 0}>
                  {saving ? "저장 중…" : "확정 저장"}
                </button>
              </div>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-700 space-y-0.5">
                {warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
              </div>
            )}

            {saveMsg && (
              <div className={`rounded-lg px-4 py-2 text-sm font-medium ${saveMsg.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                {saveMsg.ok ? "✓ " : "✕ "}{saveMsg.text}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs table-fixed">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[12%]" />
                  <col className="w-[13%]" />
                  <col className="w-[20%]" />
                  <col className="w-[10%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <thead>
                  <tr className="bg-surface-2 text-fg-muted">
                    {["종목명", "통화", "수량", "평균단가", "신뢰도", ""].map((h) => (
                      <th key={h} className="px-2 py-2 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isLow = row.confidence === "low";
                    const isWarn = row.validation === "warn";
                    const rowCls = isWarn
                      ? "bg-red-50 border-l-2 border-red-400"
                      : isLow
                      ? "bg-amber-50"
                      : "hover:bg-surface-2";

                    return (
                      <tr key={row._key} className={`border-t border-border transition-colors ${rowCls}`}>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full bg-transparent outline-none border-b border-transparent focus:border-[#1428A0] text-fg font-medium truncate"
                            value={row.name}
                            onChange={(e) => updateRow(row._key, "name", e.target.value)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className="bg-transparent outline-none text-fg-muted w-full"
                            value={row.currency}
                            onChange={(e) => updateRow(row._key, "currency", e.target.value)}
                          >
                            <option>KRW</option>
                            <option>USD</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            className="w-full bg-transparent outline-none border-b border-transparent focus:border-[#1428A0] text-fg text-right"
                            value={row.quantity != null ? String(row.quantity) : ""}
                            onChange={(e) => updateRow(row._key, "quantity", e.target.value === "" ? 0 : Number(e.target.value))}
                            type="number"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            className="w-full bg-transparent outline-none border-b border-transparent focus:border-[#1428A0] text-fg text-right"
                            value={row.avg_price != null ? String(row.avg_price) : ""}
                            onChange={(e) => updateRow(row._key, "avg_price", e.target.value === "" ? null : Number(e.target.value))}
                            placeholder="—"
                            type="number"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={`bg-transparent outline-none text-xs font-medium w-full ${row.confidence === "low" ? "text-amber-600" : row.confidence === "medium" ? "text-fg-muted" : "text-green-600"}`}
                            value={row.confidence}
                            onChange={(e) => updateRow(row._key, "confidence", e.target.value as Confidence_)}
                          >
                            <option value="high">높음</option>
                            <option value="medium">보통</option>
                            <option value="low">낮음</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => deleteRow(row._key)} className="text-red-400 hover:text-red-600 font-bold" title="삭제">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-fg-muted">추출된 종목이 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-fg-muted/70">
              ※ 현재가·평가금액·손익은 저장 후 KIS API로 실시간 계산됩니다. 신뢰도 낮음(황색)·검증 실패(적색) 행은 원본과 대조 확인 후 저장하세요.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 업로드 화면 (idle / analyzing) ──
  return (
    <div>
      {tabBar}
      <div className="flex flex-col md:flex-row gap-5 items-start">
        {imagePanel}
        <div className="w-full md:flex-1 flex flex-col gap-4 justify-center" style={{ minHeight: "300px" }}>
          {images.length === 0 ? (
            <div
              className={`rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-16 gap-3 cursor-pointer transition-colors ${dragOver ? "border-[#1428A0] bg-blue-50" : "border-border bg-surface-2"}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <p className="text-3xl">📎</p>
              <p className="text-sm font-medium text-fg-muted">MTS 캡쳐를 여기에 드래그하거나 왼쪽 버튼을 클릭하세요</p>
              <p className="text-xs text-fg-muted/70">키움, 삼성 mPOP, 미래에셋, NH나무, 토스 등 · 최대 10장</p>
            </div>
          ) : (
            <>
              {error && <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs text-red-600">✕ {error}</p>}
              <button
                className="w-full btn-primary py-4 text-base font-bold disabled:opacity-50"
                disabled={phase === "analyzing"}
                onClick={analyze}
              >
                {phase === "analyzing" ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Gemini 분석 중…
                  </span>
                ) : `보유종목 자동 추출 (${images.length}장)`}
              </button>
              <p className="text-[10px] text-fg-muted/70 text-center">
                ※ 캡쳐 원본은 분석 후 즉시 폐기됩니다. 자동 저장되지 않으며 검수 후 PB가 확정합니다.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
