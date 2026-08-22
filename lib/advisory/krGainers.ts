import type { OhlcBar } from "./krTrendFilter";

const NAVER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://m.stock.naver.com/",
};

/** 시가총액 하한: 5,000억 원 */
export const MIN_KR_MARKET_CAP_WON = 500_000_000_000;

export interface KrGainerRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradingValueWon: number | null;
  marketCapWon: number | null;
  marketCapLabel: string;
  marketCapAsOf: string;
  marketCapSource: string;
  marketCapStatus: "ok" | "below_floor" | "unverifiable";
  market: "KOSPI" | "KOSDAQ";
  asOf: string;
  source: string;
  currency: "KRW";
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.replace(/[,%+\s원]/g, "").trim();
  if (!s || s === "-" || s.toUpperCase() === "N/A") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isExcludedInstrument(name: string, stockEndType?: string): boolean {
  if (stockEndType && stockEndType !== "stock") return true;
  const n = name.toUpperCase();
  return /ETF|ETN|인버스|레버리지|선물|스팩|SPAC/.test(n);
}

export function passesMarketCapFloor(
  marketCapWon: number | null | undefined,
  floor = MIN_KR_MARKET_CAP_WON,
): { passed: boolean; reason: "ok" | "below_floor" | "unverifiable" } {
  if (marketCapWon == null || !Number.isFinite(marketCapWon) || marketCapWon <= 0) {
    return { passed: false, reason: "unverifiable" };
  }
  if (marketCapWon < floor) return { passed: false, reason: "below_floor" };
  return { passed: true, reason: "ok" };
}

