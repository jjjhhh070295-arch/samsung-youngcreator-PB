"use client";

// 상단 가로 네비게이션 — 기존 Header(로고·PB명·로그아웃)를 이 안으로 통합했다.
//
// 이전 구조: [헤더 h-14] + [네비 1행 h-11] (+ 고객 상세는 [탭 행] 추가) = 최대 3줄.
// 현재 구조: [통합 1행 h-11] (+ 고객 상세는 [탭 행] 추가) = 최대 2줄.
// 헤더 한 줄(3.5rem)을 통째로 없애고 로고를 1줄짜리로 줄여 세로를 압축했다.
//
// 1행 배치: 왼쪽 끝 컨텍스트(뒤로가기·고객 식별 / 또는 유틸 링크)
//           → 오른쪽 끝 PB명 · 로그아웃 · 메뉴 드롭다운.
// 로고 블록은 뺐다 — 세로뿐 아니라 가로도 아껴서 컨텍스트를 왼쪽 끝에 붙인다.
// 고객 상세의 "← PB 페이지 / 코드 / 이름"은 별도 줄을 쓰지 않고 1행에 합쳤다 —
// 한 줄을 통째로 아끼는 게 이번 변경의 목적이고, 좁아지면 고객 코드부터 숨긴다.
//
// 항목이 가로로 다 안 들어가는 문제는 계층별로 다르게 처리한다:
//   · 분석 탭 → 2행에 두고 가로 스크롤(overflow-x-auto). 화면 전환의 주 동선이라 숨기지 않는다.
//   · 유틸 링크·외부 바로가기 → 우측 "메뉴" 드롭다운. 이동 빈도가 낮아 한 단계 숨겨도 된다.

