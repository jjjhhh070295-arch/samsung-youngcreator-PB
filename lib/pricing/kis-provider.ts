import { PriceQuote, PricingProvider } from "./types";
import { getKisToken } from "./kis-token";
import { resolveInstrumentForPricing } from "./instrumentIdentity";

const BASE = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

const PRICE_CACHE_TTL_MS = 30_000;
const priceCache = new Map<string, { quote: Omit<PriceQuote, "ticker" | "as_of">; ts: number }>();
let fxCache: { rate: number; ts: number } | null = null;

function getCached(cacheKey: string): Omit<PriceQuote, "ticker" | "as_of"> | undefined {
  const entry = priceCache.get(cacheKey);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PRICE_CACHE_TTL_MS) return undefined;
  return entry.quote;
}
function setCache(cacheKey: string, quote: Omit<PriceQuote, "ticker" | "as_of">) {
  if (quote.price == null) return; // 실패는 캐시하지 않음
  priceCache.set(cacheKey, { quote, ts: Date.now() });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const KIS_REQUEST_INTERVAL_MS = 600;

interface KisEnv {
  appKey: string;
  appSecret: string;
}

function getEnv(): KisEnv | null {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

/** 한국 장중(대략 09:00–15:30 KST)이면 live 후보. 시세 시각이 없으면 보수적으로 false. */
function inferIsLive(quoteTimeRaw: string | null | undefined): boolean {
  if (!quoteTimeRaw) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 && mins <= 15 * 60 + 30;
}

function normalizeQuoteTime(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // HHMMSS → HH:MM:SS (거래시각 — 조회 시각과 구분)
  if (/^\d{6}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`;
  if (/^\d{4}$/.test(s)) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  return s;
}

type DomesticFetchResult = {
  price: number | null;
  quote_time: string | null;
  is_live: boolean;
  error_code: string | null;
  error_message: string | null;
};

async function fetchKrwPrice(
  token: string,
  env: KisEnv,
  providerSymbol: string,
): Promise<DomesticFetchResult> {
  const url =
    `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
    `?fid_cond_mrkt_div_code=J&fid_input_iscd=${encodeURIComponent(providerSymbol)}`;
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "FHKST01010100",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return {
        price: null,
        quote_time: null,
        is_live: false,
        error_code: `HTTP_${res.status}`,
        error_message: `KIS HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const rtCd = String(json?.rt_cd ?? "");
    const msgCd = json?.msg_cd != null ? String(json.msg_cd) : null;
    const msg1 = json?.msg1 != null ? String(json.msg1) : null;
    if (rtCd && rtCd !== "0") {
      return {
        price: null,
        quote_time: null,
        is_live: false,
        error_code: msgCd || `RT_${rtCd}`,
        error_message: msg1 || `KIS business error rt_cd=${rtCd}`,
      };
    }
    const price = parseFloat(json?.output?.stck_prpr);
    const quote_time = normalizeQuoteTime(
      json?.output?.stck_cntg_hour ?? json?.output?.xymd ?? json?.output?.stck_bsop_date,
    );
    if (!isFinite(price) || price <= 0) {
      return {
        price: null,
        quote_time,
        is_live: false,
        error_code: msgCd || "NO_PRICE",
        error_message: msg1 || "유효한 국내 시세가 없습니다.",
      };
    }
    return {
      price,
      quote_time,
      is_live: inferIsLive(quote_time),
      error_code: null,
      error_message: null,
    };
  } catch (e: any) {
    return {
      price: null,
      quote_time: null,
      is_live: false,
      error_code: "FETCH_ERROR",
      error_message: e?.message || "KIS 국내 시세 조회 실패",
    };
  }
}

async function fetchUsdPrice(
  token: string,
  env: KisEnv,
  providerSymbol: string,
): Promise<DomesticFetchResult> {
  const url =
    `${BASE}/uapi/overseas-price/v1/quotations/price` +
    `?AUTH=&EXCD=NAS&SYMB=${encodeURIComponent(providerSymbol)}`;
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "HHDFS00000300",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return {
        price: null,
        quote_time: null,
        is_live: false,
        error_code: `HTTP_${res.status}`,
        error_message: `KIS HTTP ${res.status}`,
      };
    }
    const json = await res.json();
    const rtCd = String(json?.rt_cd ?? "");
    const msgCd = json?.msg_cd != null ? String(json.msg_cd) : null;
    const msg1 = json?.msg1 != null ? String(json.msg1) : null;
    if (rtCd && rtCd !== "0") {
      return {
        price: null,
        quote_time: null,
        is_live: false,
        error_code: msgCd || `RT_${rtCd}`,
        error_message: msg1 || `KIS business error rt_cd=${rtCd}`,
      };
    }
    const price = parseFloat(json?.output?.last);
    if (!isFinite(price) || price <= 0) {
      return {
        price: null,
        quote_time: null,
        is_live: false,
        error_code: msgCd || "NO_PRICE",
        error_message: msg1 || "유효한 해외 시세가 없습니다.",
      };
    }
    return {
      price,
      quote_time: normalizeQuoteTime(json?.output?.xymd ?? json?.output?.t_xymd),
      is_live: false,
      error_code: null,
      error_message: null,
    };
  } catch (e: any) {
    return {
      price: null,
      quote_time: null,
      is_live: false,
      error_code: "FETCH_ERROR",
      error_message: e?.message || "KIS 해외 시세 조회 실패",
    };
  }
}

async function fetchFxUsdKrw(token: string, env: KisEnv): Promise<number> {
  if (fxCache && Date.now() - fxCache.ts < PRICE_CACHE_TTL_MS) return fxCache.rate;
  try {
    const url =
      `${BASE}/uapi/overseas-price/v1/quotations/inquire-daily-chartprice` +
      `?FID_COND_MRKT_DIV_CODE=X&FID_INPUT_ISCD=FX@KRW&FID_INPUT_DATE_1=&FID_INPUT_DATE_2=&FID_PERIOD_DIV_CODE=D`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "FHKST03030200",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return 1350;
    const json = await res.json();
    const rate = parseFloat(json?.output2?.[0]?.ovrs_nmix_prpr);
    const result = isFinite(rate) && rate > 0 ? rate : 1350;
    fxCache = { rate: result, ts: Date.now() };
    return result;
  } catch {
    return 1350;
  }
}

export class KisProvider implements PricingProvider {
  async getQuotes(
    tickers: { ticker: string; currency: "KRW" | "USD" }[],
    opts?: { skipCache?: boolean },
  ): Promise<PriceQuote[]> {
    const env = getEnv();
    const now = new Date().toISOString();
    const skipCache = opts?.skipCache === true;

    if (!env) {
      return tickers.map((t) => ({
        ticker: t.ticker,
        providerSymbol: resolveInstrumentForPricing(t.ticker, t.currency).providerSymbol,
        price: null,
        currency: t.currency,
        as_of: now,
        quote_time: null,
        is_live: false,
        source: "kis" as const,
        stale: true,
        error_code: "KIS_NOT_CONFIGURED",
        error_message: "KIS 자격증명이 없습니다.",
      }));
    }

    const token = await getKisToken(env.appKey, env.appSecret);
    const results: PriceQuote[] = [];
    const needFetch: { ticker: string; currency: "KRW" | "USD"; resolved: ReturnType<typeof resolveInstrumentForPricing> }[] = [];

    for (const t of tickers) {
      const resolved = resolveInstrumentForPricing(t.ticker, t.currency);
      if (resolved.venue === "unsupported") {
        results.push({
          ticker: t.ticker,
          providerSymbol: resolved.providerSymbol,
          price: null,
          currency: t.currency,
          as_of: now,
          quote_time: null,
          is_live: false,
          source: "kis",
          stale: true,
          error_code: "UNSUPPORTED_INSTRUMENT",
          error_message: "KIS 국내/해외 주식 시세 대상이 아닙니다.",
        });
        continue;
      }
      if (!skipCache) {
        const cached = getCached(resolved.cacheKey);
        if (cached !== undefined) {
          results.push({ ...cached, ticker: t.ticker, as_of: now });
          continue;
        }
      }
      needFetch.push({ ...t, resolved });
    }

    for (let i = 0; i < needFetch.length; i++) {
      const t = needFetch[i];
      if (i > 0) await sleep(KIS_REQUEST_INTERVAL_MS);
      const fetched =
        t.currency === "USD"
          ? await fetchUsdPrice(token, env, t.resolved.providerSymbol)
          : await fetchKrwPrice(token, env, t.resolved.providerSymbol);
      const quoteBody: Omit<PriceQuote, "ticker" | "as_of"> = {
        providerSymbol: t.resolved.providerSymbol,
        price: fetched.price,
        currency: t.currency,
        quote_time: fetched.quote_time,
        is_live: fetched.is_live,
        source: "kis",
        stale: fetched.price == null,
        error_code: fetched.error_code,
        error_message: fetched.error_message,
      };
      setCache(t.resolved.cacheKey, quoteBody);
      results.push({ ...quoteBody, ticker: t.ticker, as_of: now });
    }

    const order = new Map(tickers.map((t, i) => [t.ticker, i]));
    return results.sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));
  }

  async getFxUsdKrw(): Promise<number> {
    const env = getEnv();
    if (!env) return 1350;
    const token = await getKisToken(env.appKey, env.appSecret);
    return fetchFxUsdKrw(token, env);
  }
}
