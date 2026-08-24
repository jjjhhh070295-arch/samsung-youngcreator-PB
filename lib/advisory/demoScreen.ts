/**
 * 로컬/데모용 국장 스크리닝 데이터.
 * TRADING_DEMO_MODE=true 이거나 KIS 미설정 시 사용 — 필터·UI·국면 게이트 전체 플로우 검증용.
 */

import type { KrGainerRow } from "./krGainers";
import type { OhlcBar } from "./krTrendFilter";
import { MIN_KR_MARKET_CAP_WON, KR_TOP_GAINERS_LIMIT } from "./krConstants";

export function isTradingDemoMode(): boolean {
  const flag = process.env.TRADING_DEMO_MODE?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "no") return false;
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  const key = process.env.KIS_APP_KEY?.trim();
  const secret = process.env.KIS_APP_SECRET?.trim();
  return !key || !secret;
}

function formatMarketCapWon(won: number): string {
  const eok = won / 100_000_000;
  if (eok >= 10_000) return `${(eok / 10_000).toFixed(2)}조원`;
  return `${Math.round(eok).toLocaleString("ko-KR")}억원`;
}

function marketCapStatus(marketCapWon: number): "ok" | "below_floor" | "unverifiable" {
  if (!(marketCapWon > 0)) return "unverifiable";
  if (marketCapWon < MIN_KR_MARKET_CAP_WON) return "below_floor";
  return "ok";
}

const DEMO_NAMES: Array<{ ticker: string; name: string; market: "KOSPI" | "KOSDAQ"; capTril: number }> = [
  { ticker: "005930", name: "삼성전자", market: "KOSPI", capTril: 400 },
  { ticker: "000660", name: "SK하이닉스", market: "KOSPI", capTril: 180 },
  { ticker: "373220", name: "LG에너지솔루션", market: "KOSPI", capTril: 90 },
  { ticker: "207940", name: "삼성바이오로직스", market: "KOSPI", capTril: 60 },
  { ticker: "005380", name: "현대차", market: "KOSPI", capTril: 45 },
  { ticker: "006400", name: "삼성SDI", market: "KOSPI", capTril: 35 },
  { ticker: "051910", name: "LG화학", market: "KOSPI", capTril: 30 },
  { ticker: "035420", name: "NAVER", market: "KOSPI", capTril: 28 },
  { ticker: "035720", name: "카카오", market: "KOSPI", capTril: 20 },
  { ticker: "068270", name: "셀트리온", market: "KOSPI", capTril: 32 },
];

/** 최근 lookback일: MA20 위 + 양봉 다수 + 끝 연속 양봉은 정확히 3일(전략 신호용) */
export function buildDemoOhlcBars(ticker: string, lookback = 60): OhlcBar[] {
  const seed = Number(ticker.replace(/\D/g, "").slice(-4)) || 1000;
  const bars: OhlcBar[] = [];
  let close = 50_000 + (seed % 40_000);
  const start = Date.UTC(2024, 5, 1);
  for (let i = 0; i < lookback; i += 1) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const nearEnd = i >= lookback - 12 && i < lookback - 4;
    const resetDay = i === lookback - 4;
    const lastThree = i >= lookback - 3;
    let open: number;
    let nextClose: number;
    if (lastThree) {
      open = close;
      nextClose = close * 1.012;
    } else if (resetDay) {
      // 연속 양봉 끊기 → 끝 3일만 정확히 적삼봉
      open = close;
      nextClose = close * 0.99;
    } else if (nearEnd) {
      open = close * 0.998;
      nextClose = close * 1.008;
    } else {
      const up = (i + seed) % 3 !== 0;
      open = close;
      nextClose = up ? close * 1.004 : close * 0.997;
    }
    const high = Math.max(open, nextClose) * 1.005;
    const low = Math.min(open, nextClose) * 0.995;
    bars.push({
      date,
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(nextClose),
      volume: 1_000_000 + i * 1000,
    });
    close = nextClose;
  }
  return bars;
}

export function buildDemoGainers(limit = KR_TOP_GAINERS_LIMIT): {
  gainers: KrGainerRow[];
  unverifiable: KrGainerRow[];
  universeSize: number;
  floorWon: number;
  asOf: string;
  source: string;
} {
  const asOf = new Date().toISOString();
  const floorWon = MIN_KR_MARKET_CAP_WON;
  const pool = [...DEMO_NAMES];
  while (pool.length < limit) {
    const i = pool.length + 1;
    pool.push({
      ticker: String(100000 + i).padStart(6, "0"),
      name: `데모종목${i}`,
      market: i % 2 === 0 ? "KOSPI" : "KOSDAQ",
      capTril: i <= 25 ? 3 + (i % 10) : 0.5,
    });
  }

  const gainers: KrGainerRow[] = pool.slice(0, limit).map((row, index) => {
    const marketCapWon = Math.round(row.capTril * 1_000_000_000_000);
    const status = marketCapStatus(marketCapWon);
    const bars = buildDemoOhlcBars(row.ticker);
    const last = bars[bars.length - 1]!;
    const prev = bars[bars.length - 2]!;
    const changePct = prev.close > 0 ? ((last.close / prev.close) - 1) * 100 : 3;
    return {
      rank: index + 1,
      ticker: row.ticker,
      name: row.name,
      price: last.close,
      changePct: Math.round(changePct * 100) / 100 + (limit - index) * 0.01,
      volume: last.volume,
      tradingValueWon: last.close * last.volume,
      marketCapWon,
      marketCapLabel: formatMarketCapWon(marketCapWon),
      marketCapAsOf: asOf,
      marketCapSource: "demo",
      marketCapStatus: status,
      market: row.market,
      asOf,
      source: "demo:local-screen",
      currency: "KRW" as const,
    };
  });

  // 등락률 정렬 재부여
  gainers.sort((a, b) => b.changePct - a.changePct);
  gainers.forEach((g, i) => {
    g.rank = i + 1;
  });

  return {
    gainers,
    unverifiable: gainers.filter((g) => g.marketCapStatus === "unverifiable"),
    universeSize: gainers.length,
    floorWon,
    asOf,
    source: "demo:local-screen",
  };
}

export function demoThemePass(name: string) {
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    passed: true,
    themeName: `${name} 데모 테마`,
    evidence: "데모 모드 — 리포트 2건 가정",
    source: "https://demo.local/report-1 | https://demo.local/report-2",
    asOf,
    status: "pass" as const,
    reportCount: 2,
    summaryLabel: "데모: 리포트상 중기 테마 근거 충분",
    sources: [
      {
        title: `${name} 산업 리포트`,
        publisher: "demo",
        publishedAt: asOf,
        url: "https://demo.local/report-1",
      },
      {
        title: `${name} 섹터 코멘트`,
        publisher: "demo",
        publishedAt: asOf,
        url: "https://demo.local/report-2",
      },
    ],
  };
}
