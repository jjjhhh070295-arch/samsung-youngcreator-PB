// 디자인 시스템 색상 토큰 (딥블루 + 골드)
// Tailwind tailwind.config.ts 와 globals.css 의 CSS 변수와 짝을 이룬다.
// 차트(Recharts) 등 JS에서 직접 색을 써야 할 때 여기서 가져다 쓴다.

export const COLORS = {
  navy: {
    base: "#0e1580",
    mid: "#2c3ee8",
    light: "#8a9bff",
  },
  gold: {
    base: "#e0e5ff",
    bright: "#ffffff",
    soft: "#f0f2ff",
  },
  neutral: {
    grayLine: "#94a3b8",
    grayText: "#64748b",
  },
} as const;

// 레이더/추세 차트의 7요인 색 (블루+화이트 계열)
export const CHART_COLORS = {
  primary: COLORS.navy.mid,
  accent: COLORS.navy.light,
  muted: COLORS.neutral.grayLine,
  series: [
    "#2c3ee8", // return — 메인 블루
    "#ffffff", // risk — 흰색
    "#2a9d8f", // timeHorizon — 틸
    "#e76f51", // tax — 코랄
    "#8a9bff", // liquidity — 라이트 블루
    "#43936c", // legal — 그린
    "#b0baf0", // unique — 연보라
  ],
} as const;

export type ThemeMode = "light" | "dark";
