const THEME_LABELS: Record<string, string> = {
  SEMICONDUCTOR: "반도체", AI: "인공지능", HBM: "고대역폭 메모리", DEFENSE: "방산",
  AUTO: "자동차", SECONDARY_BATTERY: "2차전지", BIO: "바이오·헬스케어",
  HEALTHCARE: "헬스케어", FINANCIAL: "금융", INTERNET: "인터넷·플랫폼",
  ENERGY: "에너지", NUCLEAR: "원전", SHIPBUILDING: "조선", ROBOTICS: "로봇",
  CONSUMER: "소비재", DIVIDEND: "배당", VALUE: "가치주", GROWTH: "성장주",
  RATE_CUT: "금리 인하", RATE_HIKE: "금리 상승", USD: "달러", OIL: "유가·원유",
};

export function themeLabelKo(theme: string): string {
  const key = theme.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return THEME_LABELS[key] ?? theme.replace(/_/g, " ");
}

export function localizeTheme<T extends { theme?: unknown }>(theme: T): T & { themeCode: string; themeKo: string } {
  const themeCode = typeof theme.theme === "string" ? theme.theme.trim().toUpperCase().replace(/[\s-]+/g, "_") : "UNKNOWN";
  return { ...theme, themeCode, themeKo: themeLabelKo(themeCode) };
}
