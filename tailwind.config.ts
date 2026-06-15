import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // (이전 네이비 → 바이낸스 다크 뉴트럴로 재매핑) 헤더·패널·주요 버튼 베이스
        navy: {
          50: "#eaecef",
          100: "#b7bdc6",
          200: "#848e9c",
          300: "#5e6673",
          400: "#474d57",
          500: "#2b3139",
          600: "#1e2329",
          700: "#181a20",
          800: "#14171c",
          900: "#0b0e11",
          950: "#060809",
        },
        // 골드 → 바이낸스 옐로우 포인트 — 선택 상태·중요 수치·CTA
        gold: {
          50: "#fef6d8",
          100: "#fcefa8",
          200: "#fbe571",
          300: "#fada47",
          400: "#fcd535", // 메인 액센트
          500: "#f0b90b", // 바이낸스 브랜드 옐로우
          600: "#c99400",
          700: "#a37800",
          800: "#7d5c00",
          900: "#5c4400",
        },
        // CSS 변수 기반 테마 토큰 (라이트/다크 공용)
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        "fg-muted": "rgb(var(--fg-muted) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
