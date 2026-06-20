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
  { id: "basic", label: "기본정보" },
  { id: "factors", label: "7요인" },
  { id: "flags", label: "플래그" },
  { id: "questions", label: "추가질문" },
  { id: "cashflow", label: "현금흐름" },
  { id: "portfolio", label: "포트폴리오" },
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

  const activeView = searchParams?.get("view") ?? "home";
  const activeTab = searchParams?.get("tab") ?? "factors";

  useEffect(() => {
    if (!clientId) { setClient(null); return; }
    getClient(clientId).then(setClient).catch(() => {});
  }, [clientId]);

  const goTo = (view: string, tab?: string) => {
    const params = new URLSearchParams({ view });
    if (tab) params.set("tab", tab);
    router.push(`/pb/${pbId}/${clientId}?${params.toString()}`);
  };

  // ── 고객 상세 페이지용 사이드바 ──
  if (isClientPage) {
    return (
      <aside className="w-44 shrink-0 border-r border-border bg-[#f0f4fa] sticky top-14 self-start h-[calc(100vh-3.5rem)] flex flex-col overflow-y-auto">
        <button
          className="flex items-center gap-2 px-4 py-3 text-xs text-fg-muted hover:bg-surface-2 border-b border-border shrink-0"
          onClick={() => router.push(`/pb/${pbId}`)}
        >
          ← PB 페이지
        </button>

        {client && (
          <div className="px-4 py-3 border-b border-border shrink-0">
            <p className="text-[10px] text-fg-muted">{client.code}</p>
            <p className="text-sm font-bold text-fg truncate">{client.name}</p>
          </div>
        )}

        <nav className="flex-1 py-1">
          {/* 기본정보 · 상담진행 */}
          {MAIN_SECTIONS.map((s) => {
            const isActive = (s.id === "basic" && activeView === "home") || (s.id === "consultation" && activeView === "consultation");
            return (
              <button
                key={s.id}
                onClick={() => goTo(s.id === "consultation" ? "consultation" : "home")}
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
                onClick={() => goTo("analysis", t.id)}
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

          {/* 성향 시각화 */}
          <div className="border-t border-border mt-2 pt-1">
            <button
              onClick={() => goTo("visualization")}
              className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                activeView === "visualization"
                  ? "bg-[#1428A0] text-white font-semibold"
                  : "text-fg hover:bg-white"
              }`}
            >
              <span className="flex items-center gap-2">
                <span>📈</span>
                <span>성향시각화</span>
              </span>
              <span className={activeView === "visualization" ? "text-white/60" : "text-fg-muted"}>›</span>
            </button>
          </div>

          <div className="border-t border-border mt-2 pt-2">
            <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">메뉴</p>
            <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
              🏠 홈
            </Link>
            <Link href="/research" className="flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-2">
              📊 리서치
            </Link>
          </div>
        </nav>

        <div className="border-t border-border p-3 shrink-0">
          <button
            className="w-full btn-primary text-xs py-2"
            onClick={() => router.push(`/client/${clientId}`)}
          >
            고객 화면 →
          </button>
          <p className="mt-2 text-center text-[10px] text-fg-muted">참고용 · 투자권유 아님</p>
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
    <aside className="w-44 shrink-0 border-r border-border bg-[#f0f4fa] sticky top-14 self-start h-[calc(100vh-3.5rem)] flex flex-col overflow-y-auto">
      <nav className="flex-1 py-1">
        <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">메뉴</p>
        {navItem("/", "🏠", "홈")}
        {navItem("/research", "📊", "리서치")}

        <p className="px-4 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">바로가기</p>
        {EXTERNAL_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-4 py-3 text-sm text-fg hover:bg-surface-2 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span>↗</span>
              <span>{l.label}</span>
            </span>
          </a>
        ))}
      </nav>
      <p className="px-4 py-3 text-center text-[10px] text-fg-muted border-t border-border">
        참고용 · 투자권유 아님
      </p>
    </aside>
  );
}
