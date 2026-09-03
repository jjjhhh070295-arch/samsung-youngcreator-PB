import { NextResponse } from "next/server";
import {
  DEFAULT_INDICATOR_IDS,
  getIndicator,
  sanitizeIndicatorIds,
  type MarketIndicator,
} from "@/lib/marketIndicators";
import { loadFredSeries } from "@/lib/macroStress/fred";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 증시·금리 전광판 — PB 가 고른 지표만 조회해 돌려준다.
//
//   GET /api/market                        → 기본 5개
//   GET /api/market?ids=kospi,nasdaq,gold  → 지정한 지표
//
// ids 는 lib/marketIndicators.ts 레지스트리에 있는 id 만 통과한다(서버 화이트리스트).
// 심볼을 직접 받지 않는 이유: 받으면 임의 Yahoo 호출을 대신 해주는 공개 프록시가 된다.
//
// 실패 항목은 건너뛰고 가능한 것만 반환한다(Promise.allSettled) — 지표 하나가 죽어도
// 전광판 전체가 비지 않게.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

interface Ticker {
  /** 레지스트리 id — 화면이 선택 순서대로 정렬할 때 쓴다. */
  id: string;
  label: string;
  sub: string;
  value: string;
  change: string;
  up: boolean;
  /** 이 값의 기준일. Yahoo 실시간은 null, FRED 는 관측일(YYYY-MM-DD). */
  asOf: string | null;
  /** true = FRED 동봉 스냅샷에서 나온 값(실시간 아님). 화면에 구분 표시한다. */
  fallback: boolean;
}

