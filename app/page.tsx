"use client";

import { useCallback, useEffect, useState } from "react";
import AutoTraderPanel from "@/components/advisory/AutoTraderPanel";
import KoreanStockTrendFilter from "@/components/advisory/KoreanStockTrendFilter";
import TradingOrderPanel from "@/components/advisory/TradingOrderPanel";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";
import { policyForRegime, type MarketRegime } from "@/lib/strategy/marketRegime";

type RegimeApi = {
  ok: boolean;
  source?: string;
  error?: string | null;
  barCount?: number;
  detected?: {
    regime: MarketRegime;
    asOf: string | null;
    reason: string;
    ret20Pct: number | null;
  };
  policy?: { labelKo: string; reason: string };
};

export default function HomePage() {
  const [selected, setSelected] = useState<PbSelectedKoreanStock[]>([]);
  const [regime, setRegime] = useState<RegimeApi | null>(null);

  const onSelectionChange = useCallback((stocks: PbSelectedKoreanStock[]) => {
    setSelected(stocks);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/regime", { cache: "no-store" });
        setRegime((await res.json()) as RegimeApi);
      } catch (e: unknown) {
        setRegime({ ok: false, error: e instanceof Error ? e.message : "국면 조회 실패" });
      }
    })();
  }, []);

  const live = regime?.detected?.regime;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">KIS Regime Trader</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">자동매매 · 국장 3양봉 · 국면 게이트</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          아래 Auto Trader가 스크리닝→국면→진입/청산을 주기 실행합니다. 기본은 dry-run이며, 실주문은 KIS_LIVE + LIVE 무장일 때만.
        </p>
      </header>

      <AutoTraderPanel />

      <section className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900">런타임 국면</h2>
          {live && (
            <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
              {policyForRegime(live).labelKo}
            </span>
          )}
        </div>
        {regime?.detected ? (
          <p className="mt-2 text-sm text-slate-700">
            {regime.detected.reason}
            <span className="mt-1 block text-xs text-slate-500">
              as-of {regime.detected.asOf ?? "—"} · bars {regime.barCount ?? 0} · {regime.source}
              {regime.detected.ret20Pct != null ? ` · 20일 ${regime.detected.ret20Pct.toFixed(2)}%` : ""}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-500">{regime?.error ?? "국면 로딩…"}</p>
        )}
      </section>

      <KoreanStockTrendFilter
        clientId="local-trader"
        equityWeightPct={100}
        onSelectionChange={(stocks) => onSelectionChange(stocks)}
      />

      <TradingOrderPanel stocks={selected} />
    </main>
  );
}
