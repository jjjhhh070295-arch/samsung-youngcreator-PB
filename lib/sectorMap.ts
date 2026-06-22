/**
 * lib/sectorMap.ts
 * 종목 → 섹터 → 섹터ETF 매핑 + getSectorAnalysis()
 * 서버 사이드 전용 (Yahoo Finance fetch 포함).
 */

// ── 섹터 ID ────────────────────────────────────────────────────────────────
export type SectorId =
  | "semiconductor"
  | "battery"
  | "bio"
  | "finance"
  | "energy_chem"
  | "healthcare"
  | "steel"
  | "it"
  | "auto"
  | "market"; // 매핑 없는 종목 → KOSPI 폴백

export const SECTOR_LABELS: Record<SectorId, string> = {
  semiconductor: "반도체",
  battery:       "2차전지",
  bio:           "바이오·헬스케어",
  finance:       "금융",
  energy_chem:   "에너지화학",
  healthcare:    "헬스케어",
  steel:         "철강",
  it:            "IT",
  auto:          "자동차",
  market:        "시장 기준(섹터 미특정)",
};

// 섹터별 대표 ETF (.KS 포함)
export const SECTOR_ETF: Record<Exclude<SectorId, "market">, string> = {
  semiconductor: "091160.KS", // KODEX 반도체
  battery:       "305720.KS", // KODEX 2차전지산업
  bio:           "244580.KS", // KODEX 바이오
  finance:       "139270.KS", // TIGER 금융
  energy_chem:   "117460.KS", // KODEX 에너지화학
  healthcare:    "143860.KS", // TIGER 헬스케어
  steel:         "117680.KS", // KODEX 철강
  it:            "266360.KS", // KODEX IT
  auto:          "091180.KS", // KODEX 자동차
};

export const SECTOR_ETF_NAMES: Record<Exclude<SectorId, "market">, string> = {
  semiconductor: "KODEX 반도체",
  battery:       "KODEX 2차전지산업",
  bio:           "KODEX 바이오",
  finance:       "TIGER 금융",
  energy_chem:   "KODEX 에너지화학",
  healthcare:    "TIGER 헬스케어",
  steel:         "KODEX 철강",
  it:            "KODEX IT",
  auto:          "KODEX 자동차",
};

// ── KOSPI 상위 30개 종목 → 섹터 매핑 ─────────────────────────────────────
export interface StockEntry {
  name: string;
  code: string; // 6자리 (KIS/네이버 기준)
  sector: SectorId;
}

export const STOCK_SECTOR_MAP: StockEntry[] = [
  // ── 반도체 ──
  { name: "삼성전자",         code: "005930", sector: "semiconductor" },
  { name: "SK하이닉스",       code: "000660", sector: "semiconductor" },
  { name: "삼성전기",         code: "009150", sector: "semiconductor" },
  { name: "한미반도체",       code: "042700", sector: "semiconductor" },

  // ── 2차전지 ──
  { name: "LG에너지솔루션",   code: "373220", sector: "battery" },
  { name: "삼성SDI",          code: "006400", sector: "battery" },
  { name: "에코프로비엠",     code: "247540", sector: "battery" },
  { name: "에코프로",         code: "086520", sector: "battery" },
  { name: "LG화학",           code: "051910", sector: "battery" }, // 배터리 소재 비중 큼
  { name: "포스코퓨처엠",     code: "003670", sector: "battery" },

  // ── 바이오·헬스케어 ──
  { name: "삼성바이오로직스", code: "207940", sector: "bio" },
  { name: "셀트리온",         code: "068270", sector: "bio" },
  { name: "유한양행",         code: "000100", sector: "bio" },
  { name: "한미약품",         code: "128940", sector: "bio" },

  // ── 금융 ──
  { name: "KB금융",           code: "105560", sector: "finance" },
  { name: "신한지주",         code: "055550", sector: "finance" },
  { name: "하나금융지주",     code: "086790", sector: "finance" },
  { name: "우리금융지주",     code: "316140", sector: "finance" },
  { name: "삼성생명",         code: "032830", sector: "finance" },
  { name: "메리츠금융지주",   code: "138040", sector: "finance" },

  // ── IT ──
  { name: "NAVER",            code: "035420", sector: "it" },
  { name: "카카오",           code: "035720", sector: "it" },
  { name: "SK텔레콤",         code: "017670", sector: "it" },
  { name: "LG전자",           code: "066570", sector: "it" },

  // ── 자동차 ──
  { name: "현대차",           code: "005380", sector: "auto" },
  { name: "기아",             code: "000270", sector: "auto" },
  { name: "현대모비스",       code: "012330", sector: "auto" },

  // ── 에너지화학 ──
  { name: "SK이노베이션",     code: "096770", sector: "energy_chem" },

  // ── 철강·소재 ──
  { name: "POSCO홀딩스",      code: "005490", sector: "steel" },
  { name: "고려아연",         code: "010130", sector: "steel" },

  // ── 기타 (시장 폴백) ──
  { name: "삼성물산",         code: "028260", sector: "market" }, // 복합기업
  { name: "HD현대",           code: "267250", sector: "market" }, // 조선·중공업
  { name: "한화에어로스페이스",code: "012450", sector: "market" }, // 방산
];

