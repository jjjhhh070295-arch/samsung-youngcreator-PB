"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "trader" });

type StatusPayload = {
  ok: boolean;
  kisLiveEnabled?: boolean;
  state?: {
    armed: boolean;
    liveArmed: boolean;
    lastRunAt: string | null;
    lastCycleSummary: string | null;
    regime: string | null;
    running: boolean;
    openCount: number;
    positions: Array<{
      id: string;
      ticker: string;
      name: string;
      qty: number;
      entryPrice: number;
      state: string;
      dryRun: boolean;
    }>;
    logs: Array<{ at: string; level: string; message: string }>;
  };
};

/**
 * 자동매매 콘솔 — 무장 후 주기적으로 /api/strategy/auto/run 호출.
 * 기본은 dry-run. 실주문은 KIS_LIVE + live 무장일 때만.
 */
export default function AutoTraderPanel() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [intervalSec, setIntervalSec] = useState(60);
  const [autoTick, setAutoTick] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/strategy/auto/status", {
      headers: { "x-trader-user": TRADER_HEADER },
      cache: "no-store",
    });
    setStatus((await res.json()) as StatusPayload);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!autoTick) return;
    timerRef.current = setInterval(() => {
      void (async () => {
        await fetch("/api/strategy/auto/run", {
          method: "POST",
          headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
          body: JSON.stringify({ force: false, ignoreSession: true }),
        });
        await refresh();
      })();
    }, Math.max(15, intervalSec) * 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoTick, intervalSec, refresh]);

  const arm = async (armed: boolean, liveArmed: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/strategy/auto/status", {
        method: "POST",
        headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
        body: JSON.stringify({ armed, liveArmed }),
      });
      const data = await res.json();
      setMessage(data.ok ? (armed ? "무장 완료" : "해제됨") : data.error || "실패");
      await refresh();
      if (armed) setAutoTick(true);
      else setAutoTick(false);
    } finally {
      setBusy(false);
    }
  };

  const runOnce = async () => {
    setBusy(true);
    setMessage("사이클 실행 중…");
    try {
      const res = await fetch("/api/strategy/auto/run", {
        method: "POST",
        headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
        body: JSON.stringify({ force: true, ignoreSession: true }),
      });
      const data = await res.json();
      setMessage(data.result?.summary || data.error || "완료");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const st = status?.state;

  return (
    <section className="rounded-2xl border-2 border-slate-900 bg-slate-950 p-5 text-slate-50 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400 uppercase">Auto Trader</p>
          <h2 className="mt-1 text-xl font-bold">자동매매 엔진</h2>
          <p className="mt-1 max-w-xl text-[11px] text-slate-400">
            스크리닝 → 국면 게이트 → 3양봉 진입 / 2음봉 청산. 기본 dry-run. 실주문은 KIS_LIVE + live 무장 필요.
          </p>
        </div>
        <div className="text-right text-[11px] text-slate-400">
          <p>KIS live: {status?.kisLiveEnabled ? "ON" : "OFF"}</p>
          <p>armed: {st?.armed ? "YES" : "no"} · liveArmed: {st?.liveArmed ? "YES" : "no"}</p>
          <p>tick: {autoTick ? `every ${intervalSec}s` : "stopped"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
          disabled={busy}
          onClick={() => void arm(true, false)}
        >
          dry-run 무장 + 자동틱
        </button>
        <button
          type="button"
          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          disabled={busy || !status?.kisLiveEnabled}
          onClick={() => void arm(true, true)}
          title={!status?.kisLiveEnabled ? "KIS_LIVE_TRADING_ENABLED=true 필요" : ""}
        >
          LIVE 무장
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
          disabled={busy}
          onClick={() => void arm(false, false)}
        >
          해제
        </button>
        <button
          type="button"
          className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-50"
          disabled={busy}
          onClick={() => void runOnce()}
        >
          지금 1회 실행
        </button>
        <label className="ml-2 flex items-center gap-1 text-[11px] text-slate-400">
          주기(초)
          <input
            className="w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-100"
            type="number"
            min={15}
            value={intervalSec}
            onChange={(e) => setIntervalSec(Number(e.target.value) || 60)}
          />
        </label>
      </div>

      {message && <p className="mt-3 text-xs text-emerald-300">{message}</p>}
      {st?.lastCycleSummary && (
        <p className="mt-2 text-xs text-slate-300">
          마지막: {st.lastCycleSummary}
          {st.lastRunAt ? ` · ${st.lastRunAt}` : ""}
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold text-slate-300">보유 ({st?.openCount ?? 0})</h3>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px]">
            {(st?.positions ?? [])
              .filter((p) => ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED"].includes(p.state))
              .map((p) => (
                <li key={p.id} className="rounded bg-slate-900 px-2 py-1">
                  {p.name}({p.ticker}) · {p.qty}주 · {p.entryPrice.toLocaleString("ko-KR")} · {p.state}
                  {p.dryRun ? " · dry" : " · live"}
                </li>
              ))}
            {(st?.openCount ?? 0) === 0 && <li className="text-slate-500">없음</li>}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-slate-300">로그</h3>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-[10px] text-slate-400">
            {(st?.logs ?? []).slice(0, 20).map((l, i) => (
              <li key={`${l.at}-${i}`}>
                <span className={l.level === "error" ? "text-rose-400" : l.level === "warn" ? "text-amber-300" : ""}>
                  [{l.level}]
                </span>{" "}
                {l.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
