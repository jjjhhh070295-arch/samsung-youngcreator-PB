"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AUTH_SESSION_CHANGED_EVENT,
  getLoggedInPbSession,
  logoutPb,
} from "@/lib/auth";

export default function Header() {
  const [pbName, setPbName] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    let cancelled = false;
    const syncSession = () => {
      void getLoggedInPbSession().then((session) => {
        if (!cancelled) setPbName(session?.pbName ?? null);
      }).catch(() => {
        if (!cancelled) setPbName(null);
      });
    };
    syncSession();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, syncSession);
    };
  }, [pathname, router]);

  const handleLogout = async () => {
    await logoutPb();
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
