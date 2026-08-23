"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getClient } from "@/lib/store";
import type { Client } from "@/lib/types";

const MAIN_SECTIONS = [
  { id: "basic", icon: "👤", label: "기본 정보" },
  { id: "consultation", icon: "📝", label: "상담 진행" },
];

const ANALYSIS_TABS = [
  { id: "factors", label: "7요인" },
  { id: "cashflow", label: "현금흐름" },
  { id: "portfolio", label: "포트폴리오" },
  { id: "recommend", label: "상품추천" },
  { id: "taxProjection", label: "세전·세후" },
  { id: "stress", label: "스트레스" },
  { id: "ips", label: "IPS" },
];

const EXTERNAL_LINKS = [
  { label: "삼성증권", href: "https://www.samsungpop.com" },
  { label: "KODEX ETF", href: "https://www.samsungfund.com" },
];

export default function AppNav() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pbId = params?.pbId as string | undefined;
  const clientId = params?.clientId as string | undefined;
  const isClientPage = !!(pbId && clientId && !pathname.includes("/ips") && !pathname.includes("/portfolio"));

  const [client, setClient] = useState<Client | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = searchParams?.get("tab") ?? "factors";

  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    getClient(clientId).then(setClient).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const goTo = (view: string, tab?: string) => {
    const params = new URLSearchParams({ view });
    if (tab) params.set("tab", tab);
    setMobileOpen(false);
    router.push(`/pb/${pbId}/${clientId}?${params.toString()}`);
  };

  // ── 고객 상세 페이지용 사이드바 ──
  if (isClientPage) {
    const activeLabel =
      activeView === "home"
        ? "기본 정보"
        : activeView === "consultation"
          ? "상담 진행"
          : ANALYSIS_TABS.find((tab) => tab.id === activeTab)?.label ?? "분석";

    return (
      <aside className="sticky top-14 z-30 flex w-full shrink-0 flex-col border-b border-border bg-[#f0f4fa] md:h-[calc(100vh-3.5rem)] md:w-44 md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2C3EE8] md:hidden"
          aria-expanded={mobileOpen}
          aria-controls="client-mobile-navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-muted">현재 메뉴</span>
            <span className="font-bold">{activeLabel}</span>
          </span>
          <span aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
        </button>

        <div
          id="client-mobile-navigation"
          className={`${mobileOpen ? "flex" : "hidden"} max-h-[calc(100vh-7rem)] flex-col overflow-y-auto border-t border-border md:flex md:max-h-none md:flex-1 md:border-t-0`}
        >
          <button
            type="button"
            className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-xs text-fg-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2C3EE8]"
            onClick={() => {
              setMobileOpen(false);
              router.push(`/pb/${pbId}`);
            }}
          >
            ← PB 페이지
          </button>

          {client && (
            <div className="shrink-0 border-b border-border px-4 py-3">
              <p className="text-[10px] text-fg-muted">{client.code}</p>
              <p className="truncate text-sm font-bold text-fg">{client.name}</p>
            </div>
          )}

          <nav className="flex-1 py-1" aria-label="고객 상세 메뉴">
          {/* 기본정보 · 상담진행 */}
          {MAIN_SECTIONS.map((s) => {
            const isActive = (s.id === "basic" && activeView === "home") || (s.id === "consultation" && activeView === "consultation");
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id === "consultation" ? "consultation" : "home")}
                aria-current={isActive ? "page" : undefined}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                  isActive ? "bg-[#1428A0] text-white font-semibold" : "text-fg hover:bg-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </span>
                <span className={isActive ? "text-white/60" : "text-fg-muted"}>›</span>
              </button>
            );
          })}

          {/* 분석 탭 */}
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
            분석
          </p>
          {ANALYSIS_TABS.map((t) => {
            const isActive = activeView === "analysis" && activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => goTo("analysis", t.id)}
                aria-current={isActive ? "page" : undefined}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                  isActive
                    ? "bg-[#1428A0] text-white font-semibold"
                    : "text-fg hover:bg-white"
                }`}
              >
                <span>{t.label}</span>
                <span className={isActive ? "text-white/60" : "text-fg-muted"}>›</span>
              </button>
            );
          })}

          <div className="border-t border-border mt-2 pt-2">
            <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">메뉴</p>
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
              🏠 홈
            </Link>
            {pbId && (
              <Link href={`/pb/${pbId}`} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
                📒 다고객 북
              </Link>
            )}
            {pbId && (
              <Link href={`/pb/${pbId}/ticker`} onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
                📈 티커 분석
              </Link>
            )}
            <Link href="/research" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
              📊 리서치
            </Link>
          </div>
          </nav>
        </div>
      </aside>
    );
  }

  // ── 일반 페이지용 사이드바 ──
  const navItem = (href: string, icon: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center justify-between px-4 py-3 text-sm transition-colors ${
          active ? "bg-[#1428A0] text-white font-semibold" : "text-fg hover:bg-white"
        }`}
      >
        <span className="flex items-center gap-2">
          <span>{icon}</span>
          <span>{label}</span>
        </span>
        <span className={active ? "text-white/60" : "text-fg-muted"}>›</span>
      </Link>
    );
  };

  return (
    <aside className="sticky top-14 z-30 flex w-full shrink-0 flex-col border-b border-border bg-[#f0f4fa] md:h-[calc(100vh-3.5rem)] md:w-44 md:self-start md:overflow-y-auto md:border-b-0 md:border-r">
      <button
        type="button"
        className="flex min-h-12 w-full items-center justify-between px-4 py-2 text-sm font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2C3EE8] md:hidden"
        aria-expanded={mobileOpen}
        aria-controls="general-mobile-navigation"
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span>메뉴</span>
        <span aria-hidden="true">{mobileOpen ? "▲" : "▼"}</span>
      </button>
      <nav
        id="general-mobile-navigation"
        className={`${mobileOpen ? "block" : "hidden"} max-h-[calc(100vh-7rem)] flex-1 overflow-y-auto border-t border-border py-1 md:block md:max-h-none md:border-t-0`}
        aria-label="주요 메뉴"
      >
        <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">메뉴</p>
        {navItem("/", "🏠", "홈")}
        {pbId && navItem(`/pb/${pbId}`, "📒", "다고객 북")}
        {pbId && navItem(`/pb/${pbId}/ticker`, "📈", "티커 분석")}
        {navItem("/research", "📊", "리서치")}

        <p className="px-4 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">바로가기</p>
        {EXTERNAL_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileOpen(false)}
            className="flex items-center justify-between px-4 py-3 text-sm text-fg hover:bg-surface-2 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span>↗</span>
              <span>{l.label}</span>
            </span>
          </a>
        ))}
      </nav>
      <p className="hidden border-t border-border px-4 py-3 text-center text-[10px] text-fg-muted md:block">
        참고용 · 투자권유 아님
      </p>
    </aside>
  );
}
