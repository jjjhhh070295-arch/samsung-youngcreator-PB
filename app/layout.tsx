import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KIS Regime Trader",
  description: "3양봉 전략 · 시장 국면 강제 게이트 · KIS 실전주문",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
