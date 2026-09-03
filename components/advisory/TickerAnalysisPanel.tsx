"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type {
  EvidenceBundle,
  TickerLiveQuote,
  TickerProfile,
  TickerSnapshot,
} from "@/lib/advisory/types";
import type { EnrichedBar } from "@/lib/advisory/tickerIndicatorsExtended";
import { enrichBars, streakMarkers, volumeProfile } from "@/lib/advisory/tickerIndicatorsExtended";
import { aggregateOhlcBars, type OhlcTimeframe, timeframeLabel } from "@/lib/advisory/ohlcAggregate";
import type { OhlcBar } from "@/lib/advisory/ohlcTypes";
import type { FinancialSnapshot, InvestorFlowSeries } from "@/lib/advisory/ohlcTypes";
import { appendRun, loadBundle, saveBundle } from "@/lib/advisory/control";
import {
  DEFAULT_ANALYSIS_PRESETS,
  enabledIndicators,
  overlayIndicators,
  panelIndicators,
  type TickerAnalysisPresets,
} from "@/lib/advisory/tickerAnalysisPresets";
import {
  loadActivePresetId,
  loadAnalysisPresets,
  loadDrawings,
  saveActivePresetId,
  saveAnalysisPresets,
  saveDrawings,
} from "@/lib/advisory/tickerPrefsStorage";
import type { DrawingDocument } from "@/lib/advisory/drawingTypes";
import { TickerCandleChart, type TickerCandleChartHandle } from "./TickerCandleChart";
import { TickerIndicatorPanels } from "./TickerIndicatorPanels";
import { TickerAnalysisPresetsDrawer } from "./TickerAnalysisPresetsDrawer";
import {
  TickerMultiChartPanel,
  type MultiChartEntry,
  useMultiChartEntries,
} from "./TickerMultiChartPanel";

function toOhlcBar(bar: EnrichedBar): OhlcBar {
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function barsForTimeframe(dailyBars: EnrichedBar[], timeframe: OhlcTimeframe): EnrichedBar[] {
  const raw = dailyBars.map(toOhlcBar);
  const aggregated = aggregateOhlcBars(raw, timeframe);
  return enrichBars(aggregated.slice(-260));
}

function formatAsOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) + " (KST)"
  );
}

function formatMetric(m: { value: number; unit: string; currency?: string } | null | undefined) {
  if (!m) return "—";
  const num = m.value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  if (m.unit === "%") return `${m.value > 0 ? "+" : ""}${num}%`;
  return m.currency ? `${num} ${m.currency}` : num;
}

function liveQuoteLabel(quote: TickerLiveQuote | null) {
  if (!quote) return null;
  if (quote.delayMinutes === 0) return "실시간 · 30초 자동 갱신";
  if (quote.delayMinutes != null) return `${quote.delayMinutes}분 지연 · 30초 자동 갱신`;
  return "현재가 · 30초 자동 갱신";
}

