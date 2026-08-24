import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 증시·금리 티커: 코스피·S&P500·원달러·미국10Y(야후) + 국고채 3년(네이버).
// 무료/무키 소스. 실패 항목은 건너뛰고 가능한 것만 반환.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

interface Ticker {
  label: string;
  sub: string;
  value: string;
  change: string;
  up: boolean;
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

// 지수·환율: 등락률(%)
async function indexTicker(label: string, sub: string, symbol: string, decimals = 2): Promise<Ticker> {
  const { price, prev } = await yahoo(symbol);
  const pct = ((price - prev) / prev) * 100;
  const up = pct >= 0;
  return { label, sub, value: num(price, decimals), change: `${up ? "+" : ""}${pct.toFixed(2)}%`, up };
}

// 금리: 등락폭(%p)
async function yieldTicker(label: string, sub: string, symbol: string): Promise<Ticker> {
  const { price, prev } = await yahoo(symbol);
  const diff = price - prev;
  const up = diff >= 0;
  return { label, sub, value: `${price.toFixed(2)}%`, change: `${up ? "+" : ""}${diff.toFixed(2)}%p`, up };
}

// 한국 국고채 3년 (네이버 마켓인덱스 메인에서 파싱)
async function krBond(): Promise<Ticker> {
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
    label: "한국 국채 3Y",
    sub: "국고채 3년",
    value: `${value.toFixed(2)}%`,
    change: `${down ? "-" : "+"}${(isFinite(diff) ? diff : 0).toFixed(2)}%p`,
    up: !down,
  };
}

export async function GET() {
  const tasks: Promise<Ticker>[] = [
    indexTicker("코스피", "KOSPI", "^KS11"),
    indexTicker("S&P 500", "S&P 500", "^GSPC"),
    indexTicker("원/달러", "USD/KRW", "KRW=X"),
    yieldTicker("미국 국채 10Y", "US 10Y", "^TNX"),
    krBond(),
  ];
  const settled = await Promise.allSettled(tasks);
  const items = settled
    .filter((s): s is PromiseFulfilledResult<Ticker> => s.status === "fulfilled")
    .map((s) => s.value);

  return NextResponse.json({ ok: items.length > 0, updatedAt: new Date().toISOString(), items });
}