// ── 조회 헬퍼 ────────────────────────────────────────────────────────────
/** 종목명 또는 6자리 코드로 매핑 탐색. 없으면 null. */
export function findEntry(nameOrCode: string): StockEntry | null {
  const q = nameOrCode.trim();
  return (
    STOCK_SECTOR_MAP.find((e) => e.code === q || e.name === q) ?? null
  );
}

/** 섹터에 해당하는 ETF 티커 반환. market → "^KS11" (KOSPI 폴백). */
export function etfTickerForSector(sector: SectorId): string {
  return sector === "market" ? "^KS11" : SECTOR_ETF[sector];
}

export function etfNameForSector(sector: SectorId): string {
  return sector === "market" ? "KOSPI (^KS11)" : SECTOR_ETF_NAMES[sector];
}

// ── Yahoo Finance 월봉 fetch ───────────────────────────────────────────────
const UA = "Mozilla/5.0 macro-stress/2.0";
const FIVE_YEARS_UNIX = Math.floor(new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).getTime() / 1000);

interface PricePoint { month: string; price: number }

async function yahooMonthly(symbol: string): Promise<PricePoint[]> {
  const p2 = Math.floor(Date.now() / 1000);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${FIVE_YEARS_UNIX}&period2=${p2}&interval=1mo&events=history`;
  const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = await res.json();
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: no chart data`);
  const timestamps: number[] = result.timestamp ?? [];
  const prices: number[] =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((ts, i) => ({ month: new Date(ts * 1000).toISOString().slice(0, 7), price: Number(prices[i]) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
}

// ── 월별 수익률 → OLS 베타/alpha/R²/변동성 ───────────────────────────────
interface OlsResult {
  beta: number;
  alphaMonthly: number;
  alphaAnnual: number; // (1+monthly)^12 - 1
  r2: number;
  volatilityAnnual: number; // ETF 연율화 변동성 %
  periodMonths: number;
  rangeStart: string;
  rangeEnd: string;
}

function computeOls(etfPts: PricePoint[], kospiPts: PricePoint[]): OlsResult {
  // 월별 수익률
  const toRets = (pts: PricePoint[]) =>
    pts.slice(1).map((p, i) => ({ month: p.month, ret: p.price / pts[i].price - 1 }))
       .filter((r) => Number.isFinite(r.ret));

  const etfRets   = toRets(etfPts);
  const kospiRets = toRets(kospiPts);

  // align
  const kMap = new Map(kospiRets.map((r) => [r.month, r.ret]));
  const pairs = etfRets
    .filter((r) => kMap.has(r.month))
    .map((r) => ({ month: r.month, a: r.ret, b: kMap.get(r.month)! }));

  if (pairs.length < 6) throw new Error("공통 관측값이 너무 적음");

  const n   = pairs.length;
  const mA  = pairs.reduce((s, p) => s + p.a, 0) / n;
  const mB  = pairs.reduce((s, p) => s + p.b, 0) / n;
  let covAB = 0, varB = 0;
  for (const p of pairs) { covAB += (p.a - mA) * (p.b - mB); varB += (p.b - mB) ** 2; }
  const beta  = varB > 0 ? covAB / varB : NaN;
  const alpha = mA - beta * mB;

  const ssRes = pairs.reduce((s, p) => s + (p.a - (alpha + beta * p.b)) ** 2, 0);
  const ssTot = pairs.reduce((s, p) => s + (p.a - mA) ** 2, 0);
  const r2    = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

  const etfVarMonthly = etfRets.reduce((s, r) => s + (r.ret - mA) ** 2, 0) / (etfRets.length - 1);
  const volAnnual     = Math.sqrt(etfVarMonthly * 12) * 100;

  return {
    beta,
    alphaMonthly: alpha,
    alphaAnnual:  ((1 + alpha) ** 12 - 1) * 100,
    r2,
    volatilityAnnual: volAnnual,
    periodMonths:  n,
    rangeStart:    pairs[0].month,
    rangeEnd:      pairs.at(-1)!.month,
  };
}

// ── 24h 서버 메모리 캐시 ──────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface CacheEntry { result: SectorAnalysisResult; ts: number }
const cache = new Map<string, CacheEntry>();

// ── 반환 타입 ─────────────────────────────────────────────────────────────
export interface SectorAnalysisResult {
  stockCode:   string;
  stockName:   string;
  sector:      SectorId;
  sectorLabel: string;
  etfCode:     string; // "^KS11" if fallback
  etfName:     string;
  beta:             number;
  volatilityAnnual: number; // %
  alphaAnnual:      number; // %
  r2:               number;
  periodMonths:     number;
  rangeStart:       string;
  rangeEnd:         string;
  isFallback: boolean; // true = 섹터 미특정 → KOSPI 대체
  cachedAt:   string;
}

/**
 * 종목명 또는 6자리 코드를 받아 섹터 ETF 기반 베타/alpha/변동성 반환.
 * 매핑 없는 종목은 KOSPI로 폴백 (isFallback=true).
 * 서버 사이드 전용.
 */
export async function getSectorAnalysis(
  nameOrCode: string,
): Promise<SectorAnalysisResult> {
  const cacheKey = nameOrCode.trim().toLowerCase();
  const cached   = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.result;

  const entry      = findEntry(nameOrCode);
  const sector     = entry?.sector ?? "market";
  const isFallback = !entry || sector === "market";
  const etfTicker  = etfTickerForSector(sector);
  const etfName    = etfNameForSector(sector);
  const stockCode  = entry?.code ?? nameOrCode.trim();
  const stockName  = entry?.name ?? nameOrCode.trim();

  // KOSPI 벤치마크는 항상 fetch
  const [etfPts, kospiPts] = await Promise.all([
    yahooMonthly(etfTicker),
    etfTicker === "^KS11" ? Promise.resolve<PricePoint[]>([]) : yahooMonthly("^KS11"),
  ]);

  // etfTicker가 "^KS11"(폴백)이면 etfPts 자체가 벤치마크
  const etfData   = etfTicker === "^KS11" ? etfPts : etfPts;
  const benchData = etfTicker === "^KS11" ? etfPts : kospiPts;

  const ols = computeOls(etfData, benchData);

  const result: SectorAnalysisResult = {
    stockCode,
    stockName,
    sector,
    sectorLabel:      SECTOR_LABELS[sector],
    etfCode:          etfTicker,
    etfName,
    beta:             ols.beta,
    volatilityAnnual: ols.volatilityAnnual,
    alphaAnnual:      ols.alphaAnnual,
    r2:               ols.r2,
    periodMonths:     ols.periodMonths,
    rangeStart:       ols.rangeStart,
    rangeEnd:         ols.rangeEnd,
    isFallback,
    cachedAt:         new Date().toISOString(),
  };

  cache.set(cacheKey, { result, ts: Date.now() });
  return result;
}
