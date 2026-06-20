"use client";

import { useEffect } from "react";
import Link from "next/link";

interface Props {
  open: boolean;
  onClose: () => void;
}

// 외부 링크
const EXTERNAL_LINKS = [
  {
    label: "삼성증권",
    desc: "Samsung Securities 공식 사이트",
    href: "https://www.samsungpop.com",
  },
  {
    label: "삼성자산운용 (KODEX ETF)",
    desc: "ETF·펀드 정보",
    href: "https://www.samsungfund.com",
  },
];

// 왼쪽에서 열리는 사이드바(드로어)
export default function Sidebar({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* 오버레이 */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* 패널 */}
      <aside
        className={`fixed left-0 top-0 z-50 h-full w-72 transform bg-surface shadow-2xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* 상단 */}
        <div className="flex items-center justify-between border-b border-[#0f1e7a] bg-[#1428A0] px-4 py-3 text-white">
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-sm font-black text-[#1428A0]">
              S
            </span>
            <span className="text-sm font-bold">삼성증권 PB센터</span>
          </span>
          <button
            className="rounded-full px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 내부 메뉴 */}
        <nav className="p-3">
          <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            메뉴
          </p>
          <Link
            href="/"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            🏠 홈 (대시보드)
          </Link>
          <Link
            href="/research"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            📊 리서치 분석
          </Link>

          {/* 외부 링크 */}
          <p className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
            바로가기
          </p>
          {EXTERNAL_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-start gap-2 rounded-lg px-3 py-2.5 hover:bg-surface-2"
            >
              <span className="mt-0.5 text-gold-500">↗</span>
              <span>
                <span className="block text-sm font-medium text-fg">{l.label}</span>
                <span className="block text-[11px] text-fg-muted">{l.desc}</span>
              </span>
            </a>
          ))}
        </nav>

        <p className="absolute bottom-3 left-0 w-full px-4 text-center text-[10px] text-fg-muted">
          참고용 · 투자권유 아님
        </p>
      </aside>
    </>
  );
}
