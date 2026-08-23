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
    // 세션만 사용 — URL pbId로 세션을 만들지 않는다(인증 우회 차단)
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
    <header className="sticky top-0 z-40 border-b border-border bg-white/95 text-fg backdrop-blur">
      <div className="flex h-14 items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#1428A0] text-sm font-black text-white">
            S
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight">삼성증권 PB센터</span>
            <span className="hidden text-[10px] text-fg-muted sm:inline">
              Samsung Securities · Private Banking Console
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {pbName && (
            <>
              <span className="hidden text-sm text-fg-muted sm:inline">
                {pbName} PB
              </span>
              <button
                className="btn-outline px-3 py-1.5 text-xs"
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
