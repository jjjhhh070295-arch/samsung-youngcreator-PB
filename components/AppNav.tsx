"use client";

// 상단 가로 네비게이션.
//
// 이전에는 좌측 사이드바(md:w-44)였고 app/layout.tsx가 flex-row로 본문과 나란히 놓았다.
// 가로로 바꾸면 항목이 한 줄에 다 들어가지 않는데, 계층별로 다르게 처리한다:
//   · 메인 섹션(기본정보·상담진행) + 분석 탭 → 2행 중 아래 행에 두고 가로 스크롤(overflow-x-auto).
//     탭은 화면 전환의 주 동선이라 항상 눈에 보여야 하므로 접거나 숨기지 않는다.
//   · 유틸 링크(홈·다고객 북·티커 분석·리서치)와 외부 바로가기 → 우측 "메뉴" 드롭다운.
//     이동 빈도가 낮아 한 단계 숨겨도 손해가 적고, 그만큼 탭이 쓸 가로폭이 늘어난다.
// 계층은 시각적으로도 구분한다 — 메인 섹션과 분석 탭 사이에 세로 구분선 + "분석" 라벨,
// 드롭다운 안에서는 "메뉴"/"바로가기" 그룹 헤더로 나눈다.

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getClient } from "@/lib/store";
import type { Client } from "@/lib/types";

const MAIN_SECTIONS = [
  { id: "basic", icon: "👤", label: "기본 정보" },
  { id: "consultation", icon: "📝", label: "상담 진행" },
];

const ANALYSIS_TABS = [
  { id: "cashflow", label: "현금흐름" },
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
    "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
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
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-fg transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
      >
        <span aria-hidden="true">☰</span>
        <span className="hidden sm:inline">메뉴</span>
        <span aria-hidden="true" className="text-[10px] text-fg-muted">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        // 상단 네비(z-30)보다 위에 떠야 아래 행 탭에 가리지 않는다.
        <div className="absolute right-0 z-40 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
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

export default function AppNav() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pbId = params?.pbId as string | undefined;
  const clientId = params?.clientId as string | undefined;
  const isClientPage = !!(pbId && clientId && !pathname.includes("/ips") && !pathname.includes("/portfolio"));

  const [client, setClient] = useState<Client | null>(null);

  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = searchParams?.get("tab") ?? "cashflow";

  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    getClient(clientId).then(setClient).catch(() => {});
  }, [clientId]);

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

  // ── 고객 상세 페이지: 2행 (컨텍스트 행 + 탭 행) ──
  if (isClientPage) {
    return (
      <nav
        className="sticky top-14 z-30 border-b border-border bg-[#f0f4fa]"
        aria-label="고객 상세 메뉴"
      >
        <div className="mx-auto flex max-w-[1800px] flex-col">
          {/* 1행 — 뒤로가기 · 고객 식별 · 메뉴 드롭다운 */}
          <div className="flex h-11 items-center gap-2 px-4 lg:px-6">
            <button
              type="button"
              onClick={() => router.push(`/pb/${pbId}`)}
              className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
            >
              ← PB 페이지
            </button>
            {client && (
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="hidden shrink-0 text-[10px] text-fg-muted sm:inline">{client.code}</span>
                <span className="truncate text-sm font-bold text-fg">{client.name}</span>
              </div>
            )}
            <div className="ml-auto">
              <MoreMenu
                groups={[
                  { title: "메뉴", items: utilityItems },
                  { title: "바로가기", items: externalItems },
                ]}
              />
            </div>
          </div>

          {/* 2행 — 메인 섹션 + 분석 탭. 좁으면 가로 스크롤 */}
          <div className="flex items-center gap-1 overflow-x-auto px-4 pb-2 lg:px-6 [scrollbar-width:thin]">
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
            <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden="true" />
            <span className="shrink-0 whitespace-nowrap pr-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
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
    <nav className="sticky top-14 z-30 border-b border-border bg-[#f0f4fa]" aria-label="주요 메뉴">
      <div className="mx-auto flex h-11 max-w-[1800px] items-center gap-1 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
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
          <span className="hidden text-[10px] text-fg-muted lg:inline">참고용 · 투자권유 아님</span>
          <MoreMenu groups={[{ title: "바로가기", items: externalItems }]} />
        </div>
      </div>
    </nav>
  );
}
