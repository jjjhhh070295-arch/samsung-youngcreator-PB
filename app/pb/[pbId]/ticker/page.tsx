"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TickerAnalysisPanel from "@/components/advisory/TickerAnalysisPanel";

function TickerInner() {
  const q = useSearchParams();
  const symbol = q.get("symbol") ?? "";
  return (
    <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#1428A0]">PB INSIGHT · TICKER</p>
        <h1 className="mt-1 text-xl font-bold text-fg">티커 분석</h1>
        <p className="mt-1 text-xs text-fg-muted">
          52주 수정고가·20/60/120/252거래일 수익률·이동평균·거래량은 결정론 코드로 계산합니다. 승인된 실데이터가 없어 현재는 교육용 고정 fixture만 제공하며, AI는 계산값을 바꾸지 않고 설명만 합니다.
        </p>
      </div>
      <TickerAnalysisPanel initialSymbol={symbol} />
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
