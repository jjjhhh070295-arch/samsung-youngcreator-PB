import type { TickerLiveQuote } from "./types";
import type { YahooDaily, YahooProfile } from "./yahoo";

const NAVER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://m.stock.naver.com/",
};

export interface NaverStockMatch {
  code: string;
  name: string;
  typeCode: string;
  typeName: string;
  nationCode: string;
  category: string;
}

interface NaverBasic {
  itemCode?: string;
  stockName?: string;
  closePrice?: string;
  compareToPreviousClosePrice?: string;
  marketStatus?: string;
  localTradedAt?: string;
  stockExchangeType?: {
    code?: string;
    delayTime?: number;
    name?: string;
    nameKor?: string;
  };
  stockExchangeName?: string;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[,%+\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

function isDomesticStockCode(value: string) {
  const normalized = value.trim();
  return /^[0-9A-Z]{6}$/i.test(normalized) && /\d/.test(normalized);
}

function yahooSymbol(code: string, marketCode?: string, typeCode?: string) {
  const market = `${marketCode ?? ""} ${typeCode ?? ""}`.toUpperCase();
  if (market.includes("KQ") || market.includes("KOSDAQ")) return `${code}.KQ`;
  if (market.includes("KS") || market.includes("KOSPI")) return `${code}.KS`;
  return code;
}

export function domesticCodeFromSymbol(symbol: string): string | null {
  const match = symbol.toUpperCase().match(/^([0-9A-Z]{6})(?:\.(?:KS|KQ))?$/);
  return match && isDomesticStockCode(match[1]) ? match[1] : null;
}

export function yahooSymbolFromNaverMatch(match: NaverStockMatch) {
  return yahooSymbol(match.code, undefined, match.typeCode);
}

export async function searchNaverStock(query: string): Promise<NaverStockMatch | null> {
  const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock,marketindicator,index`;
  const res = await fetch(url, { headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`국내 종목명 검색 실패 (${res.status})`);
  const items: NaverStockMatch[] = (await res.json())?.items ?? [];
  const domestic = items.filter((item) =>
    item?.nationCode === "KOR" && item?.category === "stock" && isDomesticStockCode(item.code),
  );
  if (!domestic.length) return null;
  const normalizedQuery = normalizeName(query);
  const exact = domestic.find((item) =>
    normalizeName(item.name) === normalizedQuery || item.code.toUpperCase() === query.trim().toUpperCase(),
  );
  if (exact) return exact;

  // 영문 티커(NVDA, META 등)가 국내 부분일치 종목으로 잘못 선택되는 것을 막는다.
  // 한글 검색어는 네이버 자동완성의 첫 국내 종목을 계속 활용한다.
  return /[가-힣]/.test(query) ? domestic[0] : null;
}

async function fetchNaverBasic(code: string): Promise<NaverBasic> {
  const res = await fetch(`https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`, {
    headers: NAVER_HEADERS,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`네이버 현재가 조회 실패 (${res.status})`);
  return res.json();
}

export async function fetchNaverQuote(code: string): Promise<TickerLiveQuote> {
  const basic = await fetchNaverBasic(code);
  const price = parseNumeric(basic.closePrice);
  const change = parseNumeric(basic.compareToPreviousClosePrice);
  if (price == null || price <= 0) throw new Error("네이버 현재가를 확인하지 못했습니다.");
  const previousClose = change == null ? null : price - change;
  const marketCode = basic.stockExchangeType?.code;
  const delayRaw = basic.stockExchangeType?.delayTime;
  const delayMinutes = delayRaw != null && Number.isFinite(Number(delayRaw)) ? Number(delayRaw) : null;
  return {
    symbol: yahooSymbol(code, marketCode),
    name: basic.stockName?.trim() || code,
    exchange: basic.stockExchangeType?.nameKor || basic.stockExchangeName || basic.stockExchangeType?.name || "KRX",
    currency: "KRW",
    price,
    previousClose: previousClose != null && previousClose > 0 ? previousClose : null,
    changePct: previousClose != null && previousClose > 0 ? (price / previousClose - 1) * 100 : null,
    asOf: basic.localTradedAt && !Number.isNaN(new Date(basic.localTradedAt).getTime())
      ? new Date(basic.localTradedAt).toISOString()
      : new Date().toISOString(),
    source: "naver-finance:mobile-stock:basic",
    delayMinutes,
    marketState: basic.marketStatus ?? null,
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

export async function fetchNaverDaily(code: string): Promise<YahooDaily> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  start.setUTCDate(start.getUTCDate() - 14);
  const startKey = dateKey(start).replaceAll("-", "");
  const endKey = dateKey(end).replaceAll("-", "");
  const historyUrl =
    `https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/day` +
    `?startDateTime=${startKey}0000&endDateTime=${endKey}2359`;

  const [quote, historyResponse] = await Promise.all([
    fetchNaverQuote(code),
    fetch(historyUrl, { headers: NAVER_HEADERS, cache: "no-store" }),
  ]);
  if (!historyResponse.ok) throw new Error(`네이버 일봉 조회 실패 (${historyResponse.status})`);
  const rows: Array<{ localDate?: string; closePrice?: number }> = await historyResponse.json();
  const points = rows
    .map((row) => ({
      time: typeof row.localDate === "string" && /^\d{8}$/.test(row.localDate)
        ? `${row.localDate.slice(0, 4)}-${row.localDate.slice(4, 6)}-${row.localDate.slice(6, 8)}`
        : "",
      close: parseNumeric(row.closePrice),
    }))
    .filter((point): point is { time: string; close: number } => Boolean(point.time) && point.close != null && point.close > 0)
    .sort((a, b) => a.time.localeCompare(b.time));
  // 신규 상장 첫날에는 일봉이 하나뿐일 수 있다. 화면과 현재가는 제공하고,
  // 계산할 수 없는 장기 지표는 snapshot 단계에서 null과 경고로 표시한다.
  if (points.length < 1) throw new Error("분석에 필요한 국내 일봉이 없습니다.");

  const tradedDate = dateKey(new Date(quote.asOf));
  const latest = points.at(-1);
  if (latest?.time === tradedDate) latest.close = quote.price;
  else if (!latest || latest.time < tradedDate) points.push({ time: tradedDate, close: quote.price });

  return {
    symbol: quote.symbol,
    name: quote.name,
    exchange: quote.exchange,
    currency: quote.currency,
    asOf: quote.asOf,
    dates: points.map((point) => point.time),
    closes: points.map((point) => point.close),
    lastPrice: quote.price,
    previousClose: quote.previousClose,
    historySource: "naver-finance:chart:domestic-day",
    priceSource: quote.source,
    quoteDelayMinutes: quote.delayMinutes,
    marketState: quote.marketState,
  };
}

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(value: string) {
  return decodeEntities(value.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchNaverProfile(code: string): Promise<YahooProfile> {
  const asOf = new Date().toISOString();
  const res = await fetch(`https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`, {
    headers: { ...NAVER_HEADERS, referer: "https://finance.naver.com/" },
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      asOf,
      source: "naver-finance:item-main:fnguide",
      sector: null,
      industry: null,
      longBusinessSummary: null,
      warning: `국내 기업개요 조회 실패 (${res.status})`,
    };
  }
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  const encoding = contentType.includes("euc-kr") ? "euc-kr" : "utf-8";
  const html = new TextDecoder(encoding).decode(await res.arrayBuffer());
  const summaryBlock = html.match(/<div[^>]+id=["']summary_info["'][^>]*>([\s\S]*?)<div[^>]+class=["']txt_notice["']/i)?.[1] ?? "";
  const paragraphs = Array.from(summaryBlock.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => htmlToText(match[1]))
    .filter(Boolean);
  const summary = paragraphs.join(" ");
  return {
    asOf,
    source: "naver-finance:item-main:fnguide",
    sector: null,
    industry: null,
    longBusinessSummary: summary || null,
    warning: summary ? null : "네이버 종목 페이지에 기업개요 원문이 없습니다.",
  };
}
