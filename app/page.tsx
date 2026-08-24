"use client";

import { useCallback, useEffect, useState } from "react";
import { policyForRegime, type MarketRegime } from "@/lib/strategy/marketRegime";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "trader" });

const REGIME_CARDS = [
  policyForRegime("bull"),
  policyForRegime("sideways"),
  policyForRegime("bear"),
] as const;

type RegimeApi = {
  ok: boolean;
  source?: string;
  error?: string | null;
  barCount?: number;
  detected?: {
    regime: MarketRegime;
    asOf: string | null;
    ma20: number | null;
    ma60: number | null;
    ret20Pct: number | null;
    reason: string;
  };
  policy?: { labelKo: string; reason: string };
};

export default function HomePage() {
  const [regime, setRegime] = useState<RegimeApi | null>(null);
  const [symbol, setSymbol] = useState("005930");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(70000);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const loadRegime = useCallback(async () => {
    try {
      const res = await fetch("/api/regime", { cache: "no-store" });
      const data = (await res.json()) as RegimeApi;
      setRegime(data);
    } catch (e: unknown) {
      setRegime({ ok: false, error: e instanceof Error ? e.message : "국면 조회 실패" });
    }
  }, []);

  useEffect(() => {
    void loadRegime();
  }, [loadRegime]);

  const sampleStockBars = [
    { date: "2024-06-01", open: price - 2000, close: price - 1000 },
    { date: "2024-06-02", open: price - 1000, close: price - 500 },
    { date: "2024-06-03", open: price - 500, close: price },
  ];

  const runPreview = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/trading/kis/preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
        body: JSON.stringify({
          symbol,
          side: "buy",
          quantity: qty,
          price,
          ordDvsn: "00",
          stockBars: sampleStockBars,
          openCount: 0,
          allocatedWon: qty * price,
          idempotencyKey: `preview-${symbol}-${Date.now()}`,
        }),
      });
      const data = await res.json();
      setPreview(data);
      setMessage(data.ok ? "미리보기 OK (실주문 아님)" : data.error || "미리보기 거부");
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "미리보기 실패");
    } finally {
      setBusy(false);
    }
  };

  const submitLive = async () => {
    if (confirmText.trim() !== "실주문") {
      setMessage("확인 문구에 「실주문」을 정확히 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/trading/kis/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
        body: JSON.stringify({
          symbol,
          side: "buy",
          quantity: qty,
          price,
          ordDvsn: "00",
          stockBars: sampleStockBars,
          openCount: 0,
          allocatedWon: qty * price,
          confirmPhrase: "실주문",
          idempotencyKey: `live-${symbol}-${Date.now()}`,
        }),
      });
      const data = await res.json();
      setPreview(data);
      setMessage(
        data.ok
          ? "주문 접수 응답 수신"
          : data.error || "주문 차단 (기본: KIS_LIVE_TRADING_ENABLED=false)",
      );
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "주문 실패");
    } finally {
      setBusy(false);
    }
  };

  const liveRegime = regime?.detected?.regime;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header>
        <p className="text-xs font-semibold tracking-[0.2em] text-slate-500 uppercase">KIS Regime Trader</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">3양봉 · 시장 국면 게이트</h1>
        <p className="mt-2 text-sm text-slate-600">
          런타임 KOSPI 일봉으로 국면을 판정하고, 매수 미리보기/실주문을 강제 게이트합니다. 기본은 fail-closed.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-900">현재 국면 (런타임)</h2>
          <button type="button" className="btn-outline" onClick={() => void loadRegime()}>
            새로고침
          </button>
        </div>
        {regime?.detected ? (
          <div className="mt-3 space-y-1 text-sm">
            <p className="font-semibold text-slate-900">{regime.policy?.labelKo}</p>
            <p className="text-slate-600">{regime.detected.reason}</p>
            <p className="text-xs text-slate-500">
              as-of {regime.detected.asOf ?? "—"} · bars {regime.barCount ?? 0} · {regime.source}
              {regime.detected.ret20Pct != null ? ` · 20일 ${regime.detected.ret20Pct.toFixed(2)}%` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{regime?.error ?? "국면 로딩 중…"}</p>
        )}
      </section>

      <section className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {REGIME_CARDS.map((p) => (
          <div
            key={p.regime}
            className={`rounded-xl border px-3 py-3 text-[11px] ${
              liveRegime === p.regime ? "ring-2 ring-slate-900" : ""
            } ${
              p.regime === "bull"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                : p.regime === "bear"
                  ? "border-rose-300 bg-rose-50 text-rose-950"
                  : "border-amber-300 bg-amber-50 text-amber-950"
            }`}
          >
            <p className="font-semibold">{p.labelKo}</p>
            <p className="mt-1 opacity-90">{p.reason}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-red-200/70 bg-white/90 p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">주문 (게이트 적용)</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          미리보기 UI는 샘플 3양봉 봉을 첨부합니다. 실주문은 확인 문구 + LIVE 플래그 + 국면 게이트 모두 통과해야 합니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="종목코드" />
          <input
            className="input"
            type="number"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            placeholder="수량"
          />
          <input
            className="input"
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            placeholder="가격"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-outline" disabled={busy} onClick={() => void runPreview()}>
            주문 미리보기
          </button>
          <input
            className="input"
            placeholder="확인 문구: 실주문"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
          />
          <button
            type="button"
            className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void submitLive()}
          >
            최종 실주문 요청
          </button>
        </div>
        {message && <p className="mt-3 text-xs text-slate-600">{message}</p>}
        {preview != null && (
          <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-100 p-3 text-[10px] text-slate-800">
            {JSON.stringify(preview, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}
