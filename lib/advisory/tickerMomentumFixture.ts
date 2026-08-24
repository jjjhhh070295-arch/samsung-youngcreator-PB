import type { TickerLiveQuote, TickerMomentumDataset, TickerMomentumOhlcvBar } from "./types";
import type { YahooDaily, YahooProfile } from "./yahoo";

export const MOMENTUM_DEMO_SYMBOLS = ["DEMO-HIGH", "DEMO-NEAR", "DEMO-SHORT"] as const;
export type MomentumDemoSymbol = typeof MOMENTUM_DEMO_SYMBOLS[number];

const FIXTURE_AS_OF = "2026-08-21T06:30:00.000Z";
const FIXTURE_VERSION = "2026-08-23.v1";
const FIXTURE_SOURCE = "local-fixture:ticker-momentum-education";

const ALIASES: Record<string, MomentumDemoSymbol> = {
  "demo-high": "DEMO-HIGH",
  "데모신고가": "DEMO-HIGH",
  "데모 신고가": "DEMO-HIGH",
  "demo-near": "DEMO-NEAR",
  "데모근접": "DEMO-NEAR",
  "데모 근접": "DEMO-NEAR",
  "demo-short": "DEMO-SHORT",
  "데모신규상장": "DEMO-SHORT",
  "데모 신규상장": "DEMO-SHORT",
};

function rounded(value: number) {
  return Number(value.toFixed(4));
}

