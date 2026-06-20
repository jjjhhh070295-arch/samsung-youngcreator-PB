"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PB, Client } from "@/lib/types";
import {
  listPbs,
  listClients,
  createPb,
  updatePb,
  deletePb,
  usingLocalFallback,
} from "@/lib/store";
import { getLoggedInPbId, setLoggedInPbId } from "@/lib/auth";
import PBManageModal from "@/components/PBManageModal";
import { LoadingView, ErrorView } from "@/components/StateViews";
import MarketMiniChart from "@/components/MarketMiniChart";

type MarketTicker = { label: string; sub: string; value: string; change: string; up: boolean };
type EtfItem = { code: string; name: string; price: number; changeRate: string; up: boolean; flat: boolean };

const DUMMY_MARKET: MarketTicker[] = [
  { label: "코스피", sub: "KOSPI", value: "2,545.98", change: "+0.87%", up: true },
  { label: "S&P 500", sub: "S&P 500", value: "5,602.23", change: "+1.24%", up: true },
  { label: "원/달러", sub: "USD/KRW", value: "1,372.50", change: "-0.34%", up: false },
  { label: "미국 국채 10Y", sub: "US 10Y", value: "4.46%", change: "-0.03%p", up: false },
  { label: "한국 국채 3Y", sub: "국고채 3년", value: "3.21%", change: "+0.02%p", up: true },
];

