import { PriceQuote, PricingProvider } from "./types";
import { getKisToken } from "./kis-token";

const BASE = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

// ── 서버 메모리 가격 캐시 (TTL: 30초) ────────────────────────────────────
// Next.js 단일 프로세스 개발 서버에서 유효. Vercel 서버리스 배포 시에는 cold-start마다 초기화됨.
const PRICE_CACHE_TTL_MS = 30_000;
const priceCache = new Map<string, { price: number | null; ts: number }>();
let fxCache: { rate: number; ts: number } | null = null;

function getCached(key: string): number | null | undefined {
  const entry = priceCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > PRICE_CACHE_TTL_MS) return undefined;
  return entry.price;
}
function setCache(key: string, price: number | null) {
  priceCache.set(key, { price, ts: Date.now() });
}

// ── KIS API 초당 1건 제한 대응: 순차 호출용 sleep ─────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const KIS_REQUEST_INTERVAL_MS = 600; // 초당 ~1.6건 — KIS 실전계좌 연속 조회 여유 확보

// ── 환경변수 로드 ─────────────────────────────────────────────────────────
interface KisEnv {
  appKey: string;
  appSecret: string;
}

function getEnv(): KisEnv | null {
  const appKey    = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

// ── 국내 주식 현재가 ──────────────────────────────────────────────────────
async function fetchKrwPrice(token: string, env: KisEnv, ticker: string): Promise<number | null> {
  const url =
    `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price` +
    `?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`;
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "FHKST01010100",
      },
      next: { revalidate: 0 }, // 캐시 없이 매번 최신값
    });
    if (!res.ok) return null;
    const json = await res.json();
    const price = parseFloat(json?.output?.stck_prpr);
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ── 해외 주식 현재가 (나스닥 기본) ───────────────────────────────────────
async function fetchUsdPrice(token: string, env: KisEnv, ticker: string): Promise<number | null> {
  const url =
    `${BASE}/uapi/overseas-price/v1/quotations/price` +
    `?AUTH=&EXCD=NAS&SYMB=${ticker}`;
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
    if (!res.ok) return null;
    const json = await res.json();
    const price = parseFloat(json?.output?.last);
    return isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ── USD/KRW 환율 ──────────────────────────────────────────────────────────
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

// ── KisProvider ───────────────────────────────────────────────────────────
export class KisProvider implements PricingProvider {
  async getQuotes(
    tickers: { ticker: string; currency: "KRW" | "USD" }[],
  ): Promise<PriceQuote[]> {
    const env = getEnv();
    const now = new Date().toISOString();

    if (!env) {
      return tickers.map((t) => ({
        ticker: t.ticker, price: null, currency: t.currency,
        as_of: now, source: "kis" as const, stale: true,
      }));
    }

    const token = await getKisToken(env.appKey, env.appSecret);
    const results: PriceQuote[] = [];

    // ① 캐시 히트 분리
    const needFetch: typeof tickers = [];
    for (const t of tickers) {
      const cached = getCached(t.ticker);
      if (cached !== undefined) {
        results.push({
          ticker: t.ticker, price: cached, currency: t.currency,
          as_of: now, source: "kis" as const, stale: cached === null,
        });
      } else {
        needFetch.push(t);
      }
    }

    // ② 미캐시 종목만 순차 조회 (KIS 초당 제한 대응)
    for (let i = 0; i < needFetch.length; i++) {
      const t = needFetch[i];
      if (i > 0) await sleep(KIS_REQUEST_INTERVAL_MS);
      const price =
        t.currency === "USD"
          ? await fetchUsdPrice(token, env, t.ticker)
          : await fetchKrwPrice(token, env, t.ticker);
      if (price !== null) setCache(t.ticker, price); // 실패(null)는 캐시 안 함 → 다음 요청에서 재시도
      results.push({
        ticker: t.ticker, price, currency: t.currency,
        as_of: now, source: "kis" as const, stale: price === null,
      });
    }

    // 입력 순서 복원
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
