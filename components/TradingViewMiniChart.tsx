"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string;
  label: string;
}

export default function TradingViewMiniChart({ symbol, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    container.appendChild(inner);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.async = true;
    script.textContent = JSON.stringify({
      symbol,
      width: "100%",
      height: 200,
      locale: "kr",
      dateRange: "1D",
      colorTheme: "light",
      trendLineColor: "#1428A0",
      underLineColor: "rgba(20, 40, 160, 0.08)",
      underLineBottomColor: "rgba(255,255,255,0)",
      isTransparent: true,
      autosize: true,
      largeChartUrl: "",
    });
    container.appendChild(script);

    return () => { container.innerHTML = ""; };
  }, [symbol]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="mb-2 text-xs font-semibold text-fg-muted">{label}</p>
      <div ref={containerRef} className="tradingview-widget-container h-[200px]" />
    </div>
  );
}
