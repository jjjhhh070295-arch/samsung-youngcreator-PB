"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Props {
  clientId: string;
  totalAsset: number; // assetSize (원 단위)
}

interface Alloc {
  stocks: number;
  realEstate: number;
  cash: number;
  total: number;
}

function formatW(n: number) {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

export default function AssetAllocationBar({ clientId, totalAsset }: Props) {
  const [alloc, setAlloc] = useState<Alloc | null>(null);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const [{ data: holdings }, { data: props }] = await Promise.all([
        supabase.from("client_holdings").select("quantity, avg_price").eq("client_id", clientId),
        supabase.from("client_real_estate").select("market_value, ownership_share").eq("client_id", clientId),
      ]);

      const stocks = (holdings ?? []).reduce(
        (s: number, h: { quantity: number; avg_price: number | null }) =>
          s + (h.quantity ?? 0) * (h.avg_price ?? 0),
        0
      );

      const realEstate = (props ?? []).reduce(
        (s: number, p: { market_value: number | null; ownership_share: number }) =>
          s + (p.market_value ?? 0) * (p.ownership_share ?? 1),
        0
      );

      const base = Math.max(totalAsset, stocks + realEstate);
      const cash = Math.max(0, base - stocks - realEstate);

      setAlloc({ stocks, realEstate, cash, total: base });
    })();
  }, [clientId, totalAsset]);

  if (!alloc || alloc.total === 0) return null;

  const segments = [
    { label: "주식", value: alloc.stocks, color: "#1428A0" },
    { label: "부동산", value: alloc.realEstate, color: "#f59e0b" },
    { label: "현금·기타", value: alloc.cash, color: "#9ca3af" },
  ].filter((s) => s.value > 0);

  if (segments.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted mb-2">자산 비중</p>

      {/* 가로 바 */}
      <div className="flex h-5 w-full rounded-full overflow-hidden gap-px">
        {segments.map((s) => {
          const pct = (s.value / alloc.total) * 100;
          return (
            <div
              key={s.label}
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${formatW(s.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* 범례 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => {
          const pct = ((s.value / alloc.total) * 100).toFixed(1);
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-fg-muted">
                {s.label} <span className="font-semibold text-fg">{pct}%</span>
                <span className="ml-1 text-[10px]">({formatW(s.value)})</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
