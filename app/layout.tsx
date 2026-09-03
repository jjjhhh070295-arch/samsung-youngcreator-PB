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

// 상단 가로 네비의 1행 높이(h-11)를 그대로 잡아둔다 — Suspense 해소 시 세로 점프를 줄인다.
// 고객 상세 페이지는 2행이라 한 행만큼 더 늘어나지만, 그 경우에도 본문이 밀릴 뿐 깨지지 않는다.
function AppNavFallback() {
  return <div className="h-11 border-b border-border bg-[#f0f4fa]" aria-hidden />;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SplashScreen />
          {/* 유휴 타임아웃 감시 — 렌더는 만료 경고가 뜰 때만 한다. */}
          <SessionGuard />
          {/* 헤더 줄을 없애고 로고·PB명·로그아웃을 AppNav 1행으로 통합했다.
              최상단 요소가 AppNav 하나뿐이라 세로가 헤더 높이(3.5rem)만큼 줄었다.
              본문은 화면 전체 폭을 쓴다(각 페이지의 max-w 컨테이너가 상한을 잡는다). */}
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