function tradingDates(endDate: string, count: number) {
  const dates: string[] = [];
  const cursor = new Date(`${endDate}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function baseBars(count: number): TickerMomentumOhlcvBar[] {
  const dates = tradingDates("2026-08-21", count);
  const splitAt = Math.floor(count * 0.55);
  return dates.map((sessionDate, index) => {
    const adjustedClose = 72 + index * 0.13 + Math.sin(index / 7) * 1.7;
    const adjustedOpen = adjustedClose * (1 + Math.sin(index / 4) * 0.0025);
    const adjustedHigh = Math.max(adjustedOpen, adjustedClose) * (1.009 + (index % 4) * 0.0005);
    const adjustedLow = Math.min(adjustedOpen, adjustedClose) * (0.991 - (index % 3) * 0.0004);
    const rawFactor = index < splitAt ? 2 : 1;
    return {
      sessionDate,
      open: rounded(adjustedOpen),
      high: rounded(adjustedHigh),
      low: rounded(adjustedLow),
      close: rounded(adjustedClose),
      volume: 820_000 + (index % 20) * 18_500,
      rawHigh: rounded(adjustedHigh * rawFactor),
      rawClose: rounded(adjustedClose * rawFactor),
    };
  });
}

function replaceLast(
  bars: TickerMomentumOhlcvBar[],
  scenario: "new_high" | "near_high" | "missing_volume",
) {
  const previous = bars.slice(0, -1);
  const priorHigh = Math.max(...previous.slice(-252).map((bar) => bar.high));
  const latest = bars.at(-1)!;
  const previousVolumes = previous.slice(-20).map((bar) => bar.volume ?? 0);
  const meanVolume = previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length;

  if (scenario === "new_high") {
    latest.open = rounded(priorHigh * 0.998);
    latest.close = rounded(priorHigh * 1.008);
    latest.high = rounded(priorHigh * 1.015);
    latest.low = rounded(priorHigh * 0.989);
    latest.volume = Math.round(meanVolume * 1.8);
  } else {
    latest.open = rounded(priorHigh * 0.975);
    latest.close = rounded(priorHigh * 0.982);
    latest.high = rounded(priorHigh * 0.995);
    latest.low = rounded(priorHigh * 0.968);
    latest.volume = scenario === "missing_volume" ? null : Math.round(meanVolume * 1.25);
  }
  latest.rawHigh = latest.high;
  latest.rawClose = latest.close;
  return bars;
}

function datasetFor(symbol: MomentumDemoSymbol): TickerMomentumDataset {
  const isShort = symbol === "DEMO-SHORT";
  const bars = baseBars(isShort ? 120 : 260);
  if (!isShort) replaceLast(bars, symbol === "DEMO-HIGH" ? "new_high" : "near_high");
  return {
    dataMode: "demo",
    approvalStatus: "not_applicable",
    datasetId: `ticker-momentum-${symbol.toLowerCase()}`,
    version: FIXTURE_VERSION,
    label: "교육용 데모 데이터",
    asOf: FIXTURE_AS_OF,
    source: FIXTURE_SOURCE,
    adjustmentStatus: "split_adjusted",
    adjustmentBasis: "2:1 액면분할을 가정해 과거 OHLC를 같은 기준으로 보정한 가상 시계열",
    volumeBasis: "교육용 가상 정규장 거래량 · 수정하지 않은 수량",
    sessionCompleteness: "complete",
    bars,
  };
}

const FIXTURES: Record<MomentumDemoSymbol, TickerMomentumDataset> = {
  "DEMO-HIGH": datasetFor("DEMO-HIGH"),
  "DEMO-NEAR": datasetFor("DEMO-NEAR"),
  "DEMO-SHORT": datasetFor("DEMO-SHORT"),
};

const DISPLAY_NAMES: Record<MomentumDemoSymbol, string> = {
  "DEMO-HIGH": "가상 모멘텀 A (데모 신고가)",
  "DEMO-NEAR": "가상 모멘텀 B (데모 근접)",
  "DEMO-SHORT": "가상 모멘텀 C (데모 신규상장)",
};

export function resolveMomentumDemoSymbol(raw: string): MomentumDemoSymbol | null {
  const normalized = raw.trim().toLowerCase();
  return ALIASES[normalized] ?? null;
}

export function getMomentumDemoDataset(symbol: MomentumDemoSymbol): TickerMomentumDataset {
  return {
    ...FIXTURES[symbol],
    bars: FIXTURES[symbol].bars.map((bar) => ({ ...bar })),
  };
}

export function getMomentumDemoDaily(symbol: MomentumDemoSymbol): YahooDaily {
  const dataset = getMomentumDemoDataset(symbol);
  const closes = dataset.bars.map((bar) => bar.close);
  const latest = dataset.bars.at(-1)!;
  const previous = dataset.bars.at(-2);
  return {
    symbol,
    name: DISPLAY_NAMES[symbol],
    exchange: "교육용 가상 시장",
    currency: "KRW",
    asOf: dataset.asOf,
    dates: dataset.bars.map((bar) => bar.sessionDate),
    closes,
    lastPrice: latest.close,
    previousClose: previous?.close ?? null,
    historySource: dataset.source,
    priceSource: dataset.source,
    quoteDelayMinutes: null,
    marketState: "FIXTURE",
    momentumDataset: dataset,
  };
}

export function getMomentumDemoQuote(symbol: MomentumDemoSymbol): TickerLiveQuote {
  const daily = getMomentumDemoDaily(symbol);
  const previousClose = daily.previousClose;
  return {
    symbol,
    name: daily.name,
    exchange: daily.exchange,
    currency: daily.currency,
    price: daily.lastPrice,
    previousClose,
    changePct: previousClose ? (daily.lastPrice / previousClose - 1) * 100 : null,
    asOf: daily.asOf,
    source: daily.priceSource,
    delayMinutes: null,
    marketState: "FIXTURE",
  };
}

export function getMomentumDemoProfile(symbol: MomentumDemoSymbol): YahooProfile {
  return {
    asOf: FIXTURE_AS_OF,
    source: FIXTURE_SOURCE,
    sector: "교육용 가상 업종",
    industry: "모멘텀 계산 검증",
    longBusinessSummary: `${DISPLAY_NAMES[symbol]}은 52주 신고가·근접·관측기간 부족 상태를 검증하기 위한 교육용 가상 종목입니다. 실제 기업·가격·거래량과 관계가 없습니다.`,
    warning: null,
  };
}
