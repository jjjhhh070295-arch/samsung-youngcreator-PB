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
      <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-56 shrink-0 self-start flex-col overflow-y-auto border-r border-white/10 bg-gradient-to-b from-[#071B4A] to-[#06153B] text-white">
        <button
          className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3 text-xs text-white/60 hover:bg-white/10 hover:text-white"
          onClick={() => router.push(`/pb/${pbId}`)}
        >
          ← PB 페이지
        </button>

        {client && (
          <div className="shrink-0 border-b border-white/10 px-4 py-3">
            <p className="text-[10px] text-white/50">{client.code}</p>
            <p className="truncate text-sm font-bold text-white">{client.name}</p>
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
                  isActive ? "bg-[#1455D9] text-white font-semibold" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                </span>
                <span className="text-white/40">›</span>
              </button>
            );
          })}

          {/* 분석 탭 */}
          <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-white/40">
            분석
          </p>
          {ANALYSIS_TABS.map((t) => {
            const isActive = activeView === "analysis" && activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => goTo("analysis", t.id)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors ${
                  isActive ? "bg-[#1455D9] text-white font-semibold" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span>{t.label}</span>
                <span className="text-white/40">›</span>
              </button>
            );
          })}

          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">메뉴</p>
            <Link href="/" className="flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
              🏠 홈
            </Link>
            {pbId && (
              <Link href={`/pb/${pbId}`} className="flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
                📒 다고객 북
              </Link>
            )}
            {pbId && (
              <Link href={`/pb/${pbId}/ticker`} className="flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
                📈 티커 분석
              </Link>
            )}
            <Link href="/research" className="flex items-center gap-2 px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
              📊 리서치
            </Link>
          </div>
        </nav>
      </aside>
    );
  }

  // ── 일반 페이지용 사이드바 ──
  const navItem = (href: string, icon: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`mx-2 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
          active ? "bg-[#1455D9] text-white font-semibold" : "text-white/70 hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className="flex items-center gap-2">
          <span>{icon}</span>
          <span>{label}</span>
        </span>
        <span className="text-white/40">›</span>
      </Link>
    );
  };

  return (
    <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-56 shrink-0 self-start flex-col overflow-y-auto border-r border-white/10 bg-gradient-to-b from-[#071B4A] to-[#06153B] text-white">
      <div className="border-b border-white/10 px-4 py-4">
        <p className="text-[10px] font-semibold text-white/55">삼성증권 PB센터</p>
        <p className="mt-1 text-base font-black tracking-tight">PB Decision Console</p>
        <p className="mt-1 text-[10px] text-white/45">AI 기반 의사결정 콘솔</p>
      </div>
      <nav className="flex-1 py-1">
        <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-white/40">Main</p>
        {navItem("/", "🏠", "홈")}
        {pbId && navItem(`/pb/${pbId}`, "📒", "다고객 북")}
        {pbId && navItem(`/pb/${pbId}/ticker`, "📈", "티커 분석")}
        {navItem("/research", "📊", "리서치")}

        <p className="px-4 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wide text-white/40">바로가기</p>
        {EXTERNAL_LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-2 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            <span className="flex items-center gap-2">
              <span>↗</span>
              <span>{l.label}</span>
            </span>
          </a>
        ))}
      </nav>
      <p className="border-t border-white/10 px-4 py-3 text-center text-[10px] text-white/35">
        참고용 · 투자권유 아님
      </p>
    </aside>
  );
}
