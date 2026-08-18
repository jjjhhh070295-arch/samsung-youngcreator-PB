"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EvidenceBundle, MeasuredNumber, TickerLiveQuote, TickerProfile, TickerSnapshot } from "@/lib/advisory/types";
import { appendRun, loadBundle, saveBundle } from "@/lib/advisory/control";

const CHART_COLORS = {
  close: "#111827",
  sma5: "#f97316",
  sma20: "#2563eb",
  sma60: "#8b5cf6",
  sma120: "#059669",
  macd: "#2563eb",
  signal: "#f97316",
  positive: "#ef4444",
  negative: "#2563eb",
  rsi: "#7c3aed",
};

function formatChartNumber(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString("ko-KR", { maximumFractionDigits: 4 });
}

function ChartLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-fg-muted">
      {items.map((item) => (
        <span className="inline-flex items-center gap-1.5" key={item.label}>
          <span
            className={`inline-block h-0 w-4 border-t-2 ${item.dashed ? "border-dashed" : ""}`}
            style={{ borderColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function formatAsOf(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + " (KST)";
}

function formatMetric(m: MeasuredNumber | null | undefined) {
  if (!m) return "—";
  const num = m.value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  if (m.unit === "%") return `${m.value > 0 ? "+" : ""}${num}%`;
  if (m.unit === "index" || m.unit === "price") {
    return m.currency ? `${num} ${m.currency}` : num;
  }
  if (m.currency && (m.unit === m.currency)) return `${num} ${m.currency}`;
  return `${num}${m.unit ? ` ${m.unit}` : ""}`;
}

function Metric({ label, m }: { label: string; m: MeasuredNumber | null | undefined }) {
  const up = m && m.unit === "%" && m.value > 0;
  const down = m && m.unit === "%" && m.value < 0;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] text-fg-muted">{label}</p>
      <p className={`text-sm font-bold ${up ? "text-red-600" : down ? "text-blue-700" : "text-fg"}`}>
        {formatMetric(m)}
      </p>
      {m ? (
        <p className="text-[10px] text-fg-muted">as-of {formatAsOf(m.asOf)} · {m.source}{m.currency ? ` · ${m.currency}` : ""}</p>
      ) : (
        <p className="text-[10px] text-amber-700">자료 없음 · 임의값 없음</p>
      )}
    </div>
  );
}

function liveQuoteLabel(quote: TickerLiveQuote | null) {
  if (!quote) return null;
  const state = quote.marketState?.toUpperCase();
  if (state === "CLOSE" || state === "CLOSED") return "장 마감 시세";
  if (state === "PREOPEN" || state === "PRE") return "개장 전 시세";
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
  const [symbol, setSymbol] = useState(initialSymbol);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "warning" | "blocked">("idle");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<TickerSnapshot | null>(null);
  const [profile, setProfile] = useState<TickerProfile | null>(null);
  const [liveQuote, setLiveQuote] = useState<TickerLiveQuote | null>(null);
  const [brief, setBrief] = useState("");
  const [briefModel, setBriefModel] = useState("");
  const [explanation, setExplanation] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

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
      if (mode === "brief") {
        setBrief(text);
        setBriefModel(data.model ?? "");
      }
      else setExplanation(text);
      recordRun(clientId, "explain", data.evidence, mode === "brief" ? "회사 개요 2~3문장" : "쉬운 말 해석 (수치 미변경)");
    } finally {
      setExplainBusy(false);
    }
  };

  const load = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    setBrief("");
    setBriefModel("");
    setExplanation("");
    setSnapshot(null);
    setProfile(null);
    setLiveQuote(null);
    setStatus("idle");
    try {
      const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok || data.status === "blocked" || !data.snapshot) {
        setStatus("blocked");
        setError(data.error || "시세를 조회하지 못했습니다.");
        return;
      }
      const snap = data.snapshot as TickerSnapshot;
      const prof = (data.profile ?? null) as TickerProfile | null;
      setSnapshot(snap);
      setProfile(prof);
      setLiveQuote((data.quote ?? null) as TickerLiveQuote | null);
      setStatus(data.status === "warning" || snap.warnings?.length ? "warning" : "ok");
      recordRun(clientId, "ticker", data.evidence, `티커 ${q} 결정론 분석`);
      await explain(snap, prof, "brief");
      await explain(snap, prof, "full");
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
        const quote = data.quote as TickerLiveQuote;
        setLiveQuote(quote);
        setSnapshot((current) => {
          if (!current || current.resolvedSymbol !== resolvedSymbol) return current;
          return {
            ...current,
            name: quote.name || current.name,
            exchange: quote.exchange || current.exchange,
            currency: quote.currency || current.currency,
            asOf: quote.asOf,
            lastPrice: {
              value: quote.price,
              unit: quote.currency,
              currency: quote.currency,
              asOf: quote.asOf,
              source: quote.source,
            },
            periodReturns: {
              ...current.periodReturns,
              d1: quote.changePct == null ? current.periodReturns.d1 : {
                value: quote.changePct,
                unit: "%",
                asOf: quote.asOf,
                source: quote.source,
              },
            },
          };
        });
      } catch {
        // 마지막 정상 시세를 유지한다. 일시적 갱신 실패로 화면 전체를 차단하지 않는다.
      }
    };

    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [snapshot?.resolvedSymbol]);

  const chartData = useMemo(
    () => (snapshot?.bars ?? []).map((bar) => ({ ...bar, t: bar.time.slice(5) })),
    [snapshot],
  );
  const chartSyncId = snapshot ? `ticker-${snapshot.resolvedSymbol}` : "ticker-chart";

  const d1 = snapshot?.periodReturns.d1;
  const priceCls = d1 && d1.value > 0 ? "text-red-600" : d1 && d1.value < 0 ? "text-blue-700" : "text-[#1428A0]";
  const quoteLabel = liveQuoteLabel(liveQuote);

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
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
          {busy ? "분석 중…" : "결정론 분석"}
        </button>
      </form>

      {status === "blocked" && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">blocked</p>
          <p className="mt-1 text-sm font-semibold text-red-800">시세 조회 실패 — 임의 숫자는 표시하지 않습니다.</p>
          <p className="mt-1 text-xs text-red-700">{error}</p>
        </div>
      )}

      {status === "warning" && snapshot && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800">warning</p>
          <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
            {(snapshot.warnings.length ? snapshot.warnings : ["일부 지표를 계산하지 못했습니다."]).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {snapshot && (
        <>
          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-fg-muted">{snapshot.resolvedSymbol} · {snapshot.exchange}</p>
                  {quoteLabel && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      liveQuote?.marketState?.toUpperCase() === "OPEN"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-surface-2 text-fg-muted"
                    }`}>
                      {quoteLabel}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold text-fg">{snapshot.name}</h2>
                <p className={`mt-1 text-4xl font-black tracking-tight ${priceCls}`}>
                  {snapshot.lastPrice.value.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}
                  <span className="ml-2 text-lg font-semibold text-fg">{snapshot.currency}</span>
                </p>
                <p className="mt-1 text-sm">
                  1일 {formatMetric(d1)}
                </p>
                <p className="mt-1 text-[11px] text-fg-muted">
                  as-of {formatAsOf(snapshot.lastPrice.asOf)} · 출처 {snapshot.lastPrice.source} · 통화 {snapshot.currency}
                </p>
              </div>
              <button
                className="btn-outline text-xs"
                onClick={() => explain(snapshot, profile, "full")}
                disabled={explainBusy}
              >
                {explainBusy ? "설명 작성 중…" : "쉬운 말로 설명 (AI)"}
              </button>
            </div>
            {brief && (
              <div className="mt-4 rounded-lg bg-surface-2 p-3">
                <p className="text-[10px] font-semibold text-[#1428A0]">
                  회사 간단 소개 ({briefModel.startsWith("fallback") ? "원문 기반" : "AI · 원문 요약만"})
                </p>
                <p className="mt-1 text-sm leading-relaxed text-fg">{brief}</p>
                {profile?.warning && <p className="mt-1 text-[10px] text-amber-700">{profile.warning}</p>}
              </div>
            )}
            {profile?.longBusinessSummary && (
              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <p className="text-[10px] font-semibold text-fg-muted">회사 개요 · 제공처 원문</p>
                <p className="mt-1 text-sm leading-relaxed text-fg">{profile.longBusinessSummary}</p>
                <p className="mt-2 text-[10px] text-fg-muted">
                  as-of {formatAsOf(profile.asOf)} · 출처 {profile.source}
                </p>
              </div>
            )}
            <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface-2/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-fg">일봉 · 이동평균선</p>
                  <p className="text-[10px] text-fg-muted">최근 {chartData.length}거래일 · 차트 간 날짜/호버 연동</p>
                </div>
                <ChartLegend
                  items={[
                    { label: "종가", color: CHART_COLORS.close },
                    { label: "5일", color: CHART_COLORS.sma5 },
                    { label: "20일", color: CHART_COLORS.sma20 },
                    { label: "60일", color: CHART_COLORS.sma60 },
                    { label: "120일", color: CHART_COLORS.sma120 },
                  ]}
                />
              </div>

              <div className="h-[300px] bg-surface px-1 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} syncId={chartSyncId} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="t" tick={false} tickLine={false} axisLine={false} height={8} />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      tickFormatter={(value) => formatChartNumber(value)}
                      tickLine={false}
                      axisLine={false}
                      width={72}
                    />
                    <Tooltip
                      cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
                      formatter={(value, name) => [formatChartNumber(value), name]}
                      labelFormatter={(label) => `일자 ${label}`}
                      contentStyle={{ borderRadius: 8, borderColor: "#cbd5e1", fontSize: 11 }}
                    />
                    <Line type="linear" dataKey="close" name="종가" stroke={CHART_COLORS.close} dot={false} strokeWidth={1.7} isAnimationActive={false} />
                    <Line type="linear" dataKey="sma5" name="5일선" stroke={CHART_COLORS.sma5} dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
                    <Line type="linear" dataKey="sma20" name="20일선" stroke={CHART_COLORS.sma20} dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
                    <Line type="linear" dataKey="sma60" name="60일선" stroke={CHART_COLORS.sma60} dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
                    <Line type="linear" dataKey="sma120" name="120일선" stroke={CHART_COLORS.sma120} dot={false} strokeWidth={1.25} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="border-t border-border bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-fg">MACD (12, 26, 9)</p>
                    <p className="text-[10px] text-fg-muted">추세·모멘텀</p>
                  </div>
                  <ChartLegend
                    items={[
                      { label: "MACD", color: CHART_COLORS.macd },
                      { label: "Signal", color: CHART_COLORS.signal },
                      { label: "Histogram +", color: CHART_COLORS.positive },
                      { label: "Histogram −", color: CHART_COLORS.negative },
                    ]}
                  />
                </div>
                <div className="h-[160px] px-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} syncId={chartSyncId} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="t" tick={false} tickLine={false} axisLine={false} height={8} />
                      <YAxis
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickFormatter={(value) => formatChartNumber(value)}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                      />
                      <Tooltip
                        cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
                        formatter={(value, name) => [formatChartNumber(value), name]}
                        labelFormatter={(label) => `일자 ${label}`}
                        contentStyle={{ borderRadius: 8, borderColor: "#cbd5e1", fontSize: 11 }}
                      />
                      <ReferenceLine y={0} stroke="#94a3b8" />
                      <Bar dataKey="macdHistogram" name="Histogram" isAnimationActive={false}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`${entry.time}-${index}`}
                            fill={(entry.macdHistogram ?? 0) >= 0 ? CHART_COLORS.positive : CHART_COLORS.negative}
                            fillOpacity={0.72}
                          />
                        ))}
                      </Bar>
                      <Line type="linear" dataKey="macd" name="MACD" stroke={CHART_COLORS.macd} dot={false} strokeWidth={1.4} connectNulls isAnimationActive={false} />
                      <Line type="linear" dataKey="macdSignal" name="Signal" stroke={CHART_COLORS.signal} dot={false} strokeWidth={1.3} connectNulls isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="border-t border-border bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-fg">RSI (14)</p>
                    <p className="text-[10px] text-fg-muted">70 이상 과매수 · 30 이하 과매도</p>
                  </div>
                  <ChartLegend
                    items={[
                      { label: "RSI", color: CHART_COLORS.rsi },
                      { label: "70 / 30", color: "#94a3b8", dashed: true },
                    ]}
                  />
                </div>
                <div className="h-[165px] px-1 pb-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} syncId={chartSyncId} margin={{ top: 4, right: 8, bottom: 2, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="t"
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={{ stroke: "#cbd5e1" }}
                        minTickGap={28}
                        height={26}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 30, 50, 70, 100]}
                        tick={{ fontSize: 10, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                      />
                      <Tooltip
                        cursor={{ stroke: "#64748b", strokeDasharray: "3 3" }}
                        formatter={(value, name) => [formatChartNumber(value), name]}
                        labelFormatter={(label) => `일자 ${label}`}
                        contentStyle={{ borderRadius: 8, borderColor: "#cbd5e1", fontSize: 11 }}
                      />
                      <ReferenceArea y1={70} y2={100} fill="#ef4444" fillOpacity={0.06} />
                      <ReferenceArea y1={0} y2={30} fill="#2563eb" fillOpacity={0.06} />
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" />
                      <ReferenceLine y={50} stroke="#cbd5e1" strokeDasharray="2 4" />
                      <ReferenceLine y={30} stroke="#2563eb" strokeDasharray="4 4" />
                      <Line type="linear" dataKey="rsi14" name="RSI(14)" stroke={CHART_COLORS.rsi} dot={false} strokeWidth={1.6} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="1일 수익률" m={snapshot.periodReturns.d1} />
            <Metric label="1개월 수익률" m={snapshot.periodReturns.m1} />
            <Metric label="6개월 수익률" m={snapshot.periodReturns.m6} />
            <Metric label="1년 수익률" m={snapshot.periodReturns.y1} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="변동성 20D" m={snapshot.volatility.d20} />
            <Metric label="변동성 60D" m={snapshot.volatility.d60} />
            <Metric label="MDD" m={snapshot.mdd} />
            <Metric label="RSI(14)" m={snapshot.rsi14} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="SMA5" m={snapshot.movingAverages.sma5} />
            <Metric label="SMA20" m={snapshot.movingAverages.sma20} />
            <Metric label="SMA60" m={snapshot.movingAverages.sma60} />
            <Metric label="SMA120" m={snapshot.movingAverages.sma120} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Metric label="MACD" m={snapshot.macd.macd} />
            <Metric label="Signal" m={snapshot.macd.signal} />
            <Metric label="Histogram" m={snapshot.macd.histogram} />
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold text-[#1428A0]">기술적 지표 해석 (결정론 엔진)</p>
            <p className="mt-1 text-sm text-fg">{snapshot.technicalState.summary}</p>
            <p className="mt-2 text-[10px] text-fg-muted">
              as-of {formatAsOf(snapshot.asOf)} · {snapshot.source} · {snapshot.currency} — AI가 수치를 바꾸지 않습니다.
            </p>
          </div>
          {explanation && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-fg-muted">기술적 지표 해석 (AI · 엔진 숫자만 사용)</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-fg">{explanation}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
