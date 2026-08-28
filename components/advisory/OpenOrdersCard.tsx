"use client";

import { useCallback, useEffect, useState } from "react";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "trader" });

type OpenOrder = {
  orderNo: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  orderQty: number;
  filledQty: number;
  cancelableQty: number;
  price: number;
  orderTime: string;
  ordDvsnName: string;
  exchange: string;
};

type Payload = { ok: boolean; orders?: OpenOrder[]; error?: string };

function formatTime(value: string) {
  if (value.length !== 6) return value || "—";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`;
}

export default function OpenOrdersCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [busyOrderNo, setBusyOrderNo] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/trading/kis/open-orders", {
        headers: { "x-trader-user": TRADER_HEADER },
        cache: "no-store",
      });
      setData((await res.json()) as Payload);
    } catch (error: unknown) {
      setData({ ok: false, error: error instanceof Error ? error.message : "미체결 조회 실패" });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const cancel = async (order: OpenOrder) => {
    const confirmed = window.confirm(
      `${order.name}(${order.symbol}) 미체결 ${order.cancelableQty}주를 전량 취소할까요?\n자동매매도 함께 해제됩니다.`,
    );
    if (!confirmed) return;

    setBusyOrderNo(order.orderNo);
    setMessage("");
    try {
      const res = await fetch(
        `/api/trading/kis/open-orders/${encodeURIComponent(order.orderNo)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
          body: JSON.stringify({ confirmPhrase: "미체결취소" }),
        },
      );
      const json = (await res.json()) as { ok?: boolean; error?: string };
      setMessage(json.ok ? "미체결 주문 취소 접수 완료" : json.error || "취소 실패");
      await refresh();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "취소 실패");
    } finally {
      setBusyOrderNo(null);
    }
  };

  const orders = data?.orders ?? [];

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">KIS 미체결</p>
          <h2 className="text-sm font-bold text-slate-900">미체결 주문 ({orders.length})</h2>
        </div>
        <button type="button" className="btn-outline" onClick={() => void refresh()}>
          새로고침
        </button>
      </div>

      {data?.error && <p className="mt-3 text-xs text-rose-700">{data.error}</p>}
      {message && <p className="mt-3 text-xs font-semibold text-slate-700">{message}</p>}

      <div className="mt-3 space-y-2">
        {orders.map((order) => (
          <div key={order.orderNo} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3">
            <div className="text-xs text-slate-700">
              <p className="font-bold text-slate-900">
                {order.name} ({order.symbol}) · {order.side === "buy" ? "매수" : "매도"}
              </p>
              <p className="mt-1">
                미체결 {order.cancelableQty.toLocaleString("ko-KR")}주 · 주문가 {order.price.toLocaleString("ko-KR")}원 · {order.exchange}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-500">
                주문 {order.orderQty}주 · 체결 {order.filledQty}주 · {order.ordDvsnName || "지정가"} · {formatTime(order.orderTime)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              disabled={busyOrderNo != null}
              onClick={() => void cancel(order)}
            >
              {busyOrderNo === order.orderNo ? "취소 중…" : "미체결 전량 취소"}
            </button>
          </div>
        ))}
        {data?.ok && orders.length === 0 && (
          <p className="rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-500">취소 가능한 미체결 주문이 없습니다.</p>
        )}
      </div>
      <p className="mt-3 text-[10px] text-amber-800">
        취소 버튼은 한투 미체결 목록을 다시 확인한 뒤 해당 주문의 남은 수량 전체만 취소합니다.
      </p>
    </section>
  );
}
