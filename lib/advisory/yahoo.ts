import type { TickerLiveQuote, TickerMomentumDataset } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

const NAME_MAP: Record<string, string> = {
  삼성전자: "005930.KS",
  삼성전자우: "005935.KS",
  엔비디아: "NVDA",
  nvidia: "NVDA",
  nvda: "NVDA",
  테슬라: "TSLA",
  tesla: "TSLA",
  애플: "AAPL",
  apple: "AAPL",
  마이크로소프트: "MSFT",
  tsmc: "TSM",
  코스피: "^KS11",
  "s&p500": "^GSPC",
  spx: "^GSPC",
  kodex미국s: "379800.KS",
};

export function normalizeTickerInput(raw: string): string {
  return raw.trim();
}

export async function resolveYahooSymbol(raw: string): Promise<string> {
  const input = normalizeTickerInput(raw);
  if (!input) throw new Error("티커가 비어 있습니다.");
  const mapped = NAME_MAP[input.toLowerCase()] || NAME_MAP[input];
  if (mapped) return mapped;
  if (/^\d{6}$/.test(input)) {
    const ks = `${input}.KS`;
    const ok = await probe(ks);
    if (ok) return ks;
    const kq = `${input}.KQ`;
    const okq = await probe(kq);
    if (okq) return kq;
    return ks;
  }
  if (/^[A-Za-z0-9.^]+$/.test(input)) return input.toUpperCase();
  return input;
}

async function probe(symbol: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { headers: { "user-agent": UA }, cache: "no-store" },
    );
    if (!res.ok) return false;
    const j: any = await res.json();
    return Boolean(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
  } catch {
    return false;
  }
}

export interface YahooDaily {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  asOf: string;
  dates: string[];
  closes: number[];
  lastPrice: number;
  previousClose: number | null;
  historySource: string;
  priceSource: string;
  quoteDelayMinutes: number | null;
  marketState: string | null;
  /** 승인된 제공처 또는 명시적 교육용 fixture에만 채운다. */
  momentumDataset?: TickerMomentumDataset;
}

export interface YahooProfile {
  asOf: string;
  source: string;
  sector: string | null;
  industry: string | null;
  longBusinessSummary: string | null;
  warning: string | null;
}