import Link from "next/link";
import { openPbManage } from "@/lib/pbManage";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getClient, listPbs } from "@/lib/store";
import { getLoggedInPbId, getLoggedInPbName, clearLoggedInPbId, onSessionChanged } from "@/lib/auth";
import type { Client } from "@/lib/types";
import {
  isBasicWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import SessionCountdown from "@/components/SessionCountdown";

/** 고객 상세 메인 워크플로 — 기본 정보 → 포트폴리오 → IPS → 고객화면 */
const CLIENT_WORKFLOW_TABS = [
  { id: "basic", icon: "👤", label: "기본 정보", view: "home" as const },
  { id: "portfolio2", icon: "📊", label: "포트폴리오", view: "analysis" as const, tab: "portfolio2" },
  { id: "ips", icon: "📄", label: "IPS", view: "analysis" as const, tab: "ips" },
  { id: "customer", icon: "🖥️", label: "고객화면", view: "analysis" as const, tab: "customer" },
] as const;

const EXTERNAL_LINKS = [
  { label: "삼성증권", href: "https://www.samsungpop.com" },
  { label: "KODEX ETF", href: "https://www.samsungfund.com" },
];

// 가로 네비 항목 공통 스타일 — shrink-0 + whitespace-nowrap 이 가로 스크롤의 전제다.
function pillClass(active: boolean, disabled = false): string {
  if (disabled) {
    return [
      "shrink-0 whitespace-nowrap rounded-md px-3.5 py-1.5 text-[15px]",
      "cursor-not-allowed opacity-40 text-fg-muted",
      "focus-visible:outline-none",
    ].join(" ");
  }
  return [
    "shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]",
    active ? "bg-[#1428A0] font-bold text-white shadow-[0_4px_12px_rgba(20,40,160,0.18)]" : "font-medium text-slate-600 hover:bg-slate-100 hover:text-[#1428A0]",
  ].join(" ");
}

interface MoreMenuItem {
  key: string;
  label: string;
  icon: string;
  /** action 항목에는 이동이 없으므로 빈 문자열을 넣는다. */
  href: string;
  external?: boolean;
  /** 이동 대신 실행할 동작. 있으면 링크가 아니라 버튼으로 그린다(예: PB 계정 관리 모달). */
  action?: () => void;
}

interface MoreMenuGroup {
  title: string;
  items: MoreMenuItem[];
}

/** 우측 "메뉴" 드롭다운 — 유틸 링크와 외부 바로가기를 담는다. */
function MoreMenu({ groups }: { groups: MoreMenuGroup[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="메뉴 및 바로가기"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
      >
        <span aria-hidden="true">☰</span>
        <span aria-hidden="true" className="text-[10px] text-fg-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        // 상단 네비(z-40)보다 위에 떠야 아래 행 탭에 가리지 않는다.
        <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          {groups.map((g, gi) => (
            <div key={g.title} className={gi > 0 ? "mt-1 border-t border-border pt-1" : ""}>
              <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {g.title}
              </p>
              {g.items.map((item) =>
                item.action ? (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      item.action!();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-2"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ) : item.external ? (
                  <a
                    key={item.key}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-2"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </a>
                ) : (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-surface-2"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 오른쪽 끝 계정 영역 — 기존 Header의 PB명 + 로그아웃. */
function AccountArea({ pbName, onLogout }: { pbName: string | null; onLogout: () => void }) {
  if (!pbName) return null;
  return (
    <>
      <span className="hidden whitespace-nowrap text-xs text-fg-muted md:inline">{pbName} PB</span>
      {/* 이름(누구) → 세션 잔여(상태) → 로그아웃(조작) 순서. 두 네비 레이아웃이
          모두 AccountArea 를 쓰므로 여기 한 곳만 손보면 된다. */}
      <SessionCountdown />
      <button
        type="button"
        onClick={onLogout}
        className="shrink-0 whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
      >
        로그아웃
      </button>
    </>
  );
}

export default function AppNav() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pbId = params?.pbId as string | undefined;
  const clientId = params?.clientId as string | undefined;
  const isClientPage = !!(pbId && clientId && !pathname.includes("/ips") && !pathname.includes("/portfolio"));

  const [client, setClient] = useState<Client | null>(null);
  const [pbName, setPbName] = useState<string | null>(null);
  // 세션의 PB id. 경로에 pbId 가 없는 화면(홈·리서치)에서도 PB 링크를 만들려고 둔다.
  const [sessionPbId, setSessionPbId] = useState<string | null>(null);

  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = searchParams?.get("tab") ?? "portfolio2";

  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    let cancelled = false;
    const reload = () => {
      getClient(clientId)
        .then((c) => { if (!cancelled) setClient(c); })
        .catch(() => {});
    };
    reload();
    window.addEventListener("pb-client-updated", reload);
    window.addEventListener("pb-evidence-updated", reload);
    return () => {
      cancelled = true;
      window.removeEventListener("pb-client-updated", reload);
      window.removeEventListener("pb-evidence-updated", reload);
    };
  }, [clientId]);

  // 로그인한 PB 이름 — 세션만 사용한다(URL pbId로 세션을 만들지 않는다, 인증 우회 차단).
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      const sid = getLoggedInPbId();
      setSessionPbId(sid);
      if (!sid) { setPbName(null); return; }
      // 세션에 저장된 이름으로 먼저 그린다 — 목록 조회를 기다리지 않고, 조회가
      // 실패해도(로컬 폴백엔 데모 PB만 있다) 이름이 사라지지 않는다.
      setPbName(getLoggedInPbName());
      listPbs()
        .then((pbs) => {
          if (cancelled) return;
          setPbName(pbs.find((p) => p.id === sid)?.name ?? getLoggedInPbName());
        })
        .catch(() => {});
    };
    sync();
    const unsubscribe = onSessionChanged(sync);
    return () => { cancelled = true; unsubscribe(); };
  }, [pathname]);

  const handleLogout = () => {
    clearLoggedInPbId();
    setPbName(null);
    router.push("/");
  };

  const basicApproved = client ? isBasicWorkflowApproved(client) : false;
  const portfolioApproved = client ? isPortfolioWorkflowApproved(client) : false;

  const goTo = (view: string, tab?: string) => {
    if (tab === "portfolio2" && !basicApproved) {
      alert("기본정보 승인 후 포트폴리오를 진행할 수 있습니다.");
      return;
    }
    if ((tab === "ips" || tab === "customer") && !portfolioApproved) {
      alert(
        tab === "customer"
          ? "고객화면을 표시하려면 포트폴리오 승인과 IPS 검토가 필요합니다."
          : "포트폴리오 승인 후 IPS를 확정할 수 있습니다.",
      );
      return;
    }
    const next = new URLSearchParams({ view });
    if (tab) next.set("tab", tab);
    router.push(`/pb/${pbId}/${clientId}?${next.toString()}`);
  };

  // PB 링크는 URL 의 pbId 가 없으면 세션 값으로 대신한다. 홈(/)·리서치처럼 경로에
  // pbId 가 없는 화면에서는 "고객조회"·"티커 분석"이 통째로 빠져 PB 화면으로 돌아갈
  // 길이 없었다. 세션에서 읽으므로 URL 에 남의 pbId 를 넣어 만드는 우회는 생기지 않는다
  // (pbName 을 세션에서만 읽는 위 useEffect 와 같은 원칙이다).
  const navPbId = pbId ?? sessionPbId;

  const utilityItems: MoreMenuItem[] = [
    { key: "home", label: "홈", icon: "🏠", href: "/" },
    ...(navPbId ? [{ key: "book", label: "고객조회", icon: "📒", href: `/pb/${navPbId}` }] : []),
    ...(navPbId ? [{ key: "ticker", label: "티커 분석", icon: "📈", href: `/pb/${navPbId}/ticker` }] : []),
    { key: "research", label: "리서치", icon: "📊", href: "/research" },
    { key: "research-links", label: "스몰캡 리서치", icon: "🔎", href: "/research-links" },
    // PB 계정 관리 — 예전에는 홈 화면 카드로만 열 수 있어 관리하려면 홈으로 돌아가야 했다.
    // 이동이 아니라 모달을 여는 항목이라 action 을 쓴다(lib/pbManage.ts 주석 참고).
    { key: "pb-manage", label: "PB 계정 관리", icon: "👤", href: "", action: openPbManage },
  ];
  const externalItems: MoreMenuItem[] = EXTERNAL_LINKS.map((l) => ({
    key: l.href,
    label: l.label,
    icon: "↗",
    href: l.href,
    external: true,
  }));

  // 헤더가 사라졌으므로 네비가 최상단(top-0)에 붙는다. 헤더의 z-40을 그대로 물려받는다.
  const shell = "sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-[0_1px_8px_rgba(15,23,42,0.04)] backdrop-blur";

  const isPbHome = !!pbId && !clientId && pathname === `/pb/${pbId}`;

  if (isPbHome) {
    const pbHomeLinks = [
      { label: "PB Home", href: `/pb/${pbId}`, active: true },
      { label: "고객", href: `#customer-book` },
      { label: "상담", href: `#today-schedule` },
      { label: "포트폴리오", href: `/pb/${pbId}/ticker` },
      { label: "리서치", href: "/research" },
    ];
    return (
      <nav className="sticky top-0 z-40 border-b border-[#0D57BA] bg-[#1769D2] text-white" aria-label="PB Home 주요 메뉴">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center px-3 sm:px-4 lg:px-8">
          <Link href="/" className="shrink-0 text-lg font-black tracking-[-0.04em] text-white">삼성증권</Link>
          <span className="mx-3 hidden h-5 w-px bg-white/30 sm:block" aria-hidden="true" />
          <span className="hidden shrink-0 text-[10px] font-medium text-white/80 sm:block">PRIVATE BANKING</span>
          <div className="ml-4 flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none] sm:ml-8">
            {pbHomeLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={`relative flex h-14 shrink-0 items-center px-3 text-[13px] font-semibold transition-colors ${item.active ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-white" : "text-white/80 hover:text-white"}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="ml-3 hidden shrink-0 items-center gap-2 text-xs text-white/90 md:flex">
            <span className="h-2 w-2 rounded-full bg-[#8BE0BE]" aria-hidden="true" />
            <span>{pbName ? `${pbName} PB` : "PB"}</span>
            <button type="button" onClick={handleLogout} className="rounded px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 hover:text-white">로그아웃</button>
          </div>
        </div>
      </nav>
    );
  }

  // ── 고객 상세 페이지: 2행 (통합 1행 + 탭 행) ──
  if (isClientPage) {
    return (
      <nav className={shell} aria-label="고객 상세 메뉴">
        <div className="mx-auto flex max-w-[1800px] flex-col">
          {/* 1행 — 로고 · 뒤로가기 · 고객 식별 · 계정 · 메뉴 */}
          <div className="flex h-11 items-center gap-2 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => router.push(`/pb/${pbId}`)}
              className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-1 text-xs text-fg-muted transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
            >
              ← PB 페이지
            </button>
            {client && (
              <div className="flex min-w-0 items-baseline gap-1.5">
                <span className="hidden shrink-0 text-[10px] text-fg-muted sm:inline">{client.code}</span>
                <span className="truncate text-sm font-bold text-fg">{client.name}</span>
              </div>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <AccountArea pbName={pbName} onLogout={handleLogout} />
              <MoreMenu
                groups={[
                  { title: "메뉴", items: utilityItems },
                  { title: "바로가기", items: externalItems },
                ]}
              />
            </div>
          </div>

          {/* 2행 — 기본 정보 / 포트폴리오 / IPS / 고객화면 */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 lg:px-6 [scrollbar-width:thin] sm:gap-3">
            {CLIENT_WORKFLOW_TABS.map((s) => {
              const isActive =
                s.view === "home"
                  ? activeView === "home"
                  : activeView === "analysis" && "tab" in s && activeTab === s.tab;
              const disabled =
                s.id === "portfolio2"
                  ? !basicApproved
                  : s.id === "ips" || s.id === "customer"
                    ? !portfolioApproved
                    : false;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  onClick={() => {
                    if (disabled) return;
                    goTo(s.view, "tab" in s ? s.tab : undefined);
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={pillClass(isActive, disabled)}
                  title={
                    disabled
                      ? s.id === "portfolio2"
                        ? "기본정보 승인 후 포트폴리오를 진행할 수 있습니다."
                        : s.id === "customer"
                          ? "고객화면을 표시하려면 포트폴리오 승인과 IPS 검토가 필요합니다."
                          : "포트폴리오 승인 후 IPS를 확정할 수 있습니다."
                      : undefined
                  }
                >
                  <span className="mr-1" aria-hidden="true">{s.icon}</span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    );
  }

  // ── 일반 페이지: 1행 ──
  return (
    <nav className={shell} aria-label="주요 메뉴">
      <div className="mx-auto flex h-11 max-w-[1800px] items-center gap-2 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:thin]">
          {utilityItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={pillClass(pathname === item.href)}
            >
              <span className="mr-1" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AccountArea pbName={pbName} onLogout={handleLogout} />
          <MoreMenu groups={[{ title: "바로가기", items: externalItems }]} />
        </div>
      </div>
    </nav>
  );
}
