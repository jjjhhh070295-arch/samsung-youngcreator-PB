import { PriceQuote, PricingProvider } from "./types";
import { getKisToken } from "./kis-token";

const BASE = "https://openapi.koreainvestment.com:9443";

interface KisEnv {
  appKey: string;
  appSecret: string;
  accountNo: string;
}

function getEnv(): KisEnv | null {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  const accountNo = process.env.KIS_ACCOUNT_NO ?? "";
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret, accountNo };
}

async function fetchKrwPrice(token: string, env: KisEnv, ticker: string): Promise<number | null> {
  const url = `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: env.appKey,
      appsecret: env.appSecret,
      tr_id: "FHKST01010100",
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const price = parseFloat(json?.output?.stck_prpr);
  return isNaN(price) ? null : price;
}

async function fetchUsdPrice(token: string, env: KisEnv, ticker: string): Promise<number | null> {
  const url = `${BASE}/uapi/overseas-price/v1/quotations/price?AUTH=&EXCD=NAS&SYMB=${ticker}`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: env.appKey,
      appsecret: env.appSecret,
      tr_id: "HHDFS00000300",
    },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const price = parseFloat(json?.output?.last);
  return isNaN(price) ? null : price;
}

async function fetchFxUsdKrw(token: string, env: KisEnv): Promise<number> {
  const url = `${BASE}/uapi/overseas-price/v1/quotations/inquire-daily-chartprice?FID_COND_MRKT_DIV_CODE=X&FID_INPUT_ISCD=FX@KRW&FID_INPUT_DATE_1=&FID_INPUT_DATE_2=&FID_PERIOD_DIV_CODE=D`;
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "FHKST03030200",
      },
    });
    if (!res.ok) return 1350;
    const json = await res.json();
    const rate = parseFloat(json?.output2?.[0]?.ovrs_nmix_prpr);
    return isNaN(rate) ? 1350 : rate;
  } catch {
    return 1350;
  }
}

export class KisProvider implements PricingProvider {
  async getQuotes(tickers: { ticker: string; currency: "KRW" | "USD" }[]): Promise<PriceQuote[]> {
    const env = getEnv();
    if (!env) {
      return tickers.map((t) => ({
        ticker: t.ticker,
        price: null,
        currency: t.currency,
        as_of: new Date().toISOString(),
        source: "kis" as const,
        stale: true,
      }));
    }

    const token = await getKisToken(env.appKey, env.appSecret);
    const results = await Promise.all(
      tickers.map(async (t) => {
        const price =
          t.currency === "USD"
            ? await fetchUsdPrice(token, env, t.ticker)
            : await fetchKrwPrice(token, env, t.ticker);
        return {
          ticker: t.ticker,
          price,
          currency: t.currency,
          as_of: new Date().toISOString(),
          source: "kis" as const,
          stale: price === null,
        };
      })
    );
    return results;
  }

  async getFxUsdKrw(): Promise<number> {
    const env = getEnv();
    if (!env) return 1350;
    const token = await getKisToken(env.appKey, env.appSecret);
    return fetchFxUsdKrw(token, env);
  }
}
