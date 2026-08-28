"use client";

import { useCallback, useEffect, useState } from "react";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "trader" });

type CashPayload = {
  ok: boolean;
  liveEnabled?: boolean;
  canoMasked?: string | null;
  cash?: {
    ok: boolean;
    orderableCashWon: number | null;
    depositWon: number | null;
    totalEvaluationWon: number | null;
    securitiesEvaluationWon: number | null;
    evaluationPnlWon: number | null;
    purchaseAmountWon: number | null;
    netAssetWon: number | null;
    source?: string;
    asOf?: string;
    error?: string | null;
    message?: string | null;
  };
  error?: string;
};

function fmtWon(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function fmtPnl(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n).toLocaleString("ko-KR")}원`;
}

export default function AccountBalanceCard() {
  const [data, setData] = useState<CashPayload | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/trading/kis/account", {
        headers: { "x-trader-user": TRADER_HEADER },
        cache: "no-store",
      });
      setData((await res.json()) as CashPayload);
    } catch (e: unknown) {
      setData({ ok: false, error: e instanceof Error ? e.message : "잔고 조회 실패" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const cash = data?.cash;
  const low = (cash?.orderableCashWon ?? 0) < 100_000;
  const pnl = cash?.evaluationPnlWon;
  const pnlClass =
    pnl == null ? "text-slate-700" : pnl > 0 ? "text-rose-600" : pnl < 0 ? "text-blue-600" : "text-slate-700";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">한투 계좌 잔고</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-600">총 평가금액</h2>
              <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                {cash?.ok ? fmtWon(cash.totalEvaluationWon ?? cash.netAssetWon) : "조회 중/실패"}
              </p>
              <p className={`mt-1 text-sm font-semibold ${pnlClass}`}>평가손익 {fmtPnl(pnl)}</p>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-600">현금 잔고(참고)</h2>
              <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
                {cash?.ok ? fmtWon(cash.orderableCashWon) : "조회 중/실패"}
              </p>
              <p className="mt-1 text-xs text-slate-500">예수금 {fmtWon(cash?.depositWon)}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                실제 매수가능수량은 종목·가격별로 주문 직전에 한투에서 다시 확인합니다.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>주식평가 {fmtWon(cash?.securitiesEvaluationWon)}</span>
            <span>매입합계 {fmtWon(cash?.purchaseAmountWon)}</span>
            <span>순자산 {fmtWon(cash?.netAssetWon)}</span>
            <span>계좌 {data?.canoMasked ?? "—"}</span>
            <span>실매매 {data?.liveEnabled ? "ON" : "OFF"}</span>
          </div>
          {cash?.message && <p className="mt-2 text-xs text-amber-700">{cash.message}</p>}
          {cash?.error && <p className="mt-2 text-xs text-rose-600">{cash.error}</p>}
          {data?.error && <p className="mt-2 text-xs text-rose-600">{data.error}</p>}
          {cash?.ok && low && (
            <p className="mt-2 text-xs font-semibold text-rose-700">
              잔고가 매우 적어 매수가 차단될 수 있습니다. 한투에 입금 후 「잔고 새로고침」을 누르세요.
            </p>
          )}
        </div>
        <button type="button" className="btn-outline" disabled={busy} onClick={() => void refresh()}>
          {busy ? "조회 중…" : "잔고 새로고침"}
        </button>
      </div>
      <p className="mt-3 text-[10px] text-slate-400">출처: {cash?.source ?? "—"} · as-of {cash?.asOf?.slice(0, 19) ?? "—"}</p>
    </section>
  );
}