export default function HomePage() {
  const router = useRouter();

  const [pbs, setPbs] = useState<PB[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [pbManageOpen, setPbManageOpen] = useState(false);
  const [loadError, setLoadError] = useState("");

  // 로그인 폼 상태
  const [loginEmpId, setLoginEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  // 시세
  const [market, setMarket] = useState<MarketTicker[]>(DUMMY_MARKET);
  const [marketLive, setMarketLive] = useState(false);
  const [etfs, setEtfs] = useState<EtfItem[]>([]);
  const [rightTab, setRightTab] = useState<"market" | "etf">("market");
  const [marketAt, setMarketAt] = useState<Date | null>(null);

  // 당일 차트 데이터
  type ChartSeries = { points:{time:string;value:number}[]; prevClose:number|null; delayMinutes:number; startTime:string|null; endTime:string|null };
  const [chartData, setChartData] = useState<{ kospi: ChartSeries; spx: ChartSeries }>({
    kospi: {points:[],prevClose:null,delayMinutes:0,startTime:null,endTime:null},
    spx:   {points:[],prevClose:null,delayMinutes:0,startTime:null,endTime:null},
  });
  const [chartLoading, setChartLoading] = useState(true);

  useEffect(() => {
    fetch("/api/chart", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setChartData(d))
      .catch(() => {})
      .finally(() => setChartLoading(false));
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

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [p, c] = await Promise.all([listPbs(), listClients()]);
      setPbs(p);
      setClients(c);
      setStatus("ready");
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message ?? String(e));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 이미 로그인돼 있으면 PB 페이지로
  useEffect(() => {
    if (status !== "ready") return;
    const pbId = getLoggedInPbId();
    if (pbId && pbs.some((p) => p.id === pbId)) {
      router.replace(`/pb/${pbId}`);
    }
  }, [status, pbs, router]);

  const clientCount = (pbId: string) => clients.filter((c) => c.assignedPbId === pbId).length;

  const handleLogin = async () => {
    setLoginError("");
    setLoginBusy(true);
    try {
      const found = pbs.find(
        (pb) => pb.employeeId === loginEmpId.trim() && pb.password === password
      );
      if (!found) {
        setLoginError("사원번호 또는 비밀번호가 올바르지 않습니다.");
        return;
      }
      setLoggedInPbId(found.id);
      router.push(`/pb/${found.id}`);
    } finally {
      setLoginBusy(false);
    }
  };

  const handleCreatePb = async (data: { name: string; employeeId: string; password: string }) => {
    const pb = await createPb(data);
    await load();
    return pb;
  };

  const handleUpdatePb = async (id: string, data: { name?: string; employeeId?: string; password?: string }) => {
    await updatePb(id, data);
    await load();
  };

  const handleDeletePb = async (id: string) => {
    await deletePb(id);
    await load();
  };

  return (
    <div className="px-6 py-6">
      {/* 히어로 — 좌: 브랜딩 + 실시간 차트 / 우: 시세 전광판 */}
      <div className="mb-10 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* 좌 */}
        <div className="flex flex-col gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-[#1428A0]">
              <span className="h-px w-6 bg-[#1428A0]" />
              SAMSUNG SECURITIES · PRIVATE BANKING
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              삼성증권의 노하우로 <b className="text-fg">고객의 상황에 맞춰 최적의 솔루션</b>을 제공합니다.
            </p>
            <p className="mt-1 text-[11px] text-fg-muted/70">
              ※ 본 도구의 분석·포트폴리오 결과는 참고용이며 투자 권유가 아닙니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MarketMiniChart data={chartData.kospi.points} prevClose={chartData.kospi.prevClose} label="코스피 (KOSPI)" loading={chartLoading} delayMinutes={chartData.kospi.delayMinutes} startTime={chartData.kospi.startTime} endTime={chartData.kospi.endTime} />
            <MarketMiniChart data={chartData.spx.points} prevClose={chartData.spx.prevClose} label="S&P 500" loading={chartLoading} delayMinutes={chartData.spx.delayMinutes} startTime={chartData.spx.startTime} endTime={chartData.spx.endTime} />
          </div>
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

      {/* 로그인 영역 */}
      {status === "loading" && <LoadingView />}
      {status === "error" && (
        <ErrorView
          message={loadError || "불러오기에 실패했습니다."}
          onRetry={load}
        />
      )}

      {status === "ready" && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
          {/* 로그인 폼 */}
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
            <div className="mb-6">
              <div className="mb-1 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1428A0] text-sm font-black text-white">
                  S
                </span>
                <span className="text-base font-bold text-fg">PB 로그인</span>
              </div>
              <p className="text-xs text-fg-muted">본인의 사원번호와 비밀번호로 로그인하세요.</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label">사원번호</label>
                <input
                  className="input"
                  value={loginEmpId}
                  placeholder="사원번호 입력 (예: PB-001)"
                  onChange={(e) => { setLoginEmpId(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              <div>
                <label className="label">비밀번호</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  placeholder="비밀번호 입력"
                  onChange={(e) => { setPassword(e.target.value); setLoginError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>

              {loginError && (
                <p className="text-xs text-red-500">{loginError}</p>
              )}

              <button
                className="w-full rounded-lg bg-[#1428A0] py-3 text-sm font-bold text-white hover:bg-[#1020c0] transition-colors disabled:opacity-50"
                onClick={handleLogin}
                disabled={loginBusy || !loginEmpId.trim() || !password}
              >
                {loginBusy ? "로그인 중…" : "로그인"}
              </button>

              <p className="text-center text-[11px] text-fg-muted">
                사원번호는 관리자에게 문의하세요
              </p>
            </div>
          </div>

          {/* 관리자 패널 */}
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
            <div className="mb-6">
              <p className="text-base font-bold text-fg">관리자</p>
              <p className="text-xs text-fg-muted">PB 계정 등록 및 관리</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
                <span className="text-sm text-fg">등록된 PB</span>
                <span className="text-lg font-black text-[#1428A0]">{pbs.length}명</span>
              </div>
              <button
                className="w-full rounded-lg border border-[#1428A0] py-3 text-sm font-bold text-[#1428A0] hover:bg-[#1428A0] hover:text-white transition-colors"
                onClick={() => setPbManageOpen(true)}
              >
                PB 계정 관리
              </button>
            </div>

            {usingLocalFallback && (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 border border-amber-200">
                ⚠️ 로컬 모드 — Supabase 키 없이 브라우저에만 저장됩니다.
              </p>
            )}
          </div>
        </div>
      )}

      <PBManageModal
        open={pbManageOpen}
        pbs={pbs}
        clientCountOf={clientCount}
        onCreate={handleCreatePb}
        onUpdate={handleUpdatePb}
        onDelete={handleDeletePb}
        onClose={() => setPbManageOpen(false)}
      />
    </div>
  );
}
