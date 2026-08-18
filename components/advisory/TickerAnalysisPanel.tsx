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
import type { EvidenceBundle, MeasuredNumber, TickerProfile, TickerSnapshot } from "@/lib/advisory/types";
import { appendRun, loadBundle, saveBundle } from "@/lib/advisory/control";

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
  const [brief, setBrief] = useState("");
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
      if (mode === "brief") setBrief(text);
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
    setExplanation("");
    setSnapshot(null);
    setProfile(null);
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

  const chartData = useMemo(
    () => (snapshot?.bars ?? []).map((b) => ({ t: b.time.slice(5), v: b.close })),
    [snapshot],
  );

  const d1 = snapshot?.periodReturns.d1;
  const priceCls = d1 && d1.value > 0 ? "text-red-600" : d1 && d1.value < 0 ? "text-blue-700" : "text-[#1428A0]";

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
                <p className="text-xs text-fg-muted">{snapshot.resolvedSymbol} · {snapshot.exchange}</p>
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
                <p className="text-[10px] font-semibold text-[#1428A0]">회사 간단 소개 (AI · 원문 요약만)</p>
                <p className="mt-1 text-sm leading-relaxed text-fg">{brief}</p>
                {profile?.warning && <p className="mt-1 text-[10px] text-amber-700">{profile.warning}</p>}
              </div>
            )}
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Metric label="SMA20" m={snapshot.movingAverages.sma20} />
            <Metric label="SMA60" m={snapshot.movingAverages.sma60} />
            <Metric label="SMA120" m={snapshot.movingAverages.sma120} />
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
