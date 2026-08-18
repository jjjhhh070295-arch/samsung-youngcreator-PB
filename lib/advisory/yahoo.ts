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
  const lastPrice =
    Number.isFinite(live) && live > 0 && Math.abs(live / seriesLast - 1) < 0.25
      ? live
      : seriesLast;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
    throw new Error("현재가를 확인하지 못했습니다.");
  }
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    exchange: meta.exchangeName || meta.fullExchangeName || "",
    currency: meta.currency || "USD",
    asOf: lastTs ? new Date(lastTs * 1000).toISOString() : new Date().toISOString(),
    dates,
    closes,
    lastPrice,
    previousClose: Number.isFinite(seriesPrev) && seriesPrev > 0 ? seriesPrev : null,
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
    warning: "회사 개요를 조회하지 못했습니다. 임의 설명은 표시하지 않습니다.",
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
    return empty;
  } catch {
    return empty;
  }
}
