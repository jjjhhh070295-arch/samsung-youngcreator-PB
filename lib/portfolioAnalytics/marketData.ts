import { domesticCodeFromSymbol } from "../advisory/naver";
import { fetchOfficialBondEtfFundamentals } from "./bondEtfFundamentals";
import { cleanPrices, finite } from "./calculations";
import type { Fundamentals, Holding, MarketData, Period, Price } from "./types";

const HEADERS = { "user-agent": "Mozilla/5.0", referer: "https://m.stock.naver.com/" };
const cache = new Map<string, { expires: number; promise: Promise<MarketData> }>();
const TTL = 15 * 60 * 1000;
async function json(url: string) {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`데이터 제공처 응답 ${response.status}`);
  return response.json();
}
function cached(key: string, fetcher: () => Promise<MarketData>) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  const entry = { expires: Date.now() + TTL, promise: fetcher() };
  cache.set(key, entry);
  entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  return entry.promise;
}
export function parseYahooHistory(payload: any): MarketData {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo 일봉 데이터가 없습니다.");
  const timestamps: unknown[] = result.timestamp ?? [];
  const adjusted: unknown[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const raw: unknown[] = result.indicators?.quote?.[0]?.close ?? [];
  // Never splice raw and adjusted prices: mixed bases create artificial jumps.
  const isAdjusted = adjusted.length === timestamps.length && adjusted.some(n => finite(n) && n > 0);
  const values = isAdjusted ? adjusted : raw;
  const prices = cleanPrices(timestamps.flatMap((ts, i) => finite(ts) && Math.abs(ts) < 8.64e12 && finite(values[i]) && (values[i] as number) > 0
    ? [{ date: new Date(ts * 1000).toISOString().slice(0, 10), close: values[i] as number }] : []));
  if (!prices.length) throw new Error("Yahoo 유효 가격이 없습니다.");
  return { prices, source: [isAdjusted ? "Yahoo Finance:adjusted-close" : "Yahoo Finance:close"],
    warnings: isAdjusted ? [] : [{ type: "PRICE_RETURN_ONLY", message: "Yahoo 수정종가가 없어 일반 종가를 사용합니다. 배당·기업행동 조정이 불완전할 수 있습니다." }] };
}
export function parseNaverHistory(rows: unknown): MarketData {
  if (!Array.isArray(rows)) throw new Error("Naver 일봉 응답이 올바르지 않습니다.");
  const prices = cleanPrices(rows.flatMap(row => {
    const date = row?.localDate;
    const close = typeof row?.closePrice === "number" ? row.closePrice : typeof row?.closePrice === "string" && row.closePrice.trim() ? Number(row.closePrice.replaceAll(",", "")) : null;
    return typeof date === "string" && /^\d{8}$/.test(date) && finite(close) ? [{ date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, close }] : [];
  }));
  if (!prices.length) throw new Error("Naver 유효 가격이 없습니다.");
  return { prices, source: ["Naver Finance:domestic-day-close"], warnings: [{ type: "PRICE_RETURN_ONLY", message: "국내 데이터는 Naver 종가 기준입니다. 배당 재투자를 포함하지 않으며 분할·기업행동 조정 여부는 보장되지 않습니다." }] };
}
// Only documented-in-payload forward fields are consumed. Quarterly earnings
// growth is deliberately NOT substituted for a three-year analyst growth rate.
export function parseFundamentals(payload: any): Fundamentals {
  const r = payload?.quoteSummary?.result?.[0];
  if (!r) return {};
  const raw = (v: unknown) => {
    const value = v && typeof v === "object" && "raw" in v ? (v as { raw: unknown }).raw : v;
    return finite(value) ? value : undefined;
  };
  const stats = r.defaultKeyStatistics ?? {}, detail = r.summaryDetail ?? {};
  return {
    currentPrice: raw(r.price?.regularMarketPrice), forwardEPS: raw(stats.forwardEps),
    currentForwardPE: raw(stats.forwardPE), dividendYield: raw(detail.dividendYield),
    // Yahoo summaryDetail.yield is a fund distribution yield, not YTM.
    distributionYield: raw(detail.yield), expenseRatio: raw(r.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio),
  };
}
async function yahooHistory(symbol: string, years: Period) {
  return parseYahooHistory(await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${years}y`));
}
async function fetchHolding(h: Holding, years: Period): Promise<MarketData> {
  const code = h.currency === "KRW" ? domesticCodeFromSymbol(h.ticker) : null;
  const fundamentalsPromise = code || h.assetType === "other" ? Promise.resolve({} as Fundamentals) :
    json(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(h.ticker)}?modules=price,defaultKeyStatistics,summaryDetail,fundProfile`)
      .then(parseFundamentals).catch(() => ({} as Fundamentals));
  const officialBondFactsPromise = h.assetType === "etf" && h.subType === "bond"
    ? fetchOfficialBondEtfFundamentals(h.ticker)
    : Promise.resolve(null);
  let history: MarketData;
  if (code) {
    const end = new Date(), start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - years);
    const key = (d: Date) => d.toISOString().slice(0, 10).replaceAll("-", "");
    history = await json(`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/day?startDateTime=${key(start)}0000&endDateTime=${key(end)}2359`).then(parseNaverHistory);
  } else {
    history = await yahooHistory(h.ticker, years);
  }
  const [quoteFundamentals, officialBondFacts] = await Promise.all([
    fundamentalsPromise,
    officialBondFactsPromise,
  ]);
  // The issuer facts are authoritative for YTM/duration/fees. Yahoo remains the
  // price/distribution fallback and must never overwrite official bond metrics.
  const fundamentals = {
    ...quoteFundamentals,
    ...(officialBondFacts?.fundamentals ?? {}),
  };
  const hasNumericFundamentals = Object.values(fundamentals).some(finite);
  return { ...history, fundamentals,
    source: [
      ...history.source,
      ...(Object.values(quoteFundamentals).some(finite) ? ["Yahoo Finance:quoteSummary"] : []),
      ...(officialBondFacts?.source ?? []),
    ],
    warnings: [
      ...history.warnings ?? [],
      ...(officialBondFacts?.warnings ?? []),
      ...(!hasNumericFundamentals ? [{ type: "FUNDAMENTALS_UNAVAILABLE", message: "안정적인 펀더멘털·펀드 수익률 데이터가 없어 충분한 과거 이력이 있는 경우에만 CAGR 대용치를 사용합니다. 이력도 부족하면 기대수익률을 제공하지 않습니다." }] : []),
    ].map(w => ({ ...w, ticker: h.ticker })) };
}
export interface MarketDataProvider {
  holding(holding: Holding, years: Period): Promise<MarketData>;
  usdKrw(years: Period): Promise<Price[]>;
}
export const marketDataProvider: MarketDataProvider = {
  holding(h, years) {
    if (h.assetType === "cash") return Promise.resolve({ prices: [], source: ["V1:cash-assumption"] });
    return cached(`${h.ticker}:${h.currency}:${h.assetType}:${years}`, () => fetchHolding(h, years));
  },
  async usdKrw(years) {
    const data = await cached(`USDKRW:${years}`, () => yahooHistory("KRW=X", years));
    return data.prices;
  },
};
