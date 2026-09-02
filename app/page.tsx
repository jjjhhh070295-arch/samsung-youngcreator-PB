"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUTH_SESSION_CHANGED_EVENT,
  getLoggedInPbSession,
  loginPb,
  type PublicPbSession,
} from "@/lib/auth";
import { LoadingView, ErrorView } from "@/components/StateViews";
import MarketMiniChart from "@/components/MarketMiniChart";
import PBManageModal from "@/components/PBManageModal";
import type {
  PbAdminCreateInput,
  PbAdminDto,
  PbAdminUpdateInput,
} from "@/lib/admin/pbAdmin.shared";

type MarketTicker = { label: string; sub: string; value: string; change: string; up: boolean };
type EtfItem = { code: string; name: string; price: number; changeRate: string; up: boolean; flat: boolean };
type AdminStatus = "idle" | "loading" | "ready" | "denied" | "unavailable" | "error";

const DUMMY_MARKET: MarketTicker[] = [
  { label: "코스피", sub: "KOSPI", value: "2,545.98", change: "+0.87%", up: true },
  { label: "S&P 500", sub: "S&P 500", value: "5,602.23", change: "+1.24%", up: true },
  { label: "원/달러", sub: "USD/KRW", value: "1,372.50", change: "-0.34%", up: false },
  { label: "미국 국채 10Y", sub: "US 10Y", value: "4.46%", change: "-0.03%p", up: false },
  { label: "한국 국채 3Y", sub: "국고채 3년", value: "3.21%", change: "+0.02%p", up: true },
];

