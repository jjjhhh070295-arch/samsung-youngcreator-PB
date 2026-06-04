// 디자인 시스템 색상 토큰 (딥블루 + 골드)
// Tailwind tailwind.config.ts 와 globals.css 의 CSS 변수와 짝을 이룬다.
// 차트(Recharts) 등 JS에서 직접 색을 써야 할 때 여기서 가져다 쓴다.

export const COLORS = {
  navy: {
    base: "#0A2540",
    mid: "#16386b",
    light: "#4f72a8",
  },
  gold: {
    base: "#C9A227",
    bright: "#D4AF37",
    soft: "#e0c454",
  },
  neutral: {
    grayLine: "#94a3b8",
    grayText: "#64748b",
  },
} as const;

// 레이더/추세 차트의 7요인 색 (골드 계열 강조 + 네이비)
export const CHART_COLORS = {
  primary: COLORS.navy.mid,
  accent: COLORS.gold.bright,
  muted: COLORS.neutral.grayLine,
  // 추세 그래프에서 요인별로 구분할 7색 (서로 뚜렷이 구분되도록)
  series: [
    "#16386b", // return — 네이비
    "#D4AF37", // risk — 골드
    "#2a9d8f", // timeHorizon — 틸
    "#e76f51", // tax — 코랄
    "#6a4c93", // liquidity — 퍼플
    "#43936c", // legal — 그린
    "#e98a1e", // unique — 오렌지
  ],
} as const;

export type ThemeMode = "light" | "dark";
