"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usingLocalFallback, DEMO_PB_CREDENTIALS, authenticatePb } from "@/lib/store";
import { getLoggedInPbId, onSessionChanged, setLoggedInPbId } from "@/lib/auth";
import HomeMarketBoard from "@/components/HomeMarketBoard";

const valueItems = [
  { label: "데이터 기반 분석", icon: "chart" },
  { label: "고객 맞춤 솔루션", icon: "users" },
  { label: "리스크 관리", icon: "shield" },
  { label: "지속 가능한 가치", icon: "target" },
] as const;

type IconName = "user" | "lock" | "eye" | "arrow" | (typeof valueItems)[number]["icon"];

function LoginIcon({ name }: { name: IconName }) {
  const paths = {
    user: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.5-4.1 2.7-6.2 6.5-6.2s6 2.1 6.5 6.2" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2.5" /></>,
    eye: <><path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2.2" /></>,
    arrow: <path d="M5 12h13m-4-4 4 4-4 4" />,
    chart: <path d="M4 20V9h4v11m2 0V4h4v16m2 0v-7h4v7M3 20h18" />,
    users: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.3" /><path d="M3 20c.4-4.2 2.4-6.2 6-6.2s5.6 2 6 6.2m0-5.5c3.6-.5 5.5 1.3 6 5.5" /></>,
    shield: <path d="M12 3 20 6v5.3c0 5-3.1 8-8 9.7-4.9-1.7-8-4.7-8-9.7V6l8-3Zm-3 9 2 2 4-4" />,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="m12 12 8-8m-4 0h4v4" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function LoginExperience({ loginEmpId, password, loginError, loginBusy, onEmployeeChange, onPasswordChange, onLogin }: {
  loginEmpId: string;
  password: string;
  loginError: string;
  loginBusy: boolean;
  onEmployeeChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onLogin: () => void;
}) {
  const disabled = loginBusy || !loginEmpId.trim() || !password;
  return (
    <div className="login-landing relative flex min-h-screen w-full overflow-hidden text-white">
      <div className="login-building" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <svg aria-hidden="true" className="login-wave" viewBox="0 0 900 420" preserveAspectRatio="none">{Array.from({ length: 12 }).map((_, index) => <path key={index} d={`M-40 ${400 - index * 15} C 180 ${245 - index * 5}, 390 ${390 - index * 10}, 930 ${80 + index * 11}`} />)}</svg>
      <header className="absolute left-7 top-7 z-20 flex items-center sm:left-12 sm:top-10"><strong className="text-xl font-black tracking-[-0.04em] sm:text-2xl">삼성증권</strong><span className="mx-4 h-8 w-px bg-white/35" /><span className="text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-white/85 sm:text-xs">Samsung<br />Securities</span></header>
      <div className="absolute right-10 top-10 z-20 hidden text-[9px] font-semibold uppercase leading-[1.7] tracking-[0.42em] text-cyan-100/60 md:block">Beyond investing<br />for a better tomorrow<span className="mt-3 block h-px w-7 bg-cyan-100/50" /></div>
      <aside className="absolute bottom-10 left-12 z-20 hidden lg:block"><p className="text-xl font-medium leading-snug text-white/80">투자를 넘어,<br />더 나은 내일을 위해</p><span className="my-4 block h-px w-8 bg-white/55" /><p className="text-[9px] font-semibold uppercase leading-[1.8] tracking-[0.34em] text-white/45">Samsung Securities<br />Private Banking</p></aside>
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center px-4 pb-6 pt-24 sm:px-8 sm:pb-8 sm:pt-28">
        <section className="text-center"><p className="text-sm font-medium text-white/75 sm:text-lg">고객의 오늘을 지키고, 더 큰 내일을 만듭니다.</p><h1 className="mt-3 text-6xl font-black leading-none tracking-[0.08em] text-white sm:text-7xl lg:text-8xl">S.ENERGY</h1><p className="mt-3 text-sm font-bold uppercase tracking-[0.22em] text-cyan-100/85 sm:text-base sm:tracking-[0.28em]">PB Decision Console</p><p className="mt-3 text-[9px] font-semibold uppercase tracking-[0.34em] text-cyan-100/50 sm:text-[11px] sm:tracking-[0.44em]">Samsung Securities · Private Banking</p></section>
        <section className="mt-7 w-full max-w-[460px] rounded-[22px] border border-white/50 bg-white/[0.97] px-6 py-7 text-[#102A56] shadow-[0_24px_70px_rgba(0,10,48,0.34)] backdrop-blur sm:px-10 sm:py-8">
          <div className="text-center"><h2 className="text-2xl font-black tracking-tight">PB 로그인</h2><p className="mt-1.5 text-sm text-[#60728E]">본인의 사원번호와 비밀번호로 로그인하세요.</p></div>
          <div className="mt-6 space-y-3">
            <label className="login-field"><span className="sr-only">사원번호</span><LoginIcon name="user" /><input autoComplete="username" value={loginEmpId} placeholder="사원번호 입력 (예: PB-001)" onChange={(e) => onEmployeeChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !disabled && onLogin()} /></label>
            <label className="login-field"><span className="sr-only">비밀번호</span><LoginIcon name="lock" /><input autoComplete="current-password" type="password" value={password} placeholder="비밀번호 입력" onChange={(e) => onPasswordChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !disabled && onLogin()} /><span className="text-[#90A0B8]"><LoginIcon name="eye" /></span></label>
            {loginError && <p role="alert" className="text-center text-xs font-medium text-red-600">{loginError}</p>}
            <button className="login-submit" onClick={onLogin} disabled={disabled}><span>{loginBusy ? "로그인 중…" : "로그인"}</span><LoginIcon name="arrow" /></button>
          </div>
          <div className="mt-4 text-center"><p className="text-xs font-semibold text-[#48617F]">시연 계정: {DEMO_PB_CREDENTIALS.employeeId} / {DEMO_PB_CREDENTIALS.password}</p><p className="mt-2 text-[10px] text-[#96A3B5]">데모 전용 계정입니다 — 실제 고객 데이터는 포함되어 있지 않습니다.</p></div>
        </section>
        <section aria-label="핵심 가치" className="mt-7 grid w-full max-w-2xl grid-cols-2 md:grid-cols-4">{valueItems.map((item, index) => <div key={item.label} className={`flex min-h-14 items-center justify-center gap-2.5 px-3 text-xs font-medium text-white/80 ${index % 2 ? "border-l border-white/20" : ""} md:border-l md:first:border-l-0`}><span className="text-cyan-300"><LoginIcon name={item.icon} /></span><span>{item.label}</span></div>)}</section>
      </main>
    </div>
  );
}

export default function HomePage() {
  const [loginEmpId, setLoginEmpId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loggedInPbId, setLoggedInPbIdState] = useState<string | null>(null);

  useEffect(() => {
    const syncSession = () => setLoggedInPbIdState(getLoggedInPbId());
    syncSession();
    return onSessionChanged(syncSession);
  }, []);

  // listPbs()/listClients() 호출을 걷어냈다. 두 카드만 쓰던 데이터라, 카드가 사라진
  // 지금은 홈을 열 때마다 쿼리 두 개를 날릴 이유가 없다. PB 목록은 관리 모달을 실제로
  // 열 때 PBManageHost 가 읽는다.

  const handleLogin = async () => {
    setLoginError(""); setLoginBusy(true);
    try {
      const found = await authenticatePb(loginEmpId, password);
      if (!found) { setLoginError("사원번호 또는 비밀번호가 올바르지 않습니다."); return; }
      setLoggedInPbId(found.id, found.name);
      // 로그인 후에는 홈에 머문다. 예전에는 곧바로 /pb/{id} 로 보내서 홈이 사실상
      // 로그인 화면 뒤에 가려져 있었다 — 시세 보드를 볼 기회가 없었고, 홈으로
      // 되돌아오는 동선도 따로 없었다. 홈에서 「PB Home 바로가기」로 넘어간다.
      setLoggedInPbIdState(found.id);
    } finally { setLoginBusy(false); }
  };

  if (!loggedInPbId) return <LoginExperience loginEmpId={loginEmpId} password={password} loginError={loginError} loginBusy={loginBusy} onEmployeeChange={(value) => { setLoginEmpId(value); setLoginError(""); }} onPasswordChange={(value) => { setPassword(value); setLoginError(""); }} onLogin={handleLogin} />;

  return (
    <div className="market-home min-h-[calc(100vh-3.5rem)] bg-[#F5F8FC]">
      <div className="mx-auto max-w-[1120px] px-4 pb-10 pt-6 sm:px-6">
        {/* 헤더: 좌측 Market Home 제목 · 우측 PB Home 바로가기(세션 pbId, ID 하드코딩 금지) */}
        <div className="relative mb-5 overflow-hidden rounded-lg">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,#F7FAFD_0%,#EEF4FB_55%,#E8F0FA_100%)]"
          />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute -right-2 top-0 h-full w-[46%] max-w-[420px] select-none opacity-[0.42]"
            viewBox="0 0 420 220"
            fill="none"
          >
            <rect x="248" y="28" width="118" height="148" rx="10" fill="#D7E6F7" stroke="#B7CFE8" strokeWidth="2" />
            <rect x="262" y="48" width="90" height="8" rx="4" fill="#AFC6DF" />
            <rect x="262" y="68" width="72" height="6" rx="3" fill="#C4D7EB" />
            <rect x="262" y="86" width="80" height="6" rx="3" fill="#C4D7EB" />
            <rect x="262" y="104" width="58" height="6" rx="3" fill="#C4D7EB" />
            <rect x="190" y="70" width="108" height="120" rx="10" fill="#E3EEF9" stroke="#C2D6EB" strokeWidth="2" />
            <rect x="206" y="92" width="76" height="7" rx="3.5" fill="#B5CBE2" />
            <rect x="206" y="110" width="64" height="6" rx="3" fill="#C9DBED" />
            <rect x="206" y="126" width="70" height="6" rx="3" fill="#C9DBED" />
            <path d="M48 168 L92 132 L128 148 L176 96" stroke="#7EA8D6" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="44" y="148" width="18" height="36" rx="3" fill="#9EBFDD" />
            <rect x="72" y="128" width="18" height="56" rx="3" fill="#8FB4D8" />
            <rect x="100" y="138" width="18" height="46" rx="3" fill="#A8C6E2" />
            <rect x="128" y="112" width="18" height="72" rx="3" fill="#7FA9D4" />
            <path d="M168 88 C196 70, 224 74, 248 52" stroke="#6E9FCC" strokeWidth="6" strokeLinecap="round" fill="none" />
            <path d="M236 44 L252 48 L244 62" fill="#6E9FCC" />
            <circle cx="176" cy="96" r="7" fill="#6E9FCC" />
          </svg>
          <div className="relative z-[1] flex flex-wrap items-center justify-between gap-4 px-1 py-3 sm:py-4">
            <div className="min-w-0 max-w-[640px] flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#0D57BA]">
                SAMSUNG SECURITIES · PRIVATE BANKING
              </p>
              <h1 className="mt-1.5 text-[28px] font-black leading-none text-[#111827] sm:text-[30px]">
                Market Home
              </h1>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[#5B6B82] sm:text-sm">
                삼성증권의 노하우로 고객의 상황에 맞춘 시장 정보와 솔루션을 제공합니다.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#8A97AB]">
                ※ 본 도구의 분석·포트폴리오 결과는 참고용이며 투자 권유가 아닙니다.
              </p>
            </div>
            <Link
              href={`/pb/${loggedInPbId}`}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-[#0B57D0] px-5 text-[15px] font-bold text-white shadow-[0_6px_16px_rgba(11,87,208,0.22)] transition-colors hover:bg-[#094BB5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B57D0]/35"
            >
              PB Home 바로가기
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h13m-4-4 4 4-4 4" />
              </svg>
            </Link>
          </div>
        </div>
        <HomeMarketBoard />
        {/* AI Market Intelligence(DailyTopPicksDashboard)는 Market Home 에서 숨긴다.
            컴포넌트·API·크론은 유지하되 홈에는 마운트하지 않는다. */}
        {/* 로컬 모드 경고는 관리자 카드 안에 있었다. 데이터가 브라우저에만 저장된다는
            경고라 관리 기능과 무관하게 계속 보여야 한다. */}
        {usingLocalFallback && (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            ⚠️ 로컬 모드 — Supabase 키 없이 브라우저에만 저장됩니다.
          </p>
        )}
      </div>
    </div>
  );
}
