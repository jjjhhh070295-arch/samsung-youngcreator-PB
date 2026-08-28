"use client";

import { useCallback, useState } from "react";
import AutoTraderPanel from "@/components/advisory/AutoTraderPanel";
import AccountBalanceCard from "@/components/advisory/AccountBalanceCard";
import OpenOrdersCard from "@/components/advisory/OpenOrdersCard";
import HelpToolbar from "@/components/help/HelpToolbar";
import KoreanStockTrendFilter from "@/components/advisory/KoreanStockTrendFilter";
import TradingOrderPanel from "@/components/advisory/TradingOrderPanel";
import type { PbSelectedKoreanStock } from "@/lib/advisory/krTrendPortfolio";

export default function HomePage() {
  const [selected, setSelected] = useState<PbSelectedKoreanStock[]>([]);

  const onSelectionChange = useCallback((stocks: PbSelectedKoreanStock[]) => {
    setSelected(stocks);
  }, []);

  return (
    <>
      <HelpToolbar nextAction="CHECK_WORKER" />
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8">
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-slate-500 uppercase">KIS Signal Trader</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">자동매매 · 국장 3양봉 매수 · 2음봉 매도</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          시장 국면 조건 없이 신호를 검사합니다. 매수는 주문가능현금 전액, 매도는 해당 종목 주문가능수량 전량입니다.
        </p>
      </header>

      <AccountBalanceCard />

      <OpenOrdersCard />

      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-sm text-slate-800">
        <h2 className="font-bold text-slate-900">눌러야 할 버튼 (순서)</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
          <li>위 <strong>잔고 새로고침</strong> — 평가금액·현금 잔고 참고값 확인</li>
          <li>아래 Auto Trader에서 <strong>dry-run 무장 + 자동틱</strong> (연습) 또는 <strong>LIVE 무장</strong> (실주문)</li>
          <li>멈추려면 <strong>해제</strong></li>
          <li>한 번만 돌리려면 <strong>지금 1회 실행</strong></li>
        </ol>
        <p className="mt-2 text-xs text-slate-600">
          브라우저 버튼은 사이트용입니다. Mac을 껐다 키면 터미널에서 <code>npm run worker:dev</code> 를 다시 켜야 자동매매가 이어집니다.
        </p>
      </section>

      <AutoTraderPanel />

      <KoreanStockTrendFilter
        clientId="local-trader"
        equityWeightPct={100}
        onSelectionChange={(stocks) => onSelectionChange(stocks)}
      />

      <TradingOrderPanel stocks={selected} />
    </main>
    </>
  );
}
