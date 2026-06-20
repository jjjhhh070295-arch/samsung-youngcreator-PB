import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import Header from "@/components/Header";
import AppNav from "@/components/AppNav";
import SplashScreen from "@/components/SplashScreen";

export const metadata: Metadata = {
  title: "삼성증권 PB센터 · 상담 지원",
  description:
    "삼성증권 PB센터 — PB 상담을 RRTTLLU 7요인으로 구조화하는 상담 지원 도구. 참고용·투자권유 아님.",
};

function AppNavFallback() {
  return <aside className="w-44 shrink-0 border-r border-border bg-white" aria-hidden />;
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
          <Header />
          <div className="flex">
            <Suspense fallback={<AppNavFallback />}>
              <AppNav />
            </Suspense>
            <main className="flex-1 min-w-0">{children}</main>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
