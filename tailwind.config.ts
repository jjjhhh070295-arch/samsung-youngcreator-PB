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
        // 딥블루(네이비) 베이스 — 헤더·주요 버튼·강조
        navy: {
          50: "#eef2f8",
          100: "#d6e0ef",
          200: "#aec1dd",
          300: "#7e9bc6",
          400: "#4f72a8",
          500: "#16386b",
          600: "#102d57",
          700: "#0c2444",
          800: "#0a2540",
          900: "#071a2e",
          950: "#04101f",
        },
        // 골드(금색) 포인트 — 선택 상태·중요 수치·구분선
        gold: {
          50: "#fbf7e9",
          100: "#f5ecc6",
          200: "#ecd98c",
          300: "#e0c454",
          400: "#d4af37",
          500: "#c9a227",
          600: "#a8841d",
          700: "#82651a",
          800: "#6a521c",
          900: "#5a461d",
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
