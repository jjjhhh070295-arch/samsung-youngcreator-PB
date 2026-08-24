"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import TickerAnalysisPanel from "@/components/advisory/TickerAnalysisPanel";
import {
  tickerAnalysisHref,
  tickerContextClientId,
  tickerSubviewFromQuery,
} from "@/lib/advisory/tickerRequestGuard";

function TickerInner() {
  const q = useSearchParams();
  const params = useParams<{ pbId: string }>();
  const pbId = params.pbId;
  const symbol = q.get("symbol") ?? "";
  const clientId = tickerContextClientId(undefined, q.get("clientId"));
  const selectionScope = `${clientId ?? "global"}:${symbol}`;
  const [activeSelection, setActiveSelection] = useState({ scope: selectionScope, symbol });
  const activeSymbol = activeSelection.scope === selectionScope ? activeSelection.symbol : symbol;
  const initialSubview = tickerSubviewFromQuery(q.get("subview"));
  const flowHref = tickerAnalysisHref(pbId, clientId, { symbol: activeSymbol, subview: "flows" });
  const momentumHref = tickerAnalysisHref(pbId, clientId, { symbol: activeSymbol, subview: "momentum" });
  return (
    <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6">
      <div>
        <p className="text-xs font-semibold tracking-widest text-[#1428A0]">PB INSIGHT · TICKER</p>
        <h1 className="mt-1 text-xl font-bold text-fg">티커 분석</h1>
        <p className="mt-1 text-xs text-[#526079]">
          52주 수정고가·수익률·이동평균·거래량과 투자자별 수급·공매도·대차 지표를 결정론 코드로 계산합니다. 승인된 실데이터가 없어 현재는 교육용 고정 fixture만 제공하며, AI는 계산값을 만들거나 바꾸지 않습니다.
        </p>
      </div>

      <section
        aria-labelledby="ticker-feature-discovery-title"
        className="rounded-xl border border-[#DCE4F5] bg-[#F0F3FA] p-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[#AAB7F8] bg-white px-2 py-0.5 text-[10px] font-bold text-[#1428A0]">
                신규
              </span>
              <h2 className="text-sm font-bold text-[#0F172A]" id="ticker-feature-discovery-title">
                수급·공매도 근거를 분리해서 확인하세요
              </h2>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[#64748B]">
              개인·외국인·기관계의 1·5·20거래일 누적 수급과 공매도 거래, 공매도 순보유잔고, 대차잔고를 서로 다른 카드로 확인합니다. 세 지표를 하나의 매수·매도 신호로 합산하지 않습니다.
            </p>
            <p className="mt-1 text-[11px] font-semibold text-[#1428A0]">
              교육용 데모 데이터 · 카드별 기준 거래일과 공표일 표시 · 투자판단은 PB 검토 필요
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Link className="btn-primary min-h-11 justify-center" href={flowHref}>
              수급·공매도 바로 보기
            </Link>
            <Link className="btn-outline min-h-11 justify-center" href={momentumHref}>
              가격·모멘텀 보기
            </Link>
          </div>
        </div>
      </section>

      <TickerAnalysisPanel
        clientId={clientId}
        initialSubview={initialSubview}
        initialSymbol={symbol}
        onResolvedSymbolChange={(nextSymbol) => {
          setActiveSelection({ scope: selectionScope, symbol: nextSymbol });
        }}
      />
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