const num = (n: number, d = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// 야후 파이낸스 단일 심볼 시세
async function yahoo(symbol: string) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    { headers: { "user-agent": UA }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const j: any = await res.json();
  const m = j?.chart?.result?.[0]?.meta;
  const price = Number(m?.regularMarketPrice);
  const prev = Number(m?.chartPreviousClose ?? m?.previousClose);
  if (!isFinite(price) || !isFinite(prev)) throw new Error(`yahoo ${symbol} no data`);
  return { price, prev };
}

// 지수·환율·원자재: 등락률(%)
async function indexTicker(ind: MarketIndicator): Promise<Ticker> {
  const { price, prev } = await yahoo(ind.symbol!);
  const pct = ((price - prev) / prev) * 100;
  const up = pct >= 0;
  return {
    id: ind.id,
    label: ind.label,
    sub: ind.sub,
    value: num(price, ind.decimals ?? 2),
    change: `${up ? "+" : ""}${pct.toFixed(2)}%`,
    up,
    asOf: null,
    fallback: false,
  };
}

// 금리: 값 자체가 % 이므로 등락폭(%p)으로 표기.
// Yahoo 금리 심볼은 환경에 따라 4.45 또는 44.5 로 오므로 정규화한다
// (app/api/macro-levels/route.ts 의 ^TNX 처리와 같은 규칙). 이 시대의 미국 국채
// 금리가 20% 를 넘을 일은 없으므로 20 을 경계로 쓴다.
const normalizeYield = (v: number) => (v > 20 ? v / 10 : v);

async function yieldTicker(ind: MarketIndicator): Promise<Ticker> {
  const raw = await yahoo(ind.symbol!);
  const price = normalizeYield(raw.price);
  const prev = normalizeYield(raw.prev);
  const diff = price - prev;
  const up = diff >= 0;
  return {
    id: ind.id,
    label: ind.label,
    sub: ind.sub,
    value: `${price.toFixed(2)}%`,
    change: `${up ? "+" : ""}${diff.toFixed(2)}%p`,
    up,
    asOf: null,
    fallback: false,
  };
}

// FRED 시계열 최신값. loadFredSeries 가 공식 API → CSV → 동봉 스냅샷 순으로
// 알아서 폴백하고, 스냅샷이면 result.fallback 이 true 로 온다(읽기만 하고 수정하지 않는다).
const FRED_START = "2019-01-01";

async function fredRateTicker(ind: MarketIndicator): Promise<Ticker> {
  const result = await loadFredSeries(ind.seriesId!, FRED_START);
  const pts = result.points;
  const latest = pts[pts.length - 1];
  if (!latest) throw new Error(`FRED ${ind.seriesId}: no observations`);
  const prev = pts[pts.length - 2];
  const diff = prev ? latest.value - prev.value : 0;
  const up = diff >= 0;
  return {
    id: ind.id,
    label: ind.label,
    sub: ind.sub,
    value: `${latest.value.toFixed(2)}%`,
    change: `${up ? "+" : ""}${diff.toFixed(2)}%p`,
    up,
    asOf: latest.date,
    fallback: result.fallback,
  };
}

// 지수 원계열(CPI·PPI)을 전년동월비(%)로 환산. 월별 시계열이라 13개월 전과 비교한다.
async function fredYoYTicker(ind: MarketIndicator): Promise<Ticker> {
  const result = await loadFredSeries(ind.seriesId!, FRED_START);
  const pts = result.points;
  if (pts.length < 14) throw new Error(`FRED ${ind.seriesId}: not enough observations`);
  const yoyAt = (i: number) => (pts[i].value / pts[i - 12].value - 1) * 100;
  const latestYoY = yoyAt(pts.length - 1);
  const prevYoY = yoyAt(pts.length - 2);
  const diff = latestYoY - prevYoY;
  const up = diff >= 0;
  return {
    id: ind.id,
    label: ind.label,
    sub: ind.sub,
    value: `${latestYoY.toFixed(2)}%`,
    change: `${up ? "+" : ""}${diff.toFixed(2)}%p`,
    up,
    asOf: pts[pts.length - 1].date,
    fallback: result.fallback,
  };
}

// 한국 국고채 3년 (네이버 마켓인덱스 메인에서 파싱) — 기존 로직 그대로.
async function krBondTicker(ind: MarketIndicator): Promise<Ticker> {
  const res = await fetch("https://finance.naver.com/marketindex/", {
    headers: { "user-agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  const html = new TextDecoder("euc-kr").decode(await res.arrayBuffer());
  const i = html.indexOf("국고채 (3년)");
  if (i === -1) throw new Error("국고채 not found");
  // 해당 행(<tr>)까지만 잘라 다음 종목(회사채 등) 숫자 혼입 방지
  const rowEnd = html.indexOf("</tr>", i);
  const seg = html.slice(i, rowEnd === -1 ? i + 400 : rowEnd);
  const nums = seg.match(/\d+\.\d+/g) || []; // [현재값, 변동폭]
  const value = Number(nums[0]);
  if (!isFinite(value)) throw new Error("국고채 value parse fail");
  const diff = Number(nums[1] ?? 0);
  const down = /ico_down/.test(seg);
  return {
    id: ind.id,
    label: ind.label,
    sub: ind.sub,
    value: `${value.toFixed(2)}%`,
    change: `${down ? "-" : "+"}${(isFinite(diff) ? diff : 0).toFixed(2)}%p`,
    up: !down,
    asOf: null,
    fallback: false,
  };
}

function fetchIndicator(ind: MarketIndicator): Promise<Ticker> {
  switch (ind.kind) {
    case "index":
      return indexTicker(ind);
    case "yield":
      return yieldTicker(ind);
    case "fredRate":
      return fredRateTicker(ind);
    case "fredYoY":
      return fredYoYTicker(ind);
    case "krBond":
      return krBondTicker(ind);
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids");
  const requested = raw
    ? sanitizeIndicatorIds(raw.split(",").map((s) => s.trim()).filter(Boolean))
    : [];
  const ids = requested.length > 0 ? requested : DEFAULT_INDICATOR_IDS;

  const indicators = ids
    .map((id) => getIndicator(id))
    .filter((i): i is MarketIndicator => Boolean(i));

  const settled = await Promise.allSettled(indicators.map(fetchIndicator));
  const items: Ticker[] = [];
  const failedIds: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") items.push(s.value);
    else failedIds.push(indicators[i].id);
  });

  return NextResponse.json({
    ok: items.length > 0,
    updatedAt: new Date().toISOString(),
    /** 실제로 조회한 id 목록 — 화면이 요청과 응답을 대조할 때 쓴다. */
    requestedIds: ids,
    /** 조회에 실패해 items 에서 빠진 id. PB 가 고른 지표가 말없이 사라지지 않게
     *  화면에서 안내한다. 로컬에서는 스냅샷에 없는 FRED 시리즈가 여기 들어온다. */
    failedIds,
    items,
  });
}
