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
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getClient, listPbs } from "@/lib/store";
import { getLoggedInPbId, clearLoggedInPbId } from "@/lib/auth";
import type { Client } from "@/lib/types";

const MAIN_SECTIONS = [
  { id: "basic", icon: "👤", label: "기본 정보" },
  { id: "consultation", icon: "📝", label: "상담 진행" },
];

const ANALYSIS_TABS = [
  { id: "portfolio", label: "포트폴리오" },
  { id: "portfolio2", label: "포트폴리오 2" },
  { id: "taxProjection", label: "세전·세후" },
  { id: "ips", label: "IPS" },
];

const EXTERNAL_LINKS = [
  { label: "삼성증권", href: "https://www.samsungpop.com" },
  { label: "KODEX ETF", href: "https://www.samsungfund.com" },
];

// 가로 네비 항목 공통 스타일 — shrink-0 + whitespace-nowrap 이 가로 스크롤의 전제다.
function pillClass(active: boolean): string {
  return [
    "shrink-0 whitespace-nowrap rounded-md px-3.5 py-1.5 text-[15px] transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]",
    active ? "bg-[#1428A0] font-semibold text-white" : "text-fg hover:bg-white",
  ].join(" ");
}

interface MoreMenuItem {
  key: string;
  label: string;
  icon: string;
  href: string;
  external?: boolean;
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
                item.external ? (
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

  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = searchParams?.get("tab") ?? "portfolio";

  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    getClient(clientId).then(setClient).catch(() => {});
  }, [clientId]);

  // 로그인한 PB 이름 — 세션만 사용한다(URL pbId로 세션을 만들지 않는다, 인증 우회 차단).
  useEffect(() => {
    let cancelled = false;
    const sessionPbId = getLoggedInPbId();
    if (!sessionPbId) { setPbName(null); return; }
    listPbs()
      .then((pbs) => {
        if (cancelled) return;
        setPbName(pbs.find((p) => p.id === sessionPbId)?.name ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  const handleLogout = () => {
    clearLoggedInPbId();
    setPbName(null);
    router.push("/");
  };

  const goTo = (view: string, tab?: string) => {
    const next = new URLSearchParams({ view });
    if (tab) next.set("tab", tab);
    router.push(`/pb/${pbId}/${clientId}?${next.toString()}`);
  };

  const utilityItems: MoreMenuItem[] = [
    { key: "home", label: "홈", icon: "🏠", href: "/" },
    ...(pbId ? [{ key: "book", label: "다고객 북", icon: "📒", href: `/pb/${pbId}` }] : []),
    ...(pbId ? [{ key: "ticker", label: "티커 분석", icon: "📈", href: `/pb/${pbId}/ticker` }] : []),
    { key: "research", label: "리서치", icon: "📊", href: "/research" },
  ];
  const externalItems: MoreMenuItem[] = EXTERNAL_LINKS.map((l) => ({
    key: l.href,
    label: l.label,
    icon: "↗",
    href: l.href,
    external: true,
  }));

  // 헤더가 사라졌으므로 네비가 최상단(top-0)에 붙는다. 헤더의 z-40을 그대로 물려받는다.
  const shell = "sticky top-0 z-40 border-b border-border bg-[#f0f4fa]";

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

          {/* 2행 — 메인 섹션 + 분석 탭. 좁으면 가로 스크롤 */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 pb-2 lg:px-6 [scrollbar-width:thin] sm:gap-3">
            {MAIN_SECTIONS.map((s) => {
              const isActive =
                (s.id === "basic" && activeView === "home") ||
                (s.id === "consultation" && activeView === "consultation");
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => goTo(s.id === "consultation" ? "consultation" : "home")}
                  aria-current={isActive ? "page" : undefined}
                  className={pillClass(isActive)}
                >
                  <span className="mr-1" aria-hidden="true">{s.icon}</span>
                  {s.label}
                </button>
              );
            })}

            {/* 계층 구분 — 세로선 + 그룹 라벨 */}
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
              분석
            </span>

            {ANALYSIS_TABS.map((t) => {
              const isActive = activeView === "analysis" && activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => goTo("analysis", t.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={pillClass(isActive)}
                >
                  {t.label}
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
