/**
 * KIS 기반 국내주식 상위 등락률 후보 추출.
 * - 조건검색으로 최대 100종 → 등락률 내림차순 → 상위 70
 * - 시총은 70 선정 후 개별 확인 (시총 선필터 금지)
 * - 조건검색 미설정 시 네이버/스크래핑 폴백 없이 config_required
 */

import { kisRequest } from "@/lib/kis/http";
import { getKisConfig } from "@/lib/kis/config";
import { MIN_KR_MARKET_CAP_WON, KR_TOP_GAINERS_LIMIT } from "./krConstants";
import type { OhlcBar } from "./krTrendFilter";
import { completedBarsOnly } from "./krTrendFilter";
import { buildDemoGainers, buildDemoOhlcBars, isTradingDemoMode } from "./demoScreen";

export { MIN_KR_MARKET_CAP_WON } from "./krConstants";

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

export type KrScreenStatus = "ok" | "config_required" | "error";

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.replace(/[,%+\s원억조]/g, "").trim();
  if (!s || s === "-" || s.toUpperCase() === "N/A") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function isExcludedInstrument(name: string): boolean {
  const n = name.toUpperCase();
  return /ETF|ETN|인버스|레버리지|선물|스팩|SPAC|리츠|REIT|우$|우선주|1우|2우|3우/.test(n);
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

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
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

/** KIS 종목조건검색 결과 (eFriend Plus 저장식 seq 필요). */
async function fetchConditionSearchRows(seq: string): Promise<{
  rows: Array<{ ticker: string; name: string; price: number; changePct: number; volume: number; market: "KOSPI" | "KOSDAQ" }>;
  asOf: string;
  source: string;
}> {
  const asOf = new Date().toISOString();
  const source = "kis:psearch-result";
  // HHKST03900400 — 종목조건검색 조회 (공식 국내주식 조건검색)
  const json = await kisRequest<{
    rt_cd?: string;
    msg1?: string;
    output2?: Array<Record<string, string>>;
  }>({
    path: "/uapi/domestic-stock/v1/quotations/psearch-result",
    method: "GET",
    trId: "HHKST03900400",
    query: {
      user_id: "",
      seq: seq,
    },
  });

  if (json.rt_cd && json.rt_cd !== "0") {
    throw new Error(json.msg1 || "KIS 조건검색 실패");
  }

  const raw = Array.isArray(json.output2) ? json.output2 : [];
  const rows = raw
    .map((r) => {
      const ticker = String(r.code ?? r.mksc_shrn_iscd ?? r.jongmok_code ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6);
      const name = String(r.name ?? r.hts_kor_isnm ?? r.jongmok_name ?? "").trim();
      const price = parseNumeric(r.price ?? r.stck_prpr ?? r.current_price) ?? 0;
      const changePct = parseNumeric(r.chgrate ?? r.prdy_ctrt ?? r.change_rate) ?? 0;
      const volume = parseNumeric(r.acml_vol ?? r.volume) ?? 0;
      const marketRaw = String(r.market ?? r.mrkt_div ?? "").toUpperCase();
      const market: "KOSPI" | "KOSDAQ" = marketRaw.includes("KOSDAQ") || marketRaw === "Q" ? "KOSDAQ" : "KOSPI";
      if (!/^\d{6}$/.test(ticker) || !name || isExcludedInstrument(name)) return null;
      return { ticker, name, price, changePct, volume, market };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return { rows, asOf, source };
}

/** 현재가·시총 조회 (시총은 hts_avls 억원 단위 가정). */
export async function fetchKisQuoteMeta(ticker: string): Promise<{
  price: number;
  changePct: number;
  volume: number;
  marketCapWon: number | null;
  name: string | null;
  asOf: string;
  source: string;
}> {
  const asOf = new Date().toISOString();
  const source = "kis:inquire-price:FHKST01010100";
  const json = await kisRequest<{ output?: Record<string, string>; rt_cd?: string }>({
    path: "/uapi/domestic-stock/v1/quotations/inquire-price",
    method: "GET",
    trId: "FHKST01010100",
    query: {
      fid_cond_mrkt_div_code: "J",
      fid_input_iscd: ticker,
    },
  });
  const o = json.output ?? {};
  const price = parseNumeric(o.stck_prpr) ?? 0;
  const changePct = parseNumeric(o.prdy_ctrt) ?? 0;
  const volume = parseNumeric(o.acml_vol) ?? 0;
  const name = o.hts_kor_isnm?.trim() || null;
  // hts_avls: 시가총액(억)
  const eok = parseNumeric(o.hts_avls);
  const marketCapWon = eok != null && eok > 0 ? eok * 100_000_000 : null;
  return { price, changePct, volume, marketCapWon, name, asOf, source };
}

/** 일봉 차트 (완료 봉 필터는 호출측). */
export async function fetchKisOhlcBars(ticker: string, lookbackDays = 80): Promise<{
  bars: OhlcBar[];
  asOf: string;
  source: string;
  name: string | null;
}> {
  if (isTradingDemoMode()) {
    const bars = completedBarsOnly(buildDemoOhlcBars(ticker, Math.max(lookbackDays, 60)));
    return {
      bars,
      asOf: new Date().toISOString(),
      source: "demo:ohlc",
      name: null,
    };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - lookbackDays - 40);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(d)
      .replaceAll("-", "");

  const asOf = new Date().toISOString();
  const source = "kis:inquire-daily-itemchartprice:FHKST03010100";
  const json = await kisRequest<{ output2?: Array<Record<string, string>>; output1?: Record<string, string> }>({
    path: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    method: "GET",
    trId: "FHKST03010100",
    query: {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_INPUT_ISCD: ticker,
      FID_INPUT_DATE_1: fmt(start),
      FID_INPUT_DATE_2: fmt(end),
      FID_PERIOD_DIV_CODE: "D",
      FID_ORG_ADJ_PRC: "0",
    },
  });

  const rows = Array.isArray(json.output2) ? json.output2 : [];
  const bars: OhlcBar[] = rows
    .map((row) => {
      const raw = String(row.stck_bsop_date ?? "");
      const d =
        /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "";
      const open = parseNumeric(row.stck_oprc) ?? 0;
      const high = parseNumeric(row.stck_hgpr) ?? 0;
      const low = parseNumeric(row.stck_lwpr) ?? 0;
      const close = parseNumeric(row.stck_clpr) ?? 0;
      const volume = parseNumeric(row.acml_vol) ?? 0;
      if (!d || !(open > 0) || !(close > 0)) return null;
      return {
        date: d,
        open,
        high: high > 0 ? high : Math.max(open, close),
        low: low > 0 ? low : Math.min(open, close),
        close,
        volume,
      } satisfies OhlcBar;
    })
    .filter((b): b is OhlcBar => Boolean(b))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    bars: completedBarsOnly(bars),
    asOf,
    source,
    name: json.output1?.hts_kor_isnm ?? null,
  };
}

/** @deprecated 이름 호환 — KIS OHLC */
export async function fetchNaverOhlcBars(code: string, lookbackDays = 80) {
  return fetchKisOhlcBars(code, lookbackDays);
}

export async function fetchKoreanTopGainers(limit = KR_TOP_GAINERS_LIMIT): Promise<{
  status: KrScreenStatus;
  gainers: KrGainerRow[];
  unverifiable: KrGainerRow[];
  universeSize: number;
  floorWon: number;
  asOf: string;
  source: string;
  message?: string;
}> {
  if (isTradingDemoMode()) {
    const demo = buildDemoGainers(limit);
    return {
      status: "ok",
      ...demo,
      message: "TRADING_DEMO_MODE — KIS 조건검색 대신 로컬 데모 유니버스",
    };
  }

  const config = getKisConfig();
  const asOf = new Date().toISOString();
  const floorWon = MIN_KR_MARKET_CAP_WON;

  if (!config.appKey || !config.appSecret) {
    return {
      status: "config_required",
      gainers: [],
      unverifiable: [],
      universeSize: 0,
      floorWon,
      asOf,
      source: "kis:unconfigured",
      message: "KIS_APP_KEY / KIS_APP_SECRET 설정이 필요합니다. (또는 TRADING_DEMO_MODE=true)",
    };
  }

  if (!config.conditionSeq) {
    return {
      status: "config_required",
      gainers: [],
      unverifiable: [],
      universeSize: 0,
      floorWon,
      asOf,
      source: "kis:condition-seq-missing",
      message:
        "eFriend Plus에 저장한 종목조건검색식 번호(KIS_CONDITION_SEQ)이 필요합니다. 네이버/스크래핑 폴백은 사용하지 않습니다.",
    };
  }

  try {
    const { rows, asOf: searchAsOf, source } = await fetchConditionSearchRows(config.conditionSeq);
    if (rows.length < Math.min(30, limit)) {
      return {
        status: "config_required",
        gainers: [],
        unverifiable: [],
        universeSize: rows.length,
        floorWon,
        asOf: searchAsOf,
        source,
        message: `조건검색 결과가 ${rows.length}건으로 상위 ${limit}종목을 신뢰성 있게 확보할 수 없습니다. 조건식을 확인하세요.`,
      };
    }

    // 등락률 내림차순 → 상위 70 (시총 선필터 금지)
    const sorted = [...rows].sort((a, b) => b.changePct - a.changePct || a.ticker.localeCompare(b.ticker));
    const top = sorted.slice(0, limit);

    const enriched = await mapPool(top, 2, async (row, index) => {
      let marketCapWon: number | null = null;
      let marketCapAsOf = searchAsOf;
      let marketCapSource = source;
      let price = row.price;
      let changePct = row.changePct;
      let volume = row.volume;
      let name = row.name;
      try {
        const meta = await fetchKisQuoteMeta(row.ticker);
        price = meta.price || price;
        changePct = meta.changePct || changePct;
        volume = meta.volume || volume;
        name = meta.name || name;
        marketCapWon = meta.marketCapWon;
        marketCapAsOf = meta.asOf;
        marketCapSource = meta.source;
      } catch {
        marketCapWon = null;
      }
      const floor = passesMarketCapFloor(marketCapWon);
      const gainer: KrGainerRow = {
        rank: index + 1,
        ticker: row.ticker,
        name,
        price,
        changePct,
        volume,
        tradingValueWon: null,
        marketCapWon,
        marketCapLabel: marketCapWon != null ? formatMarketCapWon(marketCapWon) : "시총 검증 불가",
        marketCapAsOf,
        marketCapSource,
        marketCapStatus: floor.reason,
        market: row.market,
        asOf: searchAsOf,
        source,
        currency: "KRW",
      };
      return gainer;
    });

    const unverifiable = enriched.filter((g) => g.marketCapStatus === "unverifiable");
    return {
      status: "ok",
      gainers: enriched,
      unverifiable,
      universeSize: rows.length,
      floorWon,
      asOf: searchAsOf,
      source,
    };
  } catch (e: unknown) {
    return {
      status: "error",
      gainers: [],
      unverifiable: [],
      universeSize: 0,
      floorWon,
      asOf,
      source: "kis:error",
      message: e instanceof Error ? e.message : "KIS 조회 실패",
    };
  }
}
