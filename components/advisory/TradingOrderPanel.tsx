"use client";

import { useState } from "react";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";
import { policyForRegime } from "@/lib/strategy/marketRegime";

const TRADER_HEADER = JSON.stringify({ id: "local-demo", role: "trader" });
const REGIME_CARDS = [
  policyForRegime("bull"),
  policyForRegime("sideways"),
  policyForRegime("bear"),
] as const;

/**
 * 확정 종목 → 일봉 로드 → 국면 게이트 → 미리보기/실주문
 */
export default function TradingOrderPanel({ stocks }: { stocks: PbSelectedKoreanStock[] }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<unknown>(null);
  const [regimeLive, setRegimeLive] = useState<unknown>(null);

  if (stocks.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-600">
        후보를 체크하고 <strong>후보 확정</strong>하면 여기에 국면 게이트 주문이 활성화됩니다.
      </section>
    );
  }

  const first = stocks[0]!;

  const run = async (live: boolean) => {
    if (live && confirmText.trim() !== "실주문") {
      setMessage("확인 문구에 「실주문」을 입력하세요.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const regimeRes = await fetch("/api/regime", { cache: "no-store" });
      const regimeJson = await regimeRes.json();
      setRegimeLive(regimeJson);

      const barsRes = await fetch(`/api/advisory/kr-trend/bars?ticker=${encodeURIComponent(first.ticker)}`);
      const barsJson = await barsRes.json();
      const stockBars = (barsJson.bars ?? []).map((b: { date: string; open: number; close: number }) => ({
        date: b.date,
        open: b.open,
        close: b.close,
      }));

      const qty = Math.max(1, Math.floor((first.seedWon || 1_000_000) / Math.max(first.entryPrice || 1, 1)));
      const body = {
        symbol: first.ticker,
        side: "buy" as const,
        quantity: qty,
        price: first.entryPrice || 1000,
        ordDvsn: "00" as const,
        stockBars,
        openCount: 0,
        allocatedWon: first.seedWon || qty * (first.entryPrice || 1000),
        confirmPhrase: live ? "실주문" : undefined,
        idempotencyKey: `${live ? "live" : "preview"}-${first.ticker}-${Date.now()}`,
      };

      const url = live ? "/api/trading/kis/orders" : "/api/trading/kis/preview";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-trader-user": TRADER_HEADER },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setPreview(data);
      setMessage(
        data.ok
          ? live
            ? "주문 접수 응답"
            : "미리보기 OK (실주문 아님)"
          : data.error || "거부됨",
      );
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-red-200 bg-white/90 p-4">
      <h3 className="text-sm font-bold text-slate-900">국면 게이트 · KIS 주문</h3>
      <p className="mt-1 text-[11px] text-slate-500">
        확정 {stocks.length}종목 · 대표 주문: {first.name}({first.ticker}) · 기본 fail-closed
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {REGIME_CARDS.map((p) => (
          <div
            key={p.regime}
            className={`rounded-lg border px-3 py-2 text-[11px] ${
              p.regime === "bull"
                ? "border-emerald-300 bg-emerald-50"
                : p.regime === "bear"
                  ? "border-rose-300 bg-rose-50"
                  : "border-amber-300 bg-amber-50"
            }`}
          >
            <p className="font-semibold">{p.labelKo}</p>
            <p className="mt-0.5 opacity-80">{p.reason}</p>
          </div>
        ))}
      </div>
      <ul className="mt-2 text-[11px] text-slate-600">
        {stocks.map((s) => (
          <li key={s.ticker}>
            {s.name}({s.ticker}) · 진입 {s.entryPrice?.toLocaleString("ko-KR")} · 시드{" "}
            {s.seedWon?.toLocaleString("ko-KR")}원
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-outline" disabled={busy} onClick={() => void run(false)}>
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
          onClick={() => void run(true)}
        >
          최종 실주문 요청
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-slate-600">{message}</p>}
      {regimeLive != null && (
        <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 text-[10px]">
          {JSON.stringify(regimeLive, null, 2)}
        </pre>
      )}
      {preview != null && (
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-[10px]">
          {JSON.stringify(preview, null, 2)}
        </pre>
      )}
    </section>
  );
}
