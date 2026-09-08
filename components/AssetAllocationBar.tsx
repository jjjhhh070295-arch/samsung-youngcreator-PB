"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { identityKeyForSymbol } from "@/lib/pricing/instrumentIdentity";

// 분모는 AUM 이다. 부동산은 여기서 빼지 않는다.
//   2026-09-08 자산 모델 변경(lib/assets.ts) 이후 asset_size 는 그 자체로 AUM(운용자산)이고,
//   부동산은 AUM 밖에 따로 얹히는 값이다. 예전에는 asset_size 가 "부동산 포함 총자산"이라
//   여기서 부동산을 빼 투자가능자산을 역산했는데, 지금 그렇게 하면 이미 부동산이 빠져 있는
//   값에서 한 번 더 빼는 이중 차감이 된다. 그러면 같은 줄 앞에 부모가 찍는 AUM 금액보다
//   분모가 작아져, 기본정보 탭과 포트폴리오 탭의 비중이 서로 다르게 나온다.
//
//   남은 차이는 주식 평가액뿐이다 — 이 컴포넌트만 KIS 실시간 시세(/api/prices)를 쓰고
//   lib/assets.ts 는 평균단가(avg_price)를 쓴다. 분모(AUM)는 양쪽 다 asset_size 를 그대로
//   쓰므로 이제 갈라지지 않고, 달라지는 것은 주식과 현금·기타 사이의 배분뿐이다.
//
//   보유종목 합계가 AUM 을 넘으면 주식이 100% 를 넘고 현금·기타가 0 으로 눌린다. 덮지
//   않는다 — 계산으로 가릴 게 아니라 데이터가 어긋났다는 신호다(lib/assets.ts 와 같은 판단).
interface Props {
  clientId: string;
  /** AUM(원 단위) = parties.asset_size 그대로. 부동산은 여기 포함돼 있지 않다. */
  aum: number;
  /**
   * 값이 바뀌면 다시 읽는다. 보유종목·부동산이 추가/삭제/수정될 때 부모가 올린다.
   * 예전에는 deps 가 [clientId, totalAsset] 뿐이라, 종목을 지워도 이 바는 그대로였고
   * 새로고침하거나 다른 고객으로 갔다 와야 반영됐다.
   */
  refreshKey?: number;
}

interface Alloc {
  stocks: number;
  stocksLive: number;   // 실시간 시세 기준 합계
  stocksFallback: number; // 평균단가 폴백 합계
  realEstate: number;
  cash: number;
  /** 분모로 쓰는 AUM. prop 을 그대로 담는다(부동산 미포함). */
  aum: number;
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

export default function AssetAllocationBar({ clientId, aum, refreshKey = 0 }: Props) {
  const [alloc, setAlloc] = useState<Alloc | null>(null);
  const [loading, setLoading] = useState(true);

  // 시세·종목코드 캐시.
  // 종목을 지웠을 때처럼 "구성만 바뀌고 시세는 그대로"인 갱신에서 /api/prices 와
  // /api/resolve-tickers 를 다시 부르지 않기 위한 것이다. 캐시에 없는 종목만 조회하므로
  // 추가할 때도 새 종목 하나만 물어본다. 고객이 바뀌면 통째로 버린다.
  const cacheRef = useRef<{
    clientId: string;
    prices: Map<string, number | null>;
    names: Map<string, string | null>;
    fx: number;
  }>({ clientId, prices: new Map(), names: new Map(), fx: 1350 });

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    if (cacheRef.current.clientId !== clientId) {
      cacheRef.current = { clientId, prices: new Map(), names: new Map(), fx: 1350 };
    }
    const cache = cacheRef.current;

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

        // ① 코드 없는 종목 자동 매핑 — 아직 물어본 적 없는 이름만
        const unresolved = Array.from(
          new Set(holdings.filter((h) => !h.ticker && !cache.names.has(h.name)).map((h) => h.name)),
        );
        if (unresolved.length > 0) {
          try {
            const res = await fetch("/api/resolve-tickers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ names: unresolved }),
            });
            const json = await res.json();
            const tickerMap: Record<string, string | null> = json.tickers ?? {};
            // 못 찾은 이름도 null 로 기록해 다음 갱신 때 또 묻지 않는다.
            for (const name of unresolved) cache.names.set(name, tickerMap[name] ?? null);
          } catch {
            // 매핑 실패 시 avg_price 폴백 사용. 캐시에 넣지 않아 다음에 다시 시도한다.
          }
        }
        const resolvedHoldings: HoldingRow[] = holdings.map((h) =>
          h.ticker ? h : { ...h, ticker: cache.names.get(h.name) ?? null },
        );

        // ② KIS 실시간 현재가 조회 — 캐시에 없는 종목만. 삭제만 한 갱신이면 여기서
        //    부를 게 없어 API 호출이 아예 일어나지 않는다.
        const wanted = new Map<string, "KRW" | "USD">();
        for (const h of resolvedHoldings) {
          if (!h.ticker || cache.prices.has(h.ticker)) continue;
          wanted.set(h.ticker, h.currency === "USD" ? "USD" : "KRW");
        }

