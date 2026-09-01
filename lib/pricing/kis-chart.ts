import { getKisToken } from "./kis-token";
import type { InvestorFlowBar, InvestorFlowSeries, OhlcBar, OhlcDaily } from "@/lib/advisory/ohlcTypes";

const BASE = process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

function getEnv() {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseNum(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}

/** KIS 국내 일봉 OHLCV (FHKST03010100). env 없으면 null. */
export async function fetchKisDailyOhlc(
  code: string,
  opts?: { name?: string; exchange?: string },
): Promise<OhlcDaily | null> {
  const env = getEnv();
  if (!env) return null;

  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 2);

  const url =
    `${BASE}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` +
    `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}` +
    `&FID_INPUT_DATE_1=${ymd(start)}&FID_INPUT_DATE_2=${ymd(end)}` +
    `&FID_PERIOD_DIV_CODE=D&FID_ORG_ADJ_PRC=0`;

  const token = await getKisToken(env.appKey, env.appSecret);
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: env.appKey,
      appsecret: env.appSecret,
      tr_id: "FHKST03010100",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const json = await res.json();
  const rows: unknown[] = json?.output2 ?? [];
  const bars: OhlcBar[] = rows
    .map((row: any) => ({
      time: formatDate(String(row?.stck_bsop_date ?? "")),
      open: parseNum(row?.stck_oprc),
      high: parseNum(row?.stck_hgpr),
      low: parseNum(row?.stck_lwpr),
      close: parseNum(row?.stck_clpr),
      volume: parseNum(row?.acml_vol),
    }))
    .filter((b) => b.time && b.close > 0)
    .sort((a, b) => a.time.localeCompare(b.time));

  if (bars.length < 1) return null;

  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const asOf = new Date().toISOString();

  return {
    symbol: `${code}.KS`,
    name: opts?.name ?? code,
    exchange: opts?.exchange ?? "KRX",
    currency: "KRW",
    asOf,
    bars,
    lastPrice: last.close,
    previousClose: prev?.close ?? null,
    historySource: "kis:domestic-stock:inquire-daily-itemchartprice",
    priceSource: "kis:domestic-stock:inquire-daily-itemchartprice",
    quoteDelayMinutes: 0,
    marketState: null,
  };
}

/** KIS 투자자별 매매동향 (FHKST01010900). */
export async function fetchKisInvestorFlow(code: string): Promise<InvestorFlowSeries> {
  const env = getEnv();
  const empty: InvestorFlowSeries = {
    asOf: new Date().toISOString(),
    source: "kis:domestic-stock:inquire-investor",
    connected: false,
    bars: [],
    note: "수급 데이터 env/API 미연결 (KIS_APP_KEY, KIS_APP_SECRET 필요)",
  };
  if (!env) return empty;

  const url =
    `${BASE}/uapi/domestic-stock/v1/quotations/inquire-investor` +
    `?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`;

  try {
    const token = await getKisToken(env.appKey, env.appSecret);
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: env.appKey,
        appsecret: env.appSecret,
        tr_id: "FHKST01010900",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ...empty, note: `KIS 수급 API 오류 (${res.status})` };
    }
    const json = await res.json();
    const rows: any[] = json?.output ?? json?.output2 ?? [];
    const bars: InvestorFlowBar[] = rows
      .map((row) => ({
        time: formatDate(String(row?.stck_bsop_date ?? row?.bsop_date ?? "")),
        foreignNet: parseNum(row?.frgn_ntby_qty ?? row?.frgn_ntby_tr_pbmn),
        institutionNet: parseNum(row?.orgn_ntby_qty ?? row?.orgn_ntby_tr_pbmn),
        individualNet: parseNum(row?.prsn_ntby_qty ?? row?.prsn_ntby_tr_pbmn),
      }))
      .filter((b) => b.time)
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-60);

    return {
      asOf: new Date().toISOString(),
      source: "kis:domestic-stock:inquire-investor",
      connected: bars.length > 0,
      bars,
      note: bars.length ? undefined : "KIS 수급 응답에 유효한 일별 데이터가 없습니다.",
    };
  } catch {
    return { ...empty, note: "KIS 수급 API 호출 실패" };
  }
}

export function isKisConfigured(): boolean {
  return !!(process.env.KIS_APP_KEY && process.env.KIS_APP_SECRET);
}
