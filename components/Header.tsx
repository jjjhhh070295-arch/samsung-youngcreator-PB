"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getLoggedInPbId, clearLoggedInPbId } from "@/lib/auth";
import { listPbs } from "@/lib/store";

export default function Header() {
  const [pbName, setPbName] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const pbId = getLoggedInPbId();
    if (!pbId) return;
    listPbs().then((pbs) => {
      const pb = pbs.find((p) => p.id === pbId);
      if (pb) setPbName(pb.name);
    }).catch(() => {});
  }, []);

  const handleLogout = () => {
    clearLoggedInPbId();
    setPbName(null);
    router.push("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#0f1e7a] bg-[#1428A0] text-white shadow-card">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-sm font-black text-[#1428A0]">
            S
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight">삼성증권 PB센터</span>
            <span className="hidden text-[10px] text-white/50 sm:inline">
              Samsung Securities · Private Banking Console
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {pbName && (
            <>
              <span className="hidden text-sm text-white/80 sm:inline">
                {pbName} PB
              </span>
              <button
                className="rounded-md border border-white/30 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                onClick={handleLogout}
              >
                로그아웃
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