        if (wanted.size > 0) {
          const tickerRequests = Array.from(wanted, ([ticker, currency]) => ({ ticker, currency }));
          try {
            const res = await fetch("/api/prices", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tickers: tickerRequests }),
            });
            const json = await res.json();
            cache.fx = json.fxUsdKrw ?? cache.fx;
            for (const q of json.quotes ?? []) {
              if (!q?.ticker) continue;
              cache.prices.set(q.ticker, q.price ?? null);
              cache.prices.set(
                identityKeyForSymbol(String(q.ticker), q.currency || "KRW"),
                q.price ?? null,
              );
            }
            // 응답에 없던 종목은 null 로 못박아 매 갱신마다 다시 묻지 않게 한다.
            for (const t of Array.from(wanted.keys())) {
              if (!cache.prices.has(t)) cache.prices.set(t, null);
            }
          } catch {
            // 시세 조회 실패 — avg_price 폴백 사용. 캐시에 넣지 않아 다음에 다시 시도한다.
          }
        }
        const liveMap = cache.prices;
        const fxUsdKrw = cache.fx;

        // ③ 주식 평가금액 계산
        // 우선순위: 실시간 현재가 > 평균단가 > 0
        let stocksLive = 0;
        let stocksFallback = 0;
        for (const h of resolvedHoldings) {
          const qty = h.quantity ?? 0;
          const live = h.ticker
            ? (liveMap.get(h.ticker) ??
                liveMap.get(identityKeyForSymbol(h.ticker, h.currency || "KRW")) ??
                null)
            : null;
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

        // AUM 은 넘겨받은 값을 그대로 쓴다. 예전에는 max(assetSize, 주식 + 부동산) 으로
        // 실측이 더 크면 실측을 택했는데, 부동산이 AUM 밖으로 나가면서 그 max 는 의미를
        // 잃었고 실측 초과는 덮지 않고 드러내기로 했다(파일 상단 주석).
        // 현금·기타 = AUM − 주식. 부동산은 애초에 AUM 밖이라 빼지 않는다.
        const cash = Math.max(0, aum - stocks);

        setAlloc({ stocks, stocksLive, stocksFallback, realEstate, cash, aum });
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, aum, refreshKey]);

  // 예전 가드는 total === 0 이었고 total 에 부동산이 들어 있어, 부동산만 가진 고객은
  // 여기를 통과했다. AUM 에서 부동산이 빠진 지금은 둘 다 0 일 때만 숨긴다.
  if (loading || !alloc || (alloc.aum <= 0 && alloc.realEstate <= 0)) return null;

  // 분모 = AUM. 부동산을 빼지 않는 이유는 파일 상단 주석 참고. 부모가 같은 줄 앞에 찍는
  // AUM 금액과 기준이 같아야 비중과 금액이 서로 맞는다.
  const investable = Math.max(0, alloc.aum);

  // 부동산은 비중 계산에서 빼고 아래에서 금액만 따로 보인다 — 화면에서 없애지는 않는다.
  // 분모에 없는 항목에 퍼센트를 붙이면 합이 100%를 넘는다.
  // 비중 큰 순으로 정렬 후 0%(반올림 결과 0.0% 포함)는 아예 뺀다.
  const sortedByValue = [
    { label: "주식", value: alloc.stocks, color: "#1428A0" },
    { label: "현금·기타", value: alloc.cash, color: "#9ca3af" },
  ]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  const withPct = sortedByValue.map((s) => ({
    ...s,
    pct: investable > 0 ? Math.round((s.value / investable) * 1000) / 10 : 0,
  }));
  const segments = withPct.filter((s) => s.pct > 0);

  // 비중 조각이 하나도 없어도 부동산이 있으면 그건 보여준다(부동산만 가진 고객).
  if (segments.length === 0 && alloc.realEstate <= 0) return null;

  // 반올림 오차(예: 48.4+50.7=99.1%)는 가장 비중이 큰 항목(정렬상 첫 번째)에서 흡수해
  // 합이 정확히 100.0%가 되게 한다.
  if (segments.length > 0) {
    const sumPct = segments.reduce((acc, s) => acc + s.pct, 0);
    const diff = Math.round((100 - sumPct) * 10) / 10;
    if (diff !== 0) segments[0].pct = Math.round((segments[0].pct + diff) * 10) / 10;
  }

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
      {alloc.realEstate > 0 && (
        <span className="flex items-center gap-1" title="AUM에 포함되지 않습니다">
          <span className="text-fg-muted/40">·</span>
          <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: "#f59e0b" }} />
          <span>
            부동산 <span className="font-semibold text-fg">{formatW(alloc.realEstate)}</span>
          </span>
        </span>
      )}
    </>
  );
}