export async function fetchYahooDaily(symbol: string, range = "2y"): Promise<YahooDaily> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`);
  const j: any = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error("시세 데이터가 없습니다.");
  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const closesRaw: Array<number | null> = result.indicators?.quote?.[0]?.close ?? [];
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closesRaw[i];
    if (c == null || !Number.isFinite(c)) continue;
    dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
    closes.push(c);
  }
  if (closes.length < 2) throw new Error("분석에 필요한 일봉이 부족합니다.");
  const lastTs = timestamps[timestamps.length - 1];
  const seriesLast = closes[closes.length - 1];
  const seriesPrev = closes[closes.length - 2];
  const live = Number(meta.regularMarketPrice);
  const usesRegularMarketPrice = Number.isFinite(live) && live > 0 && Math.abs(live / seriesLast - 1) < 0.25;
  const lastPrice = usesRegularMarketPrice ? live : seriesLast;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    throw new Error("현재가를 확인하지 못했습니다.");
  }
  const regularMarketTs = Number(meta.regularMarketTime);
  const metaPreviousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const previousClose = Number.isFinite(metaPreviousClose) && metaPreviousClose > 0
    ? metaPreviousClose
    : (Number.isFinite(seriesPrev) && seriesPrev > 0 ? seriesPrev : null);
  const delayRaw = meta.exchangeDataDelayedBy;
  const delay = delayRaw != null && Number.isFinite(Number(delayRaw)) ? Number(delayRaw) : null;
  const asOfTs = usesRegularMarketPrice && Number.isFinite(regularMarketTs) && regularMarketTs > 0
    ? regularMarketTs
    : lastTs;
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    currency: meta.currency || "USD",
    asOf: asOfTs ? new Date(asOfTs * 1000).toISOString() : new Date().toISOString(),
    dates,
    closes,
    lastPrice,
    previousClose,
    historySource: "yahoo-finance:chart:v8:1d",
    priceSource: usesRegularMarketPrice
      ? "yahoo-finance:chart:v8:regularMarketPrice"
      : "yahoo-finance:chart:v8:lastDailyClose",
    quoteDelayMinutes: delay,
    marketState: inferYahooMarketState(meta),
  };
}

function inferYahooMarketState(meta: any): string | null {
  if (typeof meta?.marketState === "string") return meta.marketState;
  const regular = meta?.currentTradingPeriod?.regular;
  const start = Number(regular?.start);
  const end = Number(regular?.end);
  const now = Date.now() / 1000;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return now >= start && now <= end ? "OPEN" : "CLOSED";
  }
  return null;
}

export async function fetchYahooQuote(symbol: string): Promise<TickerLiveQuote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`현재가 조회 실패 (${res.status})`);
  const result = (await res.json())?.chart?.result?.[0];
  if (!result) throw new Error("현재가 데이터가 없습니다.");
  const meta = result.meta ?? {};
  const price = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const marketTime = Number(meta.regularMarketTime);
  if (!Number.isFinite(price) || price <= 0) throw new Error("현재가를 확인하지 못했습니다.");
  const delayRaw = meta.exchangeDataDelayedBy;
  const delayMinutes = delayRaw != null && Number.isFinite(Number(delayRaw)) ? Number(delayRaw) : null;
  const prev = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null;
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    currency: meta.currency || "USD",
    price,
    previousClose: prev,
    changePct: prev ? (price / prev - 1) * 100 : null,
    asOf: Number.isFinite(marketTime) && marketTime > 0
      ? new Date(marketTime * 1000).toISOString()
      : new Date().toISOString(),
    source: "yahoo-finance:chart:v8:regularMarketPrice",
    delayMinutes,
    marketState: inferYahooMarketState(meta),
  };
}

export async function fetchYahooProfile(symbol: string): Promise<YahooProfile> {
  const asOf = new Date().toISOString();
  const source = "yahoo-finance:quoteSummary:assetProfile";
  const empty: YahooProfile = {
    asOf,
    source,
    sector: null,
    industry: null,
    longBusinessSummary: null,
    warning: "회사 개요 제공처의 응답이 없어 원문 기반 소개를 표시하지 못했습니다.",
  };
  try {
    const urls = [
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile`,
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile`,
    ];
    for (const url of urls) {
      const res = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
      if (!res.ok) continue;
      const j: any = await res.json();
      const profile = j?.quoteSummary?.result?.[0]?.assetProfile ?? {};
      const summary = typeof profile.longBusinessSummary === "string" ? profile.longBusinessSummary.trim() : "";
      if (!summary && !profile.sector && !profile.industry) continue;
      return {
        asOf,
        source,
        sector: profile.sector ?? null,
        industry: profile.industry ?? null,
        longBusinessSummary: summary || null,
        warning: summary ? null : "회사 개요 본문이 없어 업종 정보만 표시합니다.",
      };
    }
    const nasdaq = await fetchNasdaqProfile(symbol, asOf);
    return nasdaq ?? empty;
  } catch {
    const nasdaq = await fetchNasdaqProfile(symbol, asOf).catch(() => null);
    return nasdaq ?? empty;
  }
}

async function fetchNasdaqProfile(symbol: string, asOf: string): Promise<YahooProfile | null> {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || /\.(KS|KQ)$/.test(symbol)) return null;
  const res = await fetch(`https://api.nasdaq.com/api/company/${encodeURIComponent(symbol)}/company-profile`, {
    headers: {
      "user-agent": UA,
      accept: "application/json, text/plain, */*",
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json())?.data ?? {};
  const value = (key: string) => typeof data?.[key]?.value === "string" ? data[key].value.trim() : "";
  const summary = value("CompanyDescription");
  const sector = value("Sector");
  const industry = value("Industry");
  if (!summary && !sector && !industry) return null;
  return {
    asOf,
    source: "nasdaq:company-profile",
    sector: sector || null,
    industry: industry || null,
    longBusinessSummary: summary || null,
    warning: summary ? null : "회사 설명 본문이 없어 업종 정보만 표시합니다.",
  };
}
