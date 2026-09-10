"use client";

// 홈 화면 — 오늘 일정 요약 + 시세 전광판(증시·금리 / KODEX ETF).
//
// app/page.tsx 에서 통째로 떼어냈다. 시세 상태와 60초 폴링 effect도 함께 옮겨서,
// page.tsx 에는 인증·PB 관리만 남는다. app/page.tsx 는 luaroy·박상혁이 최근 만지는
// 파일이라 접촉면을 줄이는 게 목적이다.
//
// 브랜딩 문구는 여기 없다 — 로그인 전에도 보여야 해서 page.tsx 에 남겼다.
//
// 이 컴포넌트는 로그인 뒤에만 마운트된다(page.tsx 가 loggedInPbId 로 감싼다).
// 따라서 /api/market · /api/etf 폴링도 로그인 후에 시작된다.

import { useEffect, useState } from "react";
import IndicatorPickerModal from "@/components/IndicatorPickerModal";
import MarketHomeMorningBriefing from "@/components/MarketHomeMorningBriefing";
import MarketHomeTodaySchedule from "@/components/MarketHomeTodaySchedule";
import { getLoggedInPbId } from "@/lib/auth";
import { DEFAULT_INDICATOR_IDS, getIndicator } from "@/lib/marketIndicators";
import {
  loadDashboardIndicators,
  resetDashboardIndicators,
  saveDashboardIndicators,
} from "@/lib/dashboardPrefsStorage";

type MarketTicker = {
  id?: string;
  label: string;
  sub: string;
  value: string;
  change: string;
  up: boolean;
  /** FRED 지표의 관측일. Yahoo 실시간은 null. */
  asOf?: string | null;
  /** true = FRED 동봉 스냅샷 값(실시간 아님). */
  fallback?: boolean;
};
type EtfItem = { code: string; name: string; price: number; changeRate: string; up: boolean; flat: boolean };

// 시세 API 실패 시 화면이 비지 않게 두는 폴백. 이 값이 쓰이는 동안 배지가 "예시"로 표시된다.
const DUMMY_MARKET: MarketTicker[] = [
  { label: "코스피", sub: "KOSPI", value: "2,545.98", change: "+0.87%", up: true },
  { label: "S&P 500", sub: "S&P 500", value: "5,602.23", change: "+1.24%", up: true },
  { label: "원/달러", sub: "USD/KRW", value: "1,372.50", change: "-0.34%", up: false },
  { label: "미국 국채 10Y", sub: "US 10Y", value: "4.46%", change: "-0.03%p", up: false },
  { label: "한국 국채 3Y", sub: "국고채 3년", value: "3.21%", change: "+0.02%p", up: true },
];