export default function HomePage() {
  const router = useRouter();

  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [loadError, setLoadError] = useState("");

  // 로그인 폼 상태
  const [loginEmpId, setLoginEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [session, setSession] = useState<PublicPbSession | null>(null);

  // PB 관리 데이터는 로그인 후에도 서버 관리자 경계를 통과한 경우에만 받는다.
  const [adminPbs, setAdminPbs] = useState<PbAdminDto[]>([]);
  const [adminStatus, setAdminStatus] = useState<AdminStatus>("idle");
  const [adminError, setAdminError] = useState("");
  const [pbManageOpen, setPbManageOpen] = useState(false);
  const adminLoadGeneration = useRef(0);

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

  const loadAdminPbs = useCallback(async (generation: number) => {
    setAdminStatus("loading");
    setAdminError("");
    try {
      const response = await fetch("/api/admin/pbs", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (generation !== adminLoadGeneration.current) return;
      if (!response.ok) {
        setAdminPbs([]);
        setPbManageOpen(false);
        setAdminStatus(
          response.status === 401 || response.status === 403
            ? "denied"
            : response.status === 503
              ? "unavailable"
              : "error",
        );
        return;
      }
      const body = await response.json() as { ok?: boolean; pbs?: unknown };
      if (generation !== adminLoadGeneration.current) return;
      if (!body.ok || !Array.isArray(body.pbs)) throw new Error("Invalid admin response");
      setAdminPbs(body.pbs as PbAdminDto[]);
      setAdminStatus("ready");
    } catch {
      if (generation !== adminLoadGeneration.current) return;
      setAdminPbs([]);
      setPbManageOpen(false);
      setAdminStatus("error");
      setAdminError("PB 관리자 정보를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncSession = async () => {
      const generation = ++adminLoadGeneration.current;
      try {
        const current = await getLoggedInPbSession();
        if (!cancelled && generation === adminLoadGeneration.current) {
          setSession(current);
          setStatus("ready");
          if (current) {
            void loadAdminPbs(generation);
          } else {
            setAdminPbs([]);
            setAdminStatus("idle");
            setPbManageOpen(false);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "세션 확인에 실패했습니다.");
          setStatus("error");
        }
      }
    };
    void syncSession();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
    return () => {
      cancelled = true;
      adminLoadGeneration.current += 1;
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
    };
  }, [loadAdminPbs]);

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

  const handleLogin = async () => {
    setLoginError("");
    setLoginBusy(true);
    try {
      const nextSession = await loginPb(loginEmpId.trim().toUpperCase(), password);
      setSession(nextSession);
      router.push(`/pb/${nextSession.pbId}`);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally {
      setLoginBusy(false);
    }
  };

  const requestAdminMutation = async <T,>(method: "POST" | "PATCH" | "DELETE", body: unknown) => {
    setAdminError("");
    const response = await fetch("/api/admin/pbs", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null) as T | null;
    if (!response.ok || !payload) {
      setAdminError("PB 관리 요청이 거부되었거나 처리되지 않았습니다.");
      throw new Error("PB admin request failed");
    }
    return payload;
  };

  const handleCreatePb = async (data: PbAdminCreateInput) => {
    const result = await requestAdminMutation<{ ok: true; pb: PbAdminDto }>("POST", data);
    await loadAdminPbs(++adminLoadGeneration.current);
    return result.pb;
  };

  const handleUpdatePb = async (id: string, data: PbAdminUpdateInput) => {
    await requestAdminMutation<{ ok: true }>("PATCH", { id, data });
    await loadAdminPbs(++adminLoadGeneration.current);
  };

  const handleDeletePb = async (id: string) => {
    await requestAdminMutation<{ ok: true }>("DELETE", { id });
    await loadAdminPbs(++adminLoadGeneration.current);
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
          onRetry={() => window.location.reload()}
        />
      )}

      {status === "ready" && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
          {/* 로그인 상태 / 로그인 폼 */}
          {session ? (
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
              <div className="mb-6">
                <div className="mb-1 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">
                    ✓
                  </span>
                  <span className="text-base font-bold text-fg">PB 로그인 상태</span>
                </div>
                <p className="text-xs text-fg-muted">홈 화면을 둘러보는 동안에도 로그인 상태가 유지됩니다.</p>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-2 px-4 py-4">
                  <p className="text-xs text-fg-muted">현재 로그인</p>
                  <p className="mt-1 text-base font-bold text-fg">
                    {session.pbName}
                  </p>
                </div>
                <button
                  className="w-full rounded-lg bg-[#1428A0] py-3 text-sm font-bold text-white transition-colors hover:bg-[#1020c0]"
                  onClick={() => router.push(`/pb/${session.pbId}`)}
                >
                  PB 고객관리로 돌아가기
                </button>
              </div>
            </div>
          ) : (
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
                시연 사원번호: PB-001 · 비밀번호는 시연 담당자에게 확인
              </p>
            </div>
          </div>
          )}

          {session && adminStatus === "ready" ? (
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
              <div className="mb-6">
                <p className="text-base font-bold text-fg">관리자</p>
                <p className="text-xs text-fg-muted">서버에서 승인된 관리자만 PB 계정을 관리할 수 있습니다.</p>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
                  <span className="text-sm text-fg">등록된 PB</span>
                  <span className="text-lg font-black text-[#1428A0]">{adminPbs.length}명</span>
                </div>
                <button
                  className="w-full rounded-lg border border-[#1428A0] py-3 text-sm font-bold text-[#1428A0] transition-colors hover:bg-[#1428A0] hover:text-white"
                  onClick={() => setPbManageOpen(true)}
                >
                  PB 계정 관리
                </button>
                {adminError && <p className="text-xs text-red-500">{adminError}</p>}
              </div>
            </div>
          ) : (
            /* 인증 안내 — PB·고객 전체 목록을 로그인 전 브라우저로 보내지 않는다. */
            <div className="rounded-2xl border border-border bg-surface p-8 shadow-card">
              <div className="mb-6">
                <p className="text-base font-bold text-fg">서버 세션 보호</p>
                <p className="text-xs text-fg-muted">PB·고객 원본은 관리자 확인 전에 브라우저로 전송하지 않습니다.</p>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-2 px-4 py-3">
                  <p className="text-sm font-bold text-fg">
                    {adminStatus === "loading" ? "관리자 권한 확인 중" : "HttpOnly 서명 세션"}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                    {adminStatus === "unavailable"
                      ? "관리자 서버 설정 또는 공유 저장소가 준비되지 않아 관리 기능을 차단했습니다."
                      : adminStatus === "error"
                        ? "관리자 정보를 확인하지 못해 관리 기능을 차단했습니다."
                        : "서버가 로그인과 관리자 허용목록을 모두 검증한 경우에만 PB 관리 기능을 엽니다."}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {session && adminStatus === "ready" && (
        <PBManageModal
          open={pbManageOpen}
          pbs={adminPbs}
          clientCountOf={(pbId) => adminPbs.find((pb) => pb.id === pbId)?.clientCount ?? 0}
          onCreate={handleCreatePb}
          onUpdate={handleUpdatePb}
          onDelete={handleDeletePb}
          onClose={() => setPbManageOpen(false)}
        />
      )}
    </div>
  );
}
