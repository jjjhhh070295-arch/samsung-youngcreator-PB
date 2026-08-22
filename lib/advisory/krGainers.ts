import type { OhlcBar } from "./krTrendFilter";

const NAVER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://finance.naver.com/",
};

export interface KrGainerRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradingValueWon: number | null;
  market: "KOSPI" | "KOSDAQ";
  asOf: string;
  source: string;
  currency: "KRW";
}

function parseNumeric(value: string): number | null {
  const n = Number(value.replace(/[,%+\s원]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function isExcludedInstrument(name: string, ticker: string): boolean {
  const n = name.toUpperCase();
  if (/ETF|ETN|인버스|레버리지|선물|스팩|SPAC/.test(n)) return true;
  // 상장지수증권·ETN 코드 대역 휴리스틱
  if (/^[57]\d{5}$/.test(ticker) && /ETN|인버스|레버리지|2X|3X/.test(n)) return true;
  return false;
}

function decodeHtml(raw: Buffer): string {
  try {
    return new TextDecoder("euc-kr").decode(raw);
  } catch {
    return raw.toString("utf-8");
  }
}

async function scrapeRisePage(sosok: 0 | 1): Promise<KrGainerRow[]> {
  const market: "KOSPI" | "KOSDAQ" = sosok === 0 ? "KOSPI" : "KOSDAQ";
  const url = `https://finance.naver.com/sise/sise_rise.naver?sosok=${sosok}`;
  const res = await fetch(url, { headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`상승률 페이지 조회 실패 (${res.status})`);
  const html = decodeHtml(Buffer.from(await res.arrayBuffer()));
  const asOf = new Date().toISOString();
  const source = `naver-finance:sise_rise:${market}`;
  const rows: KrGainerRow[] = [];
  const trs = html.match(/<tr>([\s\S]*?)<\/tr>/g) ?? [];

  for (const tr of trs) {
    const codeMatch = tr.match(/code=(\d{6})/);
    if (!codeMatch) continue;
    const ticker = codeMatch[1];
    const nameMatch = tr.match(/code=\d{6}[^>]*>([^<]+)<\/a>/);
    const name = nameMatch?.[1]?.replace(/\s+/g, " ").trim() ?? ticker;
    if (isExcludedInstrument(name, ticker)) continue;

    const tds = Array.from(tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)).map((m) =>
      m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (tds.length < 5) continue;
    const rank = parseNumeric(tds[0]) ?? rows.length + 1;
    const price = parseNumeric(tds[2]);
    const changePct = parseNumeric(tds[4]?.replace("%", "") ?? "");
    const volume = parseNumeric(tds[5]) ?? 0;
    if (price == null || changePct == null) continue;

    rows.push({
      rank,
      ticker,
      name,
      price,
      changePct,
      volume,
      tradingValueWon: null,
      market,
      asOf,
      source,
      currency: "KRW",
    });
  }
  return rows;
}

/** 국내 주식(ETF/ETN 제외) 당일 상승률 상위 N개. KOSPI+KOSDAQ 합산 후 정렬. */
export async function fetchKoreanTopGainers(limit = 70): Promise<KrGainerRow[]> {
  const [kospi, kosdaq] = await Promise.all([scrapeRisePage(0), scrapeRisePage(1)]);
  const merged = [...kospi, ...kosdaq]
    .filter((r) => r.changePct > 0)
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return merged;
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
