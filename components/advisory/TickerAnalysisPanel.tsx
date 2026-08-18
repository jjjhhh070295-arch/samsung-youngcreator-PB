"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EvidenceBundle, MeasuredNumber, TickerSnapshot } from "@/lib/advisory/types";
import { appendRun, loadBundle, saveBundle } from "@/lib/advisory/control";

function Metric({ label, m }: { label: string; m: MeasuredNumber | null | undefined }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <p className="text-[10px] text-fg-muted">{label}</p>
      <p className="text-sm font-bold text-fg">
        {m == null
          ? "—"
          : `${m.value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${
              m.unit === "%" ? "%" : m.unit === "index" || m.unit === "price" ? "" : m.unit === m.currency ? "" : m.unit ? ` ${m.unit}` : ""
            }${m.currency && (m.unit === "price" || m.unit === m.currency) ? ` ${m.currency}` : ""}`}
      </p>
      {m && (
        <p className="text-[10px] text-fg-muted">as-of {m.asOf.slice(0, 10)} · {m.source}</p>
      )}
    </div>
  );
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
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<TickerSnapshot | null>(null);
  const [explanation, setExplanation] = useState("");
  const [explainBusy, setExplainBusy] = useState(false);

  useEffect(() => {
    if (initialSymbol) setSymbol(initialSymbol);
  }, [initialSymbol]);

  const load = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    setExplanation("");
    try {
      const res = await fetch(`/api/ticker?symbol=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "분석 실패");
      setSnapshot(data.snapshot as TickerSnapshot);
      if (clientId && data.evidence) {
        const bundle: EvidenceBundle = loadBundle(clientId);
        saveBundle(
          appendRun(bundle, {
            kind: "ticker",
            engine: data.evidence.engine,
            inputHash: data.evidence.inputHash,
            outputHash: data.evidence.outputHash,
            notes: `티커 ${q} 결정론 분석`,
          }),
        );
      }
    } catch (e: any) {
      setSnapshot(null);
      setError(e?.message ?? "시세를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialSymbol) load(initialSymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  const explain = async () => {
    if (!snapshot) return;
    setExplainBusy(true);
    try {
      const res = await fetch("/api/ticker/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot }),
      });
      const data = await res.json();
      setExplanation(data.explanation ?? "");
      if (clientId && data.evidence) {
        const bundle = loadBundle(clientId);
        saveBundle(
          appendRun(bundle, {
            kind: "explain",
            engine: data.evidence.engine,
            inputHash: data.evidence.inputHash,
            outputHash: data.evidence.outputHash,
            notes: "AI 설명만 생성 (수치 미변경)",
          }),
        );
      }
    } finally {
      setExplainBusy(false);
    }
  };

  const chartData = useMemo(
    () => (snapshot?.bars ?? []).map((b) => ({ t: b.time.slice(5), v: b.close })),
    [snapshot],
  );

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
      {error && <p className="text-sm text-red-600">{error}</p>}

      {snapshot && (
        <>
          <div className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs text-fg-muted">{snapshot.resolvedSymbol} · {snapshot.exchange}</p>
                <h2 className="text-xl font-bold text-fg">{snapshot.name}</h2>
                <p className="text-2xl font-black text-[#1428A0]">
                  {snapshot.lastPrice.value.toLocaleString()} {snapshot.currency}
                </p>
                <p className="text-[10px] text-fg-muted">
                  as-of {snapshot.asOf} · {snapshot.source}
                </p>
              </div>
              <button className="btn-outline text-xs" onClick={explain} disabled={explainBusy}>
                {explainBusy ? "설명 작성 중…" : "쉬운 말로 설명 (AI)"}
              </button>
            </div>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={24} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={64} />
                  <Tooltip />
                  <Line type="monotone" dataKey="v" stroke="#1428A0" dot={false} strokeWidth={1.6} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="1M" m={snapshot.periodReturns.m1} />
            <Metric label="3M" m={snapshot.periodReturns.m3} />
            <Metric label="6M" m={snapshot.periodReturns.m6} />
            <Metric label="1Y" m={snapshot.periodReturns.y1} />
            <Metric label="YTD" m={snapshot.periodReturns.ytd} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="변동성 20D" m={snapshot.volatility.d20} />
            <Metric label="변동성 60D" m={snapshot.volatility.d60} />
            <Metric label="MDD" m={snapshot.mdd} />
            <Metric label="RSI(14)" m={snapshot.rsi14} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Metric label="SMA20" m={snapshot.movingAverages.sma20} />
            <Metric label="SMA60" m={snapshot.movingAverages.sma60} />
            <Metric label="SMA120" m={snapshot.movingAverages.sma120} />
            <Metric label="MACD" m={snapshot.macd.macd} />
            <Metric label="Signal" m={snapshot.macd.signal} />
            <Metric label="Histogram" m={snapshot.macd.histogram} />
          </div>
          <div className="card p-4">
            <p className="text-xs font-semibold text-[#1428A0]">엔진 기술 상태 (결정론)</p>
            <p className="mt-1 text-sm text-fg">{snapshot.technicalState.summary}</p>
          </div>
          {explanation && (
            <div className="card p-4">
              <p className="text-xs font-semibold text-fg-muted">AI 설명 · 수치는 엔진 값만 사용</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-fg">{explanation}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
