import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KIS Signal Trader",
  description: "3양봉 전액매수 · 2음봉 전량매도 · KIS 실전주문",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
