// 홈 전광판 지표 레지스트리 — PB가 고를 수 있는 지표의 단일 정의처.
//
// 이 파일은 순수 데이터다. fetch 로직은 없다 — app/api/market/route.ts(서버)와
// 지표 선택 모달(클라이언트)이 같은 목록을 봐야 하므로, 서버 전용 코드가 섞이면
// 클라이언트 번들이 깨진다.
//
// id 는 URL 쿼리(?ids=kospi,nasdaq)와 localStorage 에 그대로 저장되는 값이다.
// 한 번 배포한 id 는 바꾸지 말 것 — 바꾸면 PB 가 저장해 둔 설정이 조용히 무효가 된다.
// (route 가 모르는 id 는 무시하고 넘어가므로 앱이 깨지지는 않는다.)
//
// 네이버 HTML 파싱은 기존 한국 국고채 3년 하나만 유지한다. 마크업이 바뀌면 조용히
// 깨지는 소스라 개수를 늘리지 않는다.

export type IndicatorCategory = "domestic" | "global" | "rate" | "fx" | "commodity" | "macro";

export const CATEGORY_LABEL: Record<IndicatorCategory, string> = {
  domestic: "국내 증시",
  global: "해외 증시",
  rate: "금리",
  fx: "환율",
  commodity: "원자재",
  macro: "매크로",
};

/** 카테고리 표시 순서 — 모달 아코디언과 동일 순서로 쓴다. */
export const CATEGORY_ORDER: IndicatorCategory[] = [
  "domestic",
  "global",
  "rate",
  "fx",
  "commodity",
  "macro",
];

export type IndicatorKind =
  /** Yahoo 시세, 등락률(%) 표기. 지수·환율·원자재. */
  | "index"
  /** Yahoo 시세, 값 자체가 %인 금리. 등락폭(%p) 표기. */
  | "yield"
  /** FRED 시계열의 최신값. 값이 % 인 금리·비율. 등락폭(%p) 표기. */
  | "fredRate"
  /** FRED 시계열의 전년동월비(%). CPI 처럼 지수 원계열을 YoY 로 환산한다. */
  | "fredYoY"
  /** 네이버 마켓인덱스 HTML 파싱 — 한국 국고채 3년 전용. */
  | "krBond";

export interface MarketIndicator {
  id: string;
  label: string;
  /** 라벨 아래 작게 붙는 부제(원 심볼·영문명). */
  sub: string;
  category: IndicatorCategory;
  kind: IndicatorKind;
  /** Yahoo 심볼 (index/yield 에서 사용). */
  symbol?: string;
  /** FRED 시리즈 ID (fredRate/fredYoY 에서 사용). */
  seriesId?: string;
  /** 표시 소수 자릿수. index 기본 2. */
  decimals?: number;
  /** 출처 표기용 짧은 이름. */
  source: "yahoo" | "fred" | "naver";
}