export default function TickerAnalysisPanel({
  initialSymbol = "",
  clientId,
}: {
  initialSymbol?: string;
  clientId?: string;
}) {
  const params = useParams();
  const pbId = String(params?.pbId ?? "default");

  const [symbol, setSymbol] = useState(initialSymbol);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "warning" | "blocked">("idle");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<TickerSnapshot | null>(null);
  const [profile, setProfile] = useState<TickerProfile | null>(null);
  const [liveQuote, setLiveQuote] = useState<TickerLiveQuote | null>(null);
  const [dailyBars, setDailyBars] = useState<EnrichedBar[]>([]);
  const [timeframe, setTimeframe] = useState<OhlcTimeframe>("daily");
  const [multiChartOpen, setMultiChartOpen] = useState(false);
  const { entries: multiEntries, upsertEntry } = useMultiChartEntries();
  const [financial, setFinancial] = useState<FinancialSnapshot | null>(null);
  const [investorFlow, setInvestorFlow] = useState<InvestorFlowSeries | null>(null);
  const [kisConfigured, setKisConfigured] = useState(false);
  const [brief, setBrief] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [presetsDoc, setPresetsDoc] = useState<TickerAnalysisPresets>(DEFAULT_ANALYSIS_PRESETS);
  const [activePresetId, setActivePresetId] = useState("preset-1");
  const [drawings, setDrawings] = useState<DrawingDocument>(() =>
    loadDrawings(pbId, initialSymbol || "", "daily"),
  );
  const chartRef = useRef<TickerCandleChartHandle>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    setPresetsDoc(loadAnalysisPresets(pbId));
    setActivePresetId(loadActivePresetId(pbId));
  }, [pbId]);

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    if (snapshot?.resolvedSymbol) {
      setDrawings(loadDrawings(pbId, snapshot.resolvedSymbol, timeframe));
    }
  }, [pbId, snapshot?.resolvedSymbol, timeframe]);

  const displayBars = useMemo(
    () => (dailyBars.length ? barsForTimeframe(dailyBars, timeframe) : []),
    [dailyBars, timeframe],
  );
  const displayVolumeProfile = useMemo(
    () => volumeProfile(displayBars.map(toOhlcBar)),
    [displayBars],
  );
  const displayStreakMarkers = useMemo(
    () => streakMarkers(displayBars.map(toOhlcBar)),
    [displayBars],
  );

  const primaryMultiEntry = useMemo((): MultiChartEntry | null => {
    if (!snapshot || !dailyBars.length) return null;
    return {
      id: `primary-${snapshot.resolvedSymbol}`,
      query: snapshot.resolvedSymbol,
      symbol: snapshot.resolvedSymbol,
      name: snapshot.name,
      currency: snapshot.currency,
      lastPrice: liveQuote?.price ?? snapshot.lastPrice.value,
      d1Pct: snapshot.periodReturns.d1?.value ?? null,
      dailyBars,
      busy: false,
    };
  }, [snapshot, dailyBars, liveQuote]);

  const activePreset = useMemo(
    () => presetsDoc.presets.find((p) => p.id === activePresetId) ?? presetsDoc.presets[0],
    [presetsDoc, activePresetId],
  );

  const overlayKinds = useMemo(
    () => (activePreset ? overlayIndicators(activePreset) : []),
    [activePreset],
  );
  const panelKinds = useMemo(
    () => (activePreset ? panelIndicators(activePreset) : []),
    [activePreset],
  );
  const enabledCount = activePreset ? enabledIndicators(activePreset).length : 0;

  const recordRun = (client: string | undefined, kind: "ticker" | "explain", evidence: any, notes: string) => {
    if (!client || !evidence) return;
    const bundle: EvidenceBundle = loadBundle(client);
    saveBundle(
      appendRun(bundle, {
        kind,
        engine: evidence.engine,
        inputHash: evidence.inputHash,
        outputHash: evidence.outputHash,
        notes,
      }),
    );
  };

  const explain = async (snap: TickerSnapshot, prof: TickerProfile | null, mode: "brief" | "full") => {
    setExplainBusy(true);
    try {
      const res = await fetch("/api/ticker/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot: snap, profile: prof, mode }),
      });
      const data = await res.json();
      const text = data.explanation ?? "";
      if (mode === "brief") setBrief(text);
      else setExplanation(text);
      recordRun(clientId, "explain", data.evidence, mode === "brief" ? "회사 개요" : "쉬운 말 해석");
    } finally {
      setExplainBusy(false);
    }
  };

  const load = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    setBrief("");
    setExplanation("");
    setSnapshot(null);
    setProfile(null);
    setLiveQuote(null);
    setDailyBars([]);
    setTimeframe("daily");
    setStatus("idle");
    try {
      const res = await fetch(`/api/ticker/ohlc?symbol=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok || data.status === "blocked" || !data.snapshot) {
        setStatus("blocked");
        setError(data.error || "시세를 조회하지 못했습니다.");
        return;
      }
      const snap = data.snapshot as TickerSnapshot;
      setSnapshot(snap);
      setProfile((data.profile ?? null) as TickerProfile | null);
      setLiveQuote((data.quote ?? null) as TickerLiveQuote | null);
      setDailyBars((data.ohlc?.bars ?? []) as EnrichedBar[]);
      upsertEntry({
        id: `primary-${snap.resolvedSymbol}`,
        query: q.trim(),
        symbol: snap.resolvedSymbol,
        name: snap.name,
        currency: snap.currency,
        lastPrice: (data.quote?.price ?? snap.lastPrice.value) as number,
        d1Pct: snap.periodReturns.d1?.value ?? null,
        dailyBars: (data.ohlc?.bars ?? []) as EnrichedBar[],
        busy: false,
      });
      setFinancial(data.financial ?? null);
      setInvestorFlow(data.investorFlow ?? null);
      setKisConfigured(!!data.kisConfigured);
      setStatus(data.status === "warning" || snap.warnings?.length ? "warning" : "ok");
      recordRun(clientId, "ticker", data.evidence, `티커 ${q} OHLC 분석`);
      await explain(snap, data.profile ?? null, "brief");
      await explain(snap, data.profile ?? null, "full");
    } catch (e: any) {
      setStatus("blocked");
      setError(e?.message ?? "시세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialSymbol) load(initialSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  useEffect(() => {
    const resolvedSymbol = snapshot?.resolvedSymbol;
    if (!resolvedSymbol) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(`/api/ticker/quote?symbol=${encodeURIComponent(resolvedSymbol)}`, { cache: "no-store" });
        const data = await res.json();
        if (cancelled || !data.ok || !data.quote) return;
        setLiveQuote(data.quote as TickerLiveQuote);
      } catch {
        // keep last quote
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [snapshot?.resolvedSymbol]);

  const handleDrawingChange = (doc: DrawingDocument) => {
    setDrawings(doc);
    if (snapshot?.resolvedSymbol) saveDrawings(pbId, snapshot.resolvedSymbol, doc, timeframe);
  };

  const switchTimeframe = (tf: OhlcTimeframe) => {
    if (snapshot?.resolvedSymbol && tf !== timeframe) {
      saveDrawings(pbId, snapshot.resolvedSymbol, drawings, timeframe);
    }
    setTimeframe(tf);
  };

  const downloadChartImage = async () => {
    if (!snapshot || !chartRef.current) return;
    setExportBusy(true);
    try {
      await chartRef.current.exportPng({
        symbol: snapshot.resolvedSymbol,
        name: snapshot.name,
        timeframe,
      });
    } finally {
      setExportBusy(false);
    }
  };

  const handlePresetsSave = (next: TickerAnalysisPresets) => {
    setPresetsDoc(next);
    saveAnalysisPresets(pbId, next);
  };

  const selectPreset = (id: string) => {
    setActivePresetId(id);
    saveActivePresetId(pbId, id);
  };

  const loadMultiTicker = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    const pendingId = `pending-${query}-${Date.now()}`;
    upsertEntry({
      id: pendingId,
      query,
      symbol: query,
      name: query,
      currency: "KRW",
      lastPrice: 0,
      d1Pct: null,
      dailyBars: [],
      busy: true,
    });
    try {
      const res = await fetch(`/api/ticker/ohlc?symbol=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok || !data.snapshot) {
        upsertEntry({
          id: pendingId,
          query,
          symbol: query,
          name: query,
          currency: "KRW",
          lastPrice: 0,
          d1Pct: null,
          dailyBars: [],
          busy: false,
          error: data.error || "조회 실패",
        });
        return;
      }
      const snap = data.snapshot as TickerSnapshot;
      upsertEntry({
        id: pendingId,
        query,
        symbol: snap.resolvedSymbol,
        name: snap.name,
        currency: snap.currency,
        lastPrice: (data.quote?.price ?? snap.lastPrice.value) as number,
        d1Pct: snap.periodReturns.d1?.value ?? null,
        dailyBars: (data.ohlc?.bars ?? []) as EnrichedBar[],
        busy: false,
      });
    } catch (e: any) {
      upsertEntry({
        id: pendingId,
        query,
        symbol: query,
        name: query,
        currency: "KRW",
        lastPrice: 0,
        d1Pct: null,
        dailyBars: [],
        busy: false,
        error: e?.message ?? "조회 실패",
      });
    }
  };

  const d1 = snapshot?.periodReturns.d1;
  const priceCls = d1 && d1.value > 0 ? "text-red-600" : d1 && d1.value < 0 ? "text-blue-700" : "text-[#1428A0]";
  const quoteLabel = liveQuoteLabel(liveQuote);
  const syncId = snapshot ? `ticker-${snapshot.resolvedSymbol}` : "ticker";

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load(symbol);
        }}
      >
        <input
          className="input max-w-sm"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="티커 또는 종목명 (예: NVDA, 005930, 삼성전자)"
        />
        <button className="btn-primary" disabled={busy || !symbol.trim()} type="submit">
          {busy ? "분석 중…" : "시세 분석"}
        </button>
        <button
          type="button"
          className="btn-outline inline-flex items-center gap-1.5"
          onClick={() => setPresetsOpen(true)}
          title="사용자 지정 분석 프리셋 편집"
        >
          <span aria-hidden>⚙</span>
          <span>사용자 지정 분석</span>
        </button>
      </form>

      <div className="rounded-xl border border-border bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[#1428A0]">사용자 지정 분석</p>
          <button
            type="button"
            className="text-[10px] text-fg-muted underline"
            onClick={() => setPresetsOpen(true)}
          >
            편집
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presetsDoc.presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                p.id === activePresetId
                  ? "bg-[#1428A0] text-white shadow-sm"
                  : "border border-border bg-surface text-fg hover:border-[#1428A0]"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {activePreset && (
          <p className="mt-2 text-[10px] text-fg-muted">
            {activePreset.name}: {enabledCount}개 지표 표시
            {enabledCount === 0 && " · 차트만 표시됩니다"}
          </p>
        )}
      </div>

      {!kisConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          KIS API 미연결 — 국내 주식은 Naver/Yahoo fallback 사용. 서버 env:{" "}
          <code className="text-[10px]">KIS_APP_KEY</code>,{" "}
          <code className="text-[10px]">KIS_APP_SECRET</code>
        </p>
      )}

      {status === "blocked" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-xs font-bold text-red-700">조회 차단</p>
          <p className="mt-1 text-sm font-semibold text-red-800">{error}</p>
        </div>
      )}

      {status === "warning" && snapshot && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <ul className="list-disc pl-4 text-xs text-amber-900">
            {(snapshot.warnings.length ? snapshot.warnings : ["일부 지표를 계산하지 못했습니다."]).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {snapshot && dailyBars.length > 0 && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-fg-muted">
                  {snapshot.resolvedSymbol} · {snapshot.exchange}
                  {quoteLabel && ` · ${quoteLabel}`}
                </p>
                <h2 className="text-lg font-bold text-fg">{snapshot.name}</h2>
                <p className={`mt-1 text-4xl font-black ${priceCls}`}>
                  {snapshot.lastPrice.value.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}
                  <span className="ml-2 text-lg font-semibold">{snapshot.currency}</span>
                </p>
                <p className="mt-1 text-sm">1일 {formatMetric(d1)}</p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  as-of {formatAsOf(snapshot.lastPrice.asOf)} · 출처 {snapshot.lastPrice.source}
                </p>
              </div>
              <button className="btn-outline text-xs" onClick={() => explain(snapshot, profile, "full")} disabled={explainBusy}>
                {explainBusy ? "설명 작성 중…" : "쉬운 말로 설명"}
              </button>
            </div>
            {brief && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm leading-relaxed">{brief}</div>
            )}

            <div className="mt-5 overflow-hidden rounded-xl border border-border">
              <div className="border-b border-border bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-fg">
                      {timeframeLabel(timeframe)} 캔들차트 · {activePreset?.name}
                    </p>
                    <p className="text-[10px] text-fg-muted">
                      overlay {overlayKinds.length} · 패널 {panelKinds.length}
                      · 드로잉 {timeframeLabel(timeframe)} 별 저장
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["daily", "weekly", "monthly"] as const).map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => switchTimeframe(tf)}
                        className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          timeframe === tf
                            ? "bg-[#1428A0] text-white"
                            : "border border-border bg-white text-fg hover:border-[#1428A0]"
                        }`}
                      >
                        {timeframeLabel(tf)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn-outline px-2.5 py-1 text-[11px]"
                      onClick={() => setMultiChartOpen(true)}
                    >
                      멀티차트
                    </button>
                    <button
                      type="button"
                      className="btn-outline px-2.5 py-1 text-[11px]"
                      disabled={exportBusy}
                      onClick={() => void downloadChartImage()}
                    >
                      {exportBusy ? "저장 중…" : "차트 이미지 저장"}
                    </button>
                  </div>
                </div>
              </div>
              <TickerCandleChart
                key={`${snapshot.resolvedSymbol}-${timeframe}`}
                ref={chartRef}
                bars={displayBars}
                overlayKinds={overlayKinds}
                streakMarkers={displayStreakMarkers}
                volumeProfile={displayVolumeProfile}
                drawingDoc={drawings}
                onDrawingChange={handleDrawingChange}
                currency={snapshot.currency}
                latestPrice={liveQuote?.price ?? snapshot.lastPrice.value}
                title={snapshot.name}
              />
              <TickerIndicatorPanels
                enabledKinds={panelKinds}
                bars={displayBars}
                syncId={syncId}
                financial={financial}
                investorNote={investorFlow?.note}
                investorBars={investorFlow?.bars ?? []}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="1일" m={snapshot.periodReturns.d1} />
            <Metric label="1개월" m={snapshot.periodReturns.m1} />
            <Metric label="6개월" m={snapshot.periodReturns.m6} />
            <Metric label="1년" m={snapshot.periodReturns.y1} />
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold text-[#1428A0]">기술적 지표 해석</p>
            <p className="mt-1 text-sm">{snapshot.technicalState.summary}</p>
          </div>
          {explanation && (
            <div className="card p-4 text-sm leading-relaxed whitespace-pre-wrap">{explanation}</div>
          )}
        </>
      )}

      <TickerAnalysisPresetsDrawer
        open={presetsOpen}
        onClose={() => setPresetsOpen(false)}
        presetsDoc={presetsDoc}
        editingPresetId={activePresetId}
        onSave={handlePresetsSave}
      />

      <TickerMultiChartPanel
        open={multiChartOpen}
        onClose={() => setMultiChartOpen(false)}
        timeframe={timeframe}
        overlayKinds={overlayKinds}
        primary={primaryMultiEntry}
        entries={multiEntries}
        onAdd={loadMultiTicker}
      />
    </div>
  );
}

function Metric({ label, m }: { label: string; m: { value: number; unit: string; currency?: string } | null | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] text-fg-muted">{label}</p>
      <p className="text-sm font-bold">{formatMetric(m)}</p>
    </div>
  );
}
