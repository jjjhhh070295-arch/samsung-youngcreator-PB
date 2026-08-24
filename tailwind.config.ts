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
        // 블루 팔레트 — 배경·패널·주요 버튼 베이스
        navy: {
          50: "#eef0ff",
          100: "#dde2ff",
          200: "#b8c2ff",
          300: "#8a9bff",
          400: "#5e75ff",
          500: "#2c3ee8", // 메인 블루
          600: "#1a2cc4",
          700: "#141ea0",
          800: "#0e1580",
          900: "#080d60",
          950: "#040840",
        },
        // 삼성 파랑 포인트 — 선택 상태·중요 수치·CTA
        gold: {
          50: "#eef1ff",
          100: "#dde4ff",
          200: "#b8c5ff",
          300: "#8a9bff",
          400: "#1428A0",
          500: "#1428A0",
          600: "#1428A0",
          700: "#0f1e80",
          800: "#0a1460",
          900: "#070e40",
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