export default function HomeMarketBoard() {
  const [market, setMarket] = useState<MarketTicker[]>(DUMMY_MARKET);
  const [marketLive, setMarketLive] = useState(false);
  const [etfs, setEtfs] = useState<EtfItem[]>([]);
  const [rightTab, setRightTab] = useState<"market" | "etf">("market");

  // PB별 전광판 지표 설정. 이 컴포넌트는 로그인 뒤에만 마운트되므로 세션이 반드시 있다.
  // pbId 를 못 읽으면 "default" 스코프로 떨어지고 기본 지표가 나온다.
  const [pbId, setPbId] = useState("");
  const [indicatorIds, setIndicatorIds] = useState<string[]>(DEFAULT_INDICATOR_IDS);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 조회 실패로 전광판에서 빠진 지표 — 고른 게 말없이 사라지지 않게 안내한다. */
  const [failedIds, setFailedIds] = useState<string[]>([]);

  useEffect(() => {
    const id = getLoggedInPbId() ?? "";
    setPbId(id);
    setIndicatorIds(loadDashboardIndicators(id));
  }, []);

  const applyIndicators = (ids: string[]) => {
    setIndicatorIds(ids);
    saveDashboardIndicators(pbId, ids);
  };
  const [marketAt, setMarketAt] = useState<Date | null>(null);

  // indicatorIds 가 바뀌면 폴링을 다시 건다 — 지표를 고르는 즉시 전광판이 갱신된다.
  useEffect(() => {
    let cancelled = false;
    const query = `?ids=${encodeURIComponent(indicatorIds.join(","))}`;
    const loadMarket = () => {
      fetch(`/api/market${query}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled || !d?.ok || !Array.isArray(d.items) || d.items.length === 0) return;
          setMarket(d.items);
          setFailedIds(Array.isArray(d.failedIds) ? d.failedIds : []);
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
  }, [indicatorIds]);

  return (
    <div className="mb-2 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[1.12fr_0.88fr]">
      {/* 좌 — 오늘 일정 요약 + 오늘 모닝 브리핑 */}
      <div className="flex min-h-0 flex-col gap-5">
        {pbId ? <MarketHomeTodaySchedule pbId={pbId} /> : null}
        {pbId ? <MarketHomeMorningBriefing pbId={pbId} /> : null}
      </div>

      {/* 우 — 시세 전광판 (좌측 두 카드 합 높이에 맞춤) */}
        <div className="flex h-full min-h-[360px] flex-col rounded-lg border border-[#E4EBF5] bg-white p-4 shadow-[0_1px_3px_rgba(16,42,86,0.04)] sm:p-5">
          <div className="mb-1 flex items-center justify-between gap-2 border-b border-[#EEF3F9]">
            <div className="flex gap-0">
              <button
                type="button"
                onClick={() => setRightTab("market")}
                className={`relative px-3 pb-2.5 pt-0.5 text-[13px] font-bold transition-colors ${
                  rightTab === "market"
                    ? "text-[#0D57BA] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#0D57BA]"
                    : "text-[#8A97AB] hover:text-[#5B6B82]"
                }`}
              >
                증시 · 금리
              </button>
              <button
                type="button"
                onClick={() => setRightTab("etf")}
                className={`relative px-3 pb-2.5 pt-0.5 text-[13px] font-bold transition-colors ${
                  rightTab === "etf"
                    ? "text-[#0D57BA] after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[#0D57BA]"
                    : "text-[#8A97AB] hover:text-[#5B6B82]"
                }`}
              >
                KODEX ETF
              </button>
            </div>
            {rightTab === "market" ? (
              <div className="mb-2 flex items-center gap-1.5">
                <span
                  className={`flex items-center gap-1 text-[11px] font-medium ${
                    marketLive ? "text-[#16A34A]" : "text-[#8A97AB]"
                  }`}
                >
                  {marketLive ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                      실시간
                      {marketAt && (
                        <span className="text-[#8A97AB]">
                          {marketAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                      )}
                    </>
                  ) : (
                    "예시"
                  )}
                </span>
                {/* 지표 선택 진입점 */}
                <button
                  type="button"
                  aria-label="전광판 지표 선택"
                  title="전광판 지표 선택"
                  onClick={() => setPickerOpen(true)}
                  className="rounded p-1 text-[#8A97AB] transition-colors hover:bg-[#F3F7FD] hover:text-[#5B6B82] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1769D2]/30"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.42 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.42H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .42-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.24.3.44.64.6 1 .14.34.24.7.24 1.08s-.1.74-.24 1.08c-.16.36-.36.7-.6 1Z" />
                  </svg>
                </button>
              </div>
            ) : (
              <span className="mb-2 rounded-md bg-[#F3F6FA] px-2 py-0.5 text-[10px] font-medium text-[#8A97AB]">
                순자산 상위
              </span>
            )}
          </div>

          {rightTab === "market" && (
            <div className="flex flex-1 flex-col justify-between">
              <div>
                {market.map((m) => (
                  <div
                    key={m.id ?? m.label}
                    className="flex items-center justify-between border-b border-[#EEF3F9] py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0 pr-3">
                      <p className="text-[14px] font-semibold text-[#111827]">{m.label}</p>
                      <p className="text-[11px] text-[#8A97AB]">{m.sub}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="flex items-center justify-end gap-1 text-[15px] font-bold tabular-nums text-[#111827]">
                        {/* FRED 스냅샷 폴백 — 실시간이 아니라는 걸 값 옆에서 바로 알 수 있어야 한다.
                            로컬은 FRED_API_KEY 가 자리표시자라 항상 이 배지가 뜬다. */}
                        {m.fallback && (
                          <span
                            title="실시간 조회 실패 — 동봉 스냅샷 값입니다"
                            className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800"
                          >
                            스냅샷
                          </span>
                        )}
                        {m.value}
                      </p>
                      <p className={`text-[12px] font-semibold tabular-nums ${m.up ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                        {m.change}
                        {/* 관측일이 있는 지표(FRED)는 기준일을 함께 보여준다 — 월별 지표를
                            오늘 값으로 오해하지 않게. */}
                        {m.asOf && <span className="ml-1 font-normal text-[#8A97AB]">{m.asOf.slice(2)}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {failedIds.length > 0 && (
                <p className="pt-2 text-[10px] leading-relaxed text-[#8A97AB]">
                  {failedIds
                    .map((id) => getIndicator(id)?.label ?? id)
                    .join(", ")}{" "}
                  — 지금은 조회할 수 없어 표시하지 않았습니다.
                </p>
              )}
            </div>
          )}

          {rightTab === "etf" &&
            (etfs.length === 0 ? (
              <p className="flex flex-1 items-center justify-center py-8 text-center text-sm text-[#8A97AB]">불러오는 중…</p>
            ) : (
              <div className="flex-1">
                {etfs.map((e) => (
                  <a
                    key={e.code}
                    href={`https://finance.naver.com/item/main.naver?code=${e.code}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-2 border-b border-[#EEF3F9] py-3.5 transition-colors last:border-b-0 hover:bg-[#F8FBFF]"
                  >
                    <p className="min-w-0 truncate text-[14px] font-semibold text-[#111827]">{e.name}</p>
                    <div className="shrink-0 text-right">
                      <p className="text-[15px] font-bold tabular-nums text-[#111827]">{e.price.toLocaleString()}원</p>
                      <p className={`text-[12px] font-semibold tabular-nums ${e.flat ? "text-[#8A97AB]" : e.up ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                        {e.changeRate}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            ))}
        </div>

      <IndicatorPickerModal
        open={pickerOpen}
        selected={indicatorIds}
        onChange={applyIndicators}
        onReset={() => setIndicatorIds(resetDashboardIndicators(pbId))}
        onClose={() => setPickerOpen(false)}
      />
      </div>
  );
}
