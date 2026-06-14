"use client";

import { useState } from "react";
import Link from "next/link";
import ThemeToggle from "./ThemeToggle";
import Sidebar from "./Sidebar";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border bg-navy-800 text-white shadow-card dark:bg-navy-900">
        <div className="flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            {/* 햄버거 (왼쪽 바 열기) */}
            <button
              className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setMenuOpen(true)}
              aria-label="메뉴 열기"
            >
              ☰
            </button>
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gold-400 text-sm font-black text-navy-900">
                S
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-base font-bold tracking-tight">삼성증권 PB센터</span>
                <span className="hidden text-[10px] text-white/50 sm:inline">
                  Samsung Securities · Private Banking Console
                </span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
