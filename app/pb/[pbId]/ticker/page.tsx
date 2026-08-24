"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TickerAnalysisPanel from "@/components/advisory/TickerAnalysisPanel";
import { tickerContextClientId } from "@/lib/advisory/tickerRequestGuard";

function TickerInner() {
  const q = useSearchParams();
  const symbol = q.get("symbol") ?? "";
  const clientId = tickerContextClientId(undefined, q.get("clientId"));
  return (
    <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#1428A0]">PB INSIGHT · TICKER</p>
        <h1 className="mt-1 text-xl font-bold text-fg">티커 분석</h1>
        <p className="mt-1 text-xs text-[#526079]">
          52주 수정고가·수익률·이동평균·거래량과 투자자별 수급·공매도·대차 지표를 결정론 코드로 계산합니다. 승인된 실데이터가 없어 현재는 교육용 고정 fixture만 제공하며, AI는 계산값을 만들거나 바꾸지 않습니다.
        </p>
      </div>
      <TickerAnalysisPanel clientId={clientId} initialSymbol={symbol} />
    </div>
  );
}

export default function TickerPage() {
  return (
    <Suspense fallback={<div className="px-4 py-4 text-sm text-fg-muted sm:px-6 sm:py-6">불러오는 중…</div>}>
      <TickerInner />
    </Suspense>
  );
}
