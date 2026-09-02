"use client";

// 홈 화면 시세 영역 — 당일 미니차트 2개(코스피·S&P500) + 우측 전광판(증시·금리 / KODEX ETF).
//
// app/page.tsx 에서 통째로 떼어냈다. 시세 상태와 60초 폴링 effect 두 개도 함께 옮겨서,
// page.tsx 에는 인증·PB 관리만 남는다. app/page.tsx 는 luaroy·박상혁이 최근 만지는
// 파일이라 접촉면을 줄이는 게 목적이다.
//
// 브랜딩 문구는 여기 없다 — 로그인 전에도 보여야 해서 page.tsx 에 남겼다.
//
// 이 컴포넌트는 로그인 뒤에만 마운트된다(page.tsx 가 loggedInPbId 로 감싼다).
// 따라서 /api/chart · /api/market · /api/etf 폴링도 로그인 후에 시작된다.

import { useEffect, useState } from "react";
import MarketMiniChart from "@/components/MarketMiniChart";

type MarketTicker = { label: string; sub: string; value: string; change: string; up: boolean };
type EtfItem = { code: string; name: string; price: number; changeRate: string; up: boolean; flat: boolean };

// 시세 API 실패 시 화면이 비지 않게 두는 폴백. 이 값이 쓰이는 동안 배지가 "예시"로 표시된다.
const DUMMY_MARKET: MarketTicker[] = [
  { label: "코스피", sub: "KOSPI", value: "2,545.98", change: "+0.87%", up: true },
  { label: "S&P 500", sub: "S&P 500", value: "5,602.23", change: "+1.24%", up: true },
  { label: "원/달러", sub: "USD/KRW", value: "1,372.50", change: "-0.34%", up: false },
  { label: "미국 국채 10Y", sub: "US 10Y", value: "4.46%", change: "-0.03%p", up: false },
  { label: "한국 국채 3Y", sub: "국고채 3년", value: "3.21%", change: "+0.02%p", up: true },
];

type ChartSeries = { points: { time: string; value: number }[]; prevClose: number | null; delayMinutes: number; startTime: string | null; endTime: string | null };

export default function HomeMarketBoard() {
  const [market, setMarket] = useState<MarketTicker[]>(DUMMY_MARKET);
  const [marketLive, setMarketLive] = useState(false);
  const [etfs, setEtfs] = useState<EtfItem[]>([]);
  const [rightTab, setRightTab] = useState<"market" | "etf">("market");
  const [marketAt, setMarketAt] = useState<Date | null>(null);

  const [chartData, setChartData] = useState<{ kospi: ChartSeries; spx: ChartSeries }>({
    kospi: { points: [], prevClose: null, delayMinutes: 0, startTime: null, endTime: null },
    spx: { points: [], prevClose: null, delayMinutes: 0, startTime: null, endTime: null },
  });
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadCharts = async () => {
      try {
        const response = await fetch("/api/chart", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setChartData(data);
      } catch {
        // 일시적 갱신 실패 시 마지막 정상 차트를 유지한다.
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    };

    loadCharts();
    const id = window.setInterval(loadCharts, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadMarket = () => {
      fetch("/api/market", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d?.ok || !Array.isArray(d.items) || d.items.length === 0) return;
          setMarket(d.items);
          setMarketLive(true);
          setMarketAt(new Date());
        })
        .catch(() => {});
      fetch("/api/etf", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d?.ok || !Array.isArray(d.items)) return;
          setEtfs(d.items);
        })
        .catch(() => {});
    };
    loadMarket();
    const id = setInterval(loadMarket, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="mb-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* 좌 — 당일 미니차트 */}
      <div className="grid grid-cols-2 gap-3">
        <MarketMiniChart data={chartData.kospi.points} prevClose={chartData.kospi.prevClose} label="코스피 (KOSPI)" loading={chartLoading} delayMinutes={chartData.kospi.delayMinutes} startTime={chartData.kospi.startTime} endTime={chartData.kospi.endTime} />
        <MarketMiniChart data={chartData.spx.points} prevClose={chartData.spx.prevClose} label="S&P 500" loading={chartLoading} delayMinutes={chartData.spx.delayMinutes} startTime={chartData.spx.startTime} endTime={chartData.spx.endTime} />
      </div>

      {/* 우 — 시세 전광판 */}
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex gap-1">
              <button
                onClick={() => setRightTab("market")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                  rightTab === "market" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                증시 · 금리
              </button>
              <button
                onClick={() => setRightTab("etf")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold transition-colors ${
                  rightTab === "etf" ? "bg-surface-2 text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                KODEX ETF
              </button>
            </div>
            {rightTab === "market" ? (
              <span
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${
                  marketLive ? "bg-green-500/15 text-green-500" : "bg-surface-2 text-fg-muted"
                }`}
              >
                {marketLive ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> 실시간
                    {marketAt && (
                      <span className="ml-1 opacity-70">
                        {marketAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    )}
                  </>
                ) : "예시"}
              </span>
            ) : (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                순자산 상위
              </span>
            )}
          </div>

          {rightTab === "market" && (
            <div className="space-y-0.5">
              {market.map((m) => (
                <div
                  key={m.label}
                  className="flex items-center justify-between rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-fg">{m.label}</p>
                    <p className="text-[11px] text-fg-muted">{m.sub}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-fg">{m.value}</p>
                    <p className={`text-[11px] font-medium ${m.up ? "text-green-500" : "text-red-500"}`}>
                      {m.change}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rightTab === "etf" &&
            (etfs.length === 0 ? (
              <p className="py-8 text-center text-sm text-fg-muted">불러오는 중…</p>
            ) : (
              <div className="space-y-0.5">
                {etfs.map((e) => (
                  <a
                    key={e.code}
                    href={`https://finance.naver.com/item/main.naver?code=${e.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2"
                  >
                    <p className="min-w-0 truncate text-sm font-semibold text-fg">{e.name}</p>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold text-fg">{e.price.toLocaleString()}원</p>
                      <p className={`text-[11px] font-medium ${e.flat ? "text-fg-muted" : e.up ? "text-green-500" : "text-red-500"}`}>
                        {e.changeRate}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ))}
        </div>
      </div>
  );
}
