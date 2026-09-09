const THEME_LABELS: Record<string, string> = {
  SEMICONDUCTOR: "반도체", AI: "인공지능", HBM: "고대역폭 메모리", DEFENSE: "방산",
  AUTO: "자동차", SECONDARY_BATTERY: "2차전지", BIO: "바이오·헬스케어",
  HEALTHCARE: "헬스케어", FINANCIAL: "금융", INTERNET: "인터넷·플랫폼",
  ENERGY: "에너지", NUCLEAR: "원전", SHIPBUILDING: "조선", ROBOTICS: "로봇",
  CONSUMER: "소비재", DIVIDEND: "배당", VALUE: "가치주", GROWTH: "성장주",
  RATE_CUT: "금리 인하", RATE_HIKE: "금리 상승", USD: "달러", OIL: "유가·원유",
};

export const MARKET_SECTOR_LABELS = {
  SEMICONDUCTOR: "반도체",
  INFORMATION_TECHNOLOGY: "정보기술",
  COMMUNICATION_SERVICES: "커뮤니케이션 서비스",
  CONSUMER_DISCRETIONARY: "경기소비재",
  CONSUMER_STAPLES: "필수소비재",
  INDUSTRIALS: "산업재",
  MATERIALS: "소재",
  ENERGY: "에너지",
  FINANCIALS: "금융",
  HEALTH_CARE: "헬스케어",
  UTILITIES: "유틸리티",
  REAL_ESTATE: "부동산",
  AUTOMOBILES: "자동차",
  DEFENSE_AEROSPACE: "방산·항공우주",
  SHIPBUILDING: "조선",
  BIOTECHNOLOGY: "바이오",
  SECONDARY_BATTERY: "2차전지",
} as const;

export const MARKET_SECTOR_CODES = Object.keys(MARKET_SECTOR_LABELS) as Array<keyof typeof MARKET_SECTOR_LABELS>;

export function sectorLabelKo(sector: string): string {
  const key = sector.trim().toUpperCase().replace(/[\s-]+/g, "_") as keyof typeof MARKET_SECTOR_LABELS;
  return MARKET_SECTOR_LABELS[key] ?? sector.replace(/_/g, " ");
}

export function themeLabelKo(theme: string): string {
  const key = theme.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return THEME_LABELS[key] ?? theme.replace(/_/g, " ");
}

export function localizeTheme<T extends { theme?: unknown }>(theme: T): T & { themeCode: string; themeKo: string } {
  const themeCode = typeof theme.theme === "string" ? theme.theme.trim().toUpperCase().replace(/[\s-]+/g, "_") : "UNKNOWN";
  return { ...theme, themeCode, themeKo: themeLabelKo(themeCode) };
}
