"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TickerAnalysisPanel from "@/components/advisory/TickerAnalysisPanel";

function TickerInner() {
  const q = useSearchParams();
  const symbol = q.get("symbol") ?? "";
  return (
    <div className="space-y-4 px-6 py-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#1428A0]">PB INSIGHT · TICKER</p>
        <h1 className="mt-1 text-xl font-bold text-fg">티커 분석</h1>
        <p className="mt-1 text-xs text-fg-muted">
          가격·수익률·변동성·MDD·이평·RSI·MACD를 기준일과 출처가 남는 방식으로 산출합니다.
        </p>
      </div>
      <TickerAnalysisPanel initialSymbol={symbol} />
    </div>
  );
}

export default function TickerPage() {
  return (
    <Suspense fallback={<div className="px-6 py-6 text-sm text-fg-muted">불러오는 중…</div>}>
      <TickerInner />
    </Suspense>
  );
}
