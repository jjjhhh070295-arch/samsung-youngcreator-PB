"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  clientId: string;
  totalAsset: number; // assetSize (원 단위)
}

interface Alloc {
  stocks: number;
  stocksLive: number;   // 실시간 시세 기준 합계
  stocksFallback: number; // 평균단가 폴백 합계
  realEstate: number;
  cash: number;
  total: number;
}

interface HoldingRow {
  id: string;
  name: string;
  ticker: string | null;
  currency: string;
  quantity: number;
  avg_price: number | null;
}

function formatW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

export default function AssetAllocationBar({ clientId, totalAsset }: Props) {
  const [alloc, setAlloc] = useState<Alloc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    (async () => {
      setLoading(true);
      try {
        const [{ data: holdingData }, { data: propData }] = await Promise.all([
          supabase
            .from("client_holdings")
            .select("id, name, ticker, currency, quantity, avg_price")
            .eq("client_id", clientId),
          supabase
            .from("client_real_estate")
            .select("market_value, ownership_share")
            .eq("client_id", clientId),
        ]);

        const holdings: HoldingRow[] = holdingData ?? [];

        // ① 코드 없는 종목 자동 매핑
        let resolvedHoldings = [...holdings];
        const noTicker = holdings.filter((h) => !h.ticker);
        if (noTicker.length > 0) {
          try {
            const res = await fetch("/api/resolve-tickers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names: noTicker.map((h) => h.name) }),
            });
            const json = await res.json();
            const tickerMap: Record<string, string | null> = json.tickers ?? {};
            resolvedHoldings = holdings.map((h) =>
              tickerMap[h.name] ? { ...h, ticker: tickerMap[h.name] } : h,
            );
          } catch {
            // 매핑 실패 시 avg_price 폴백 사용
          }
        }

        // ② KIS 실시간 현재가 조회
        const tickerRequests = resolvedHoldings
          .filter((h) => h.ticker)
          .map((h) => ({
            ticker: h.ticker!,
            currency: (h.currency === "USD" ? "USD" : "KRW") as "KRW" | "USD",
          }));

        const liveMap = new Map<string, number | null>();
        let fxUsdKrw = 1350;
        if (tickerRequests.length > 0) {
          try {
            const res = await fetch("/api/prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tickers: tickerRequests }),
            });
            const json = await res.json();
            fxUsdKrw = json.fxUsdKrw ?? 1350;
            for (const q of json.quotes ?? []) liveMap.set(q.ticker, q.price ?? null);
          } catch {
            // 시세 조회 실패 — avg_price 폴백 사용
          }
        }

        // ③ 주식 평가금액 계산
        // 우선순위: 실시간 현재가 > 평균단가 > 0
        let stocksLive = 0;
        let stocksFallback = 0;
        for (const h of resolvedHoldings) {
          const qty = h.quantity ?? 0;
          const live = h.ticker ? (liveMap.get(h.ticker) ?? null) : null;
          const fx = h.currency === "USD" ? fxUsdKrw : 1;
          if (live !== null) {
            stocksLive += qty * live * fx;
          } else if (h.avg_price !== null) {
            stocksFallback += qty * h.avg_price * fx;
          }
        }
        const stocks = stocksLive + stocksFallback;

        // ④ 부동산 평가금액
        const realEstate = (propData ?? []).reduce(
          (s: number, p: { market_value: number | null; ownership_share: number }) =>
            s + (p.market_value ?? 0) * (p.ownership_share ?? 1),
          0,
        );

        const base = Math.max(totalAsset, stocks + realEstate);
        const cash = Math.max(0, base - stocks - realEstate);

        setAlloc({ stocks, stocksLive, stocksFallback, realEstate, cash, total: base });
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, totalAsset]);

  if (loading || !alloc || alloc.total === 0) return null;

  // 비중 큰 순으로 정렬 후 0%(반올림 결과 0.0% 포함)는 아예 뺀다.
  const sortedByValue = [
    { label: "주식", value: alloc.stocks, color: "#1428A0" },
    { label: "부동산", value: alloc.realEstate, color: "#f59e0b" },
    { label: "현금·기타", value: alloc.cash, color: "#9ca3af" },
  ]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const withPct = sortedByValue.map((s) => ({ ...s, pct: Math.round((s.value / alloc.total) * 1000) / 10 }));
  const segments = withPct.filter((s) => s.pct > 0);

  if (segments.length === 0) return null;

  // 반올림 오차(예: 1.0+48.4+50.7=100.1%)는 가장 비중이 큰 항목(정렬상 첫 번째)에서 흡수해
  // 합이 정확히 100.0%가 되게 한다.
  const sumPct = segments.reduce((acc, s) => acc + s.pct, 0);
  const diff = Math.round((100 - sumPct) * 10) / 10;
  if (diff !== 0) segments[0].pct = Math.round((segments[0].pct + diff) * 10) / 10;

  // 폴백 종목이 있으면 주식 범례에 표시
  const hasFallback = alloc.stocksFallback > 0;

  // 래퍼 div·"자산 비중" 라벨·구분선 없이 인라인 조각만 반환한다 — 고객 기본 프로필 헤더의
  // "설립일 · 자산규모" 줄에 그대로 이어붙여 쓰기 위함(이 컴포넌트의 유일한 사용처).
  // 각 항목이 스스로 "·" 구분자를 앞에 붙이므로, 부모 쪽 "자산규모" 뒤에도 자연스럽게 이어진다.
  return (
    <>
      {segments.map((s) => (
        <span key={s.label} className="flex items-center gap-1">
          <span className="text-fg-muted/40">·</span>
          <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
          <span>
            {s.label}
            {s.label === "주식" && hasFallback && (
              <span className="ml-0.5 text-[9px] text-fg-muted/60" title="일부 종목은 시세 미연결 — 평균단가 기준">*</span>
            )}
            {" "}<span className="font-semibold text-fg">{s.pct.toFixed(1)}%</span>
            <span className="ml-1 text-[10px]">({formatW(s.value)})</span>
          </span>
        </span>
      ))}
    </>
  );
}
