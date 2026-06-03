"use client";

import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-navy-800 text-white shadow-card dark:bg-navy-900">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
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
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