export const MARKET_INDICATORS: MarketIndicator[] = [
  // ── 국내 증시 ──
  { id: "kospi", label: "코스피", sub: "KOSPI", category: "domestic", kind: "index", symbol: "^KS11", source: "yahoo" },
  { id: "kosdaq", label: "코스닥", sub: "KOSDAQ", category: "domestic", kind: "index", symbol: "^KQ11", source: "yahoo" },
  { id: "kospi200", label: "코스피 200", sub: "KOSPI 200", category: "domestic", kind: "index", symbol: "^KS200", source: "yahoo" },
  { id: "samsung", label: "삼성전자", sub: "005930", category: "domestic", kind: "index", symbol: "005930.KS", decimals: 0, source: "yahoo" },
  { id: "hynix", label: "SK하이닉스", sub: "000660", category: "domestic", kind: "index", symbol: "000660.KS", decimals: 0, source: "yahoo" },

  // ── 해외 증시 ──
  { id: "sp500", label: "S&P 500", sub: "S&P 500", category: "global", kind: "index", symbol: "^GSPC", source: "yahoo" },
  { id: "nasdaq", label: "나스닥", sub: "NASDAQ", category: "global", kind: "index", symbol: "^IXIC", source: "yahoo" },
  { id: "dow", label: "다우존스", sub: "DJIA", category: "global", kind: "index", symbol: "^DJI", source: "yahoo" },
  { id: "sox", label: "필라델피아 반도체", sub: "SOX", category: "global", kind: "index", symbol: "^SOX", source: "yahoo" },
  { id: "nikkei", label: "니케이 225", sub: "N225", category: "global", kind: "index", symbol: "^N225", source: "yahoo" },
  { id: "hangseng", label: "항셍", sub: "HSI", category: "global", kind: "index", symbol: "^HSI", source: "yahoo" },
  { id: "shanghai", label: "상하이 종합", sub: "SSE", category: "global", kind: "index", symbol: "000001.SS", source: "yahoo" },
  { id: "taiwan", label: "대만 가권", sub: "TWII", category: "global", kind: "index", symbol: "^TWII", source: "yahoo" },
  { id: "eurostoxx", label: "유로스톡스 50", sub: "SX5E", category: "global", kind: "index", symbol: "^STOXX50E", source: "yahoo" },

  // ── 금리 ──
  { id: "ust10y", label: "미국 국채 10Y", sub: "US 10Y", category: "rate", kind: "yield", symbol: "^TNX", source: "yahoo" },
  { id: "ust30y", label: "미국 국채 30Y", sub: "US 30Y", category: "rate", kind: "yield", symbol: "^TYX", source: "yahoo" },
  { id: "ust5y", label: "미국 국채 5Y", sub: "US 5Y", category: "rate", kind: "yield", symbol: "^FVX", source: "yahoo" },
  { id: "ust13w", label: "미국 단기금리 13W", sub: "US 13W", category: "rate", kind: "yield", symbol: "^IRX", source: "yahoo" },
  { id: "krbond3y", label: "한국 국채 3Y", sub: "국고채 3년", category: "rate", kind: "krBond", source: "naver" },
  // FRED 지표. 유효한 FRED_API_KEY 가 있으면 실시간, 없으면 lib/macroStress/fred-snapshot.json
  // 으로 폴백한다. 스냅샷에 없는 시리즈(T10Y2Y·BAMLH0A0HYM2·UNRATE)는 키가 없는 환경에서
  // 조회에 실패해 전광판에서 빠지고, 화면에 "조회할 수 없어 표시하지 않았습니다"로 안내된다.
  { id: "fedfunds", label: "미 기준금리 상단", sub: "FED Target Upper", category: "rate", kind: "fredRate", seriesId: "DFEDTARU", source: "fred" },
  { id: "spread10y2y", label: "장단기 스프레드", sub: "10Y - 2Y", category: "rate", kind: "fredRate", seriesId: "T10Y2Y", source: "fred" },
  { id: "hyspread", label: "하이일드 스프레드", sub: "US HY OAS", category: "rate", kind: "fredRate", seriesId: "BAMLH0A0HYM2", source: "fred" },

  // ── 환율 ──
  { id: "usdkrw", label: "원/달러", sub: "USD/KRW", category: "fx", kind: "index", symbol: "KRW=X", source: "yahoo" },
  { id: "jpykrw", label: "원/엔(100엔)", sub: "JPY/KRW", category: "fx", kind: "index", symbol: "JPYKRW=X", decimals: 2, source: "yahoo" },
  { id: "eurkrw", label: "원/유로", sub: "EUR/KRW", category: "fx", kind: "index", symbol: "EURKRW=X", source: "yahoo" },
  { id: "dxy", label: "달러인덱스", sub: "DXY", category: "fx", kind: "index", symbol: "DX-Y.NYB", source: "yahoo" },
  { id: "usdcny", label: "달러/위안", sub: "USD/CNY", category: "fx", kind: "index", symbol: "CNY=X", decimals: 4, source: "yahoo" },

  // ── 원자재 ──
  { id: "gold", label: "금", sub: "Gold (COMEX)", category: "commodity", kind: "index", symbol: "GC=F", source: "yahoo" },
  { id: "silver", label: "은", sub: "Silver (COMEX)", category: "commodity", kind: "index", symbol: "SI=F", source: "yahoo" },
  { id: "wti", label: "WTI 유가", sub: "WTI Crude", category: "commodity", kind: "index", symbol: "CL=F", source: "yahoo" },
  { id: "brent", label: "브렌트유", sub: "Brent Crude", category: "commodity", kind: "index", symbol: "BZ=F", source: "yahoo" },
  { id: "copper", label: "구리", sub: "Copper", category: "commodity", kind: "index", symbol: "HG=F", decimals: 3, source: "yahoo" },
  { id: "gsci", label: "원자재 종합", sub: "GSG ETF", category: "commodity", kind: "index", symbol: "GSG", source: "yahoo" },

  // ── 매크로 ──
  { id: "vix", label: "VIX 변동성", sub: "VIX", category: "macro", kind: "index", symbol: "^VIX", source: "yahoo" },
  { id: "uscpi", label: "미국 CPI", sub: "전년동월비", category: "macro", kind: "fredYoY", seriesId: "CPIAUCSL", source: "fred" },
  { id: "unrate", label: "미국 실업률", sub: "UNRATE", category: "macro", kind: "fredRate", seriesId: "UNRATE", source: "fred" },
  { id: "usppi", label: "미국 PPI", sub: "전년동월비", category: "macro", kind: "fredYoY", seriesId: "PPIACO", source: "fred" },
];

/** 기본 전광판 — 커스텀 도입 이전에 보이던 5개 그대로. */
export const DEFAULT_INDICATOR_IDS = ["kospi", "sp500", "usdkrw", "ust10y", "krbond3y"];

export const MIN_INDICATORS = 3;
export const MAX_INDICATORS = 8;

const BY_ID = new Map(MARKET_INDICATORS.map((i) => [i.id, i]));

export function getIndicator(id: string): MarketIndicator | undefined {
  return BY_ID.get(id);
}

/** 레지스트리에 없는 id 는 버린다. 서버 화이트리스트와 클라이언트 정리에 함께 쓴다. */
export function sanitizeIndicatorIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!BY_ID.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_INDICATORS) break;
  }
  return out;
}

export function indicatorsByCategory(category: IndicatorCategory): MarketIndicator[] {
  return MARKET_INDICATORS.filter((i) => i.category === category);
}