export function formatMarketCapWon(won: number): string {
  const eok = won / 100_000_000;
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(2)}조원`;
  return `${Math.round(eok).toLocaleString("ko-KR")}억원`;
}

interface NaverMarketValueStock {
  itemCode?: string;
  stockName?: string;
  stockEndType?: string;
  closePrice?: string;
  closePriceRaw?: string | number;
  fluctuationsRatio?: string;
  accumulatedTradingVolume?: string | number;
  accumulatedTradingValueRaw?: string | number;
  marketValue?: string;
  marketValueRaw?: string | number;
  marketValueHangeul?: string;
  localTradedAt?: string;
}

async function fetchMarketValuePage(market: "KOSPI" | "KOSDAQ", page: number, pageSize = 50): Promise<NaverMarketValueStock[]> {
  const url = `https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${pageSize}`;
  const res = await fetch(url, { headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`시가총액 목록 조회 실패 (${market} p${page}, ${res.status})`);
  const data = await res.json();
  return (data?.stocks as NaverMarketValueStock[]) ?? [];
}

function resolveMarketCapWon(stock: NaverMarketValueStock): {
  won: number | null;
  label: string;
  status: "ok" | "below_floor" | "unverifiable";
} {
  const raw = parseNumeric(stock.marketValueRaw);
  if (raw != null && raw > 0) {
    const gate = passesMarketCapFloor(raw);
    return {
      won: raw,
      label: stock.marketValueHangeul || formatMarketCapWon(raw),
      status: gate.reason,
    };
  }
  // marketValue 필드는 백만원 단위로 제공되는 경우가 있음
  const million = parseNumeric(stock.marketValue);
  if (million != null && million > 0) {
    const won = million * 1_000_000;
    const gate = passesMarketCapFloor(won);
    return {
      won,
      label: stock.marketValueHangeul || formatMarketCapWon(won),
      status: gate.reason,
    };
  }
  return { won: null, label: "시총 검증 불가", status: "unverifiable" };
}

/**
 * 시가총액 내림차순 목록에서 5,000억 이상 국내 주식만 수집.
 * 시총 확인 불가 종목은 unverifiable로 따로 반환(자동 후보 제외).
 */
export async function fetchKoreanLargeCapUniverse(floor = MIN_KR_MARKET_CAP_WON): Promise<{
  eligible: KrGainerRow[];
  unverifiable: KrGainerRow[];
  source: string;
}> {
  const source = "naver-finance:mobile-stock:marketValue";
  const eligible: KrGainerRow[] = [];
  const unverifiable: KrGainerRow[] = [];

  for (const market of ["KOSPI", "KOSDAQ"] as const) {
    for (let page = 1; page <= 40; page++) {
      const stocks = await fetchMarketValuePage(market, page);
      if (!stocks.length) break;

      let hitBelowFloor = false;
      for (const stock of stocks) {
        const ticker = stock.itemCode?.trim();
        const name = stock.stockName?.trim() || ticker || "";
        if (!ticker) continue;
        if (isExcludedInstrument(name, stock.stockEndType)) continue;

        const asOf = stock.localTradedAt
          ? new Date(stock.localTradedAt).toISOString()
          : new Date().toISOString();
        const cap = resolveMarketCapWon(stock);
        const price = parseNumeric(stock.closePriceRaw) ?? parseNumeric(stock.closePrice) ?? 0;
        const changePct = parseNumeric(stock.fluctuationsRatio) ?? 0;
        const volume = parseNumeric(stock.accumulatedTradingVolume) ?? 0;
        const tradingValueWon = parseNumeric(stock.accumulatedTradingValueRaw);

        const row: KrGainerRow = {
          rank: 0,
          ticker,
          name,
          price,
          changePct,
          volume,
          tradingValueWon,
          marketCapWon: cap.won,
          marketCapLabel: cap.label,
          marketCapAsOf: asOf,
          marketCapSource: source,
          marketCapStatus: cap.status,
          market,
          asOf,
          source,
          currency: "KRW",
        };

        if (cap.status === "unverifiable") {
          unverifiable.push(row);
          continue;
        }
        if (cap.status === "below_floor" || (cap.won != null && cap.won < floor)) {
          hitBelowFloor = true;
          break;
        }
        eligible.push(row);
      }
      if (hitBelowFloor) break;
    }
  }

  return { eligible, unverifiable, source };
}

/**
 * 시총 5,000억 이상 국내 주식 중 당일 상승률 상위 N개.
 * 시총 검증 불가 종목은 상위 70에 넣지 않고 unverifiable로 함께 반환.
 */
export async function fetchKoreanTopGainers(limit = 70): Promise<{
  gainers: KrGainerRow[];
  unverifiable: KrGainerRow[];
  universeSize: number;
  floorWon: number;
}> {
  const { eligible, unverifiable } = await fetchKoreanLargeCapUniverse();
  const gainers = eligible
    .filter((r) => r.changePct > 0 && r.price > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    gainers,
    unverifiable: unverifiable.slice(0, 30),
    universeSize: eligible.length,
    floorWon: MIN_KR_MARKET_CAP_WON,
  };
}

function dateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 국내 일봉 OHLC (양봉 판정용). */
export async function fetchNaverOhlcBars(code: string, lookbackDays = 80): Promise<{
  bars: OhlcBar[];
  asOf: string;
  source: string;
  name: string | null;
}> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - lookbackDays - 40);
  const startKey = dateKey(start).replaceAll("-", "");
  const endKey = dateKey(end).replaceAll("-", "");
  const historyUrl =
    `https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/day` +
    `?startDateTime=${startKey}0000&endDateTime=${endKey}2359`;

  const [historyRes, basicRes] = await Promise.all([
    fetch(historyUrl, {
      headers: { ...NAVER_HEADERS, referer: "https://m.stock.naver.com/" },
      cache: "no-store",
    }),
    fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`, {
      headers: { ...NAVER_HEADERS, referer: "https://m.stock.naver.com/" },
      cache: "no-store",
    }),
  ]);

  if (!historyRes.ok) throw new Error(`일봉 조회 실패 (${historyRes.status})`);
  const rows: Array<{
    localDate?: string;
    openPrice?: number;
    highPrice?: number;
    lowPrice?: number;
    closePrice?: number;
    accumulatedTradingVolume?: number;
  }> = await historyRes.json();

  const bars: OhlcBar[] = rows
    .map((row) => {
      const d = typeof row.localDate === "string" && /^\d{8}$/.test(row.localDate)
        ? `${row.localDate.slice(0, 4)}-${row.localDate.slice(4, 6)}-${row.localDate.slice(6, 8)}`
        : "";
      const open = Number(row.openPrice);
      const high = Number(row.highPrice);
      const low = Number(row.lowPrice);
      const close = Number(row.closePrice);
      const volume = Number(row.accumulatedTradingVolume ?? 0);
      if (!d || !(open > 0) || !(close > 0)) return null;
      return {
        date: d,
        open,
        high: high > 0 ? high : Math.max(open, close),
        low: low > 0 ? low : Math.min(open, close),
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      } satisfies OhlcBar;
    })
    .filter((b): b is OhlcBar => Boolean(b))
    .sort((a, b) => a.date.localeCompare(b.date));

  let name: string | null = null;
  let asOf = new Date().toISOString();
  if (basicRes.ok) {
    const basic = await basicRes.json();
    name = typeof basic.stockName === "string" ? basic.stockName : null;
    if (basic.localTradedAt) asOf = new Date(basic.localTradedAt).toISOString();
  }

  return {
    bars,
    asOf,
    source: "naver-finance:chart:domestic-day",
    name,
  };
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
