import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import AppNav from "@/components/AppNav";
import SplashScreen from "@/components/SplashScreen";
import SessionGuard from "@/components/SessionGuard";

export const metadata: Metadata = {
  title: "삼성증권 PB센터 · 상담 지원",
  description:
    "삼성증권 PB센터 — PB 상담을 RRTTLLU 7요인으로 구조화하는 상담 지원 도구. 참고용·투자권유 아님.",
};

function AppNavFallback() {
  return <div className="h-11 border-b border-border bg-[#f0f4fa]" aria-hidden />;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SplashScreen />
          <SessionGuard />
          <div className="flex flex-col">
            <Suspense fallback={<AppNavFallback />}>
              <AppNav />
            </Suspense>
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
