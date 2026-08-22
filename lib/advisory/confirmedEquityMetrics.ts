/**
 * PB 확정 국내 주식만으로 주식형 sleeve 성과지표·백테스트 누적을 재계산 (결정론).
 */

export interface ClosePoint {
  date: string;
  close: number;
}

export interface ConfirmedMetricsResult {
  expectedReturnPct: number;
  volatilityPct: number;
  mddPct: number;
  sharpe: number;
  varPct: number;
  cvarPct: number;
  equityAnnualizedReturnPct: number;
  equityCumulativePct: number[];
  portfolioCumulativePct: number[];
  asOf: string;
  source: string;
  currency: "KRW";
  assumptions: string[];
  status: "ok" | "review" | "blocked";
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** 일자별 종가 → 동일가중 누적수익률(%) 시계열 */
export function equalWeightCumulativePct(
  seriesByTicker: Record<string, ClosePoint[]>,
): { dates: string[]; cumulativePct: number[]; status: "ok" | "blocked"; note?: string } {
  const tickers = Object.keys(seriesByTicker).filter((t) => (seriesByTicker[t]?.length ?? 0) >= 2);
  if (tickers.length === 0) {
    return { dates: [], cumulativePct: [], status: "blocked", note: "확정 종목 가격 시계열 부족" };
  }

  const dateSets = tickers.map((t) => new Set(seriesByTicker[t].map((p) => p.date)));
  const commonDates = Array.from(dateSets[0])
    .filter((d) => dateSets.every((s) => s.has(d)))
    .sort((a, b) => a.localeCompare(b));

  if (commonDates.length < 2) {
    return { dates: [], cumulativePct: [], status: "blocked", note: "공통 거래일 부족" };
  }

  const closeMaps = Object.fromEntries(
    tickers.map((t) => [t, new Map(seriesByTicker[t].map((p) => [p.date, p.close]))]),
  );

  const base = tickers.map((t) => closeMaps[t].get(commonDates[0])!);
  const cumulativePct = commonDates.map((d) => {
    const rets = tickers.map((t, i) => {
      const c = closeMaps[t].get(d)!;
      return c / base[i] - 1;
    });
    const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
    return avg * 100;
  });

  return { dates: commonDates, cumulativePct, status: "ok" };
}

/** 누적% → 연율화 수익률 (단순 기간 연율화) */
export function annualizeFromCumulativePct(cumulativePct: number[], dates: string[]): number | null {
  if (cumulativePct.length < 2 || dates.length < 2) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const years = (new Date(last).getTime() - new Date(first).getTime()) / (365.25 * 86_400_000);
  if (!(years > 0)) return null;
  const total = 1 + (cumulativePct[cumulativePct.length - 1] ?? 0) / 100;
  if (!(total > 0)) return null;
  return (Math.pow(total, 1 / years) - 1) * 100;
}

export function historicalVarCvarFromPeriodReturns(
  periodReturns: number[],
  alpha = 0.05,
): { varPct: number; cvarPct: number } {
  if (periodReturns.length < 5) return { varPct: 0, cvarPct: 0 };
  const sorted = [...periodReturns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(sorted.length * alpha) - 1);
  const varR = sorted[idx] ?? 0;
  const tail = sorted.slice(0, idx + 1);
  const cvarR = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : varR;
  return { varPct: round1(varR * 100), cvarPct: round1(cvarR * 100) };
}

export function metricsFromCumulativePct(
  cumulativePcts: number[],
  riskFreeAnnualPct = 3.0,
): Omit<ConfirmedMetricsResult, "equityAnnualizedReturnPct" | "equityCumulativePct" | "portfolioCumulativePct" | "asOf" | "source" | "currency" | "assumptions" | "status"> {
  const n = cumulativePcts.length;
  if (n < 2) {
    return { expectedReturnPct: 0, volatilityPct: 0, mddPct: 0, sharpe: 0, varPct: 0, cvarPct: 0 };
  }

  const periodReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    const prev = 1 + (cumulativePcts[i - 1] ?? 0) / 100;
    const curr = 1 + (cumulativePcts[i] ?? 0) / 100;
    if (prev > 0) periodReturns.push(curr / prev - 1);
  }

  const returnPct = cumulativePcts[n - 1] ?? 0;
  const mean = periodReturns.length ? periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length : 0;
  const variance = periodReturns.length
    ? periodReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / periodReturns.length
    : 0;
  // 일봉 기준이면 √252, 월봉이면 √12 — 호출측 assumptions에 명시. 기본은 일봉.
  const periodsPerYear = 252;
  const volatilityPct = Math.sqrt(variance) * Math.sqrt(periodsPerYear) * 100;

  let peak = 1 + (cumulativePcts[0] ?? 0) / 100;
  let mddPct = 0;
  for (const c of cumulativePcts) {
    const price = 1 + c / 100;
    if (price > peak) peak = price;
    const dd = ((price - peak) / peak) * 100;
    if (dd < mddPct) mddPct = dd;
  }

  const { varPct, cvarPct } = historicalVarCvarFromPeriodReturns(periodReturns);
  const years = n / periodsPerYear;
  const annReturn = years > 0 ? (Math.pow(1 + returnPct / 100, 1 / Math.max(years, 1 / 252)) - 1) * 100 : returnPct;
  const sharpe = volatilityPct > 0 ? (annReturn - riskFreeAnnualPct) / volatilityPct : 0;

  return {
    expectedReturnPct: round1(annReturn),
    volatilityPct: round1(volatilityPct),
    mddPct: round1(mddPct),
    sharpe: round2(sharpe),
    varPct,
    cvarPct,
  };
}

/**
 * 확정 주식 누적(%)과 비주식 벤치마크 누적(%)을 비중으로 합성.
 * nonEquityCumPct[i] = 채권+현금+대체 합산 누적 (이미 가중된 값 또는 단일 bond proxy).
 */
export function blendPortfolioCumulativePct(
  equityCumPct: number[],
  equityWeightPct: number,
  nonEquityCumPct: number[],
  nonEquityWeightPct: number,
): number[] {
  const n = Math.min(equityCumPct.length, nonEquityCumPct.length);
  const total = equityWeightPct + nonEquityWeightPct || 100;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = equityCumPct[i] ?? 0;
    const o = nonEquityCumPct[i] ?? 0;
    out.push((equityWeightPct / total) * e + (nonEquityWeightPct / total) * o);
  }
  return out;
}

/** 월별 벤치마크 포인트 길이에 맞춰 일별 누적을 월말 샘플링 */
export function sampleCumulativeToLength(dailyCumPct: number[], targetLen: number): number[] {
  if (dailyCumPct.length === 0 || targetLen <= 0) return [];
  if (dailyCumPct.length === targetLen) return [...dailyCumPct];
  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const idx = Math.round((i / Math.max(targetLen - 1, 1)) * (dailyCumPct.length - 1));
    out.push(dailyCumPct[idx] ?? 0);
  }
  return out;
}

export function buildConfirmedPortfolioMetrics(input: {
  seriesByTicker: Record<string, ClosePoint[]>;
  equityWeightPct: number;
  /** 비주식 합산 비중 */
  nonEquityWeightPct: number;
  /** 벤치마크와 동일 길이의 비주식 누적% (채권·현금·대체 가중) */
  nonEquityCumulativePct: number[];
  asOf?: string;
  source?: string;
}): ConfirmedMetricsResult {
  const equity = equalWeightCumulativePct(input.seriesByTicker);
  const assumptions = [
    "주식형 = PB 확정 국내 주식 동일가중",
    "비주식 = 기존 SET 채권·현금·대체 proxy 누적",
    "변동성·MDD·Sharpe·VaR/CVaR = 확정 종목 합성 포트폴리오 누적 기준",
    "일봉 수익률 연율화 √252",
  ];

  if (equity.status !== "ok" || equity.cumulativePct.length < 2) {
    return {
      expectedReturnPct: 0,
      volatilityPct: 0,
      mddPct: 0,
      sharpe: 0,
      varPct: 0,
      cvarPct: 0,
      equityAnnualizedReturnPct: 0,
      equityCumulativePct: [],
      portfolioCumulativePct: [],
      asOf: input.asOf ?? new Date().toISOString(),
      source: input.source ?? "confirmed-equity-metrics",
      currency: "KRW",
      assumptions,
      status: "blocked",
    };
  }

  const equityAnn = annualizeFromCumulativePct(equity.cumulativePct, equity.dates) ?? 0;
  const equitySampled = sampleCumulativeToLength(equity.cumulativePct, input.nonEquityCumulativePct.length || equity.cumulativePct.length);
  const nonEq = input.nonEquityCumulativePct.length
    ? input.nonEquityCumulativePct
    : equitySampled.map(() => 0);

  const alignedEquity =
    equitySampled.length === nonEq.length
      ? equitySampled
      : sampleCumulativeToLength(equity.cumulativePct, nonEq.length);

  const portfolioCum = blendPortfolioCumulativePct(
    alignedEquity,
    input.equityWeightPct,
    nonEq,
    input.nonEquityWeightPct,
  );

  const m = metricsFromCumulativePct(portfolioCum);
  const equityOnly = metricsFromCumulativePct(alignedEquity);

  return {
    expectedReturnPct: m.expectedReturnPct,
    volatilityPct: m.volatilityPct,
    mddPct: m.mddPct,
    sharpe: m.sharpe,
    varPct: m.varPct,
    cvarPct: m.cvarPct,
    equityAnnualizedReturnPct: round1(equityAnn || equityOnly.expectedReturnPct),
    equityCumulativePct: alignedEquity,
    portfolioCumulativePct: portfolioCum,
    asOf: input.asOf ?? new Date().toISOString(),
    source: input.source ?? "naver-ohlc+set-non-equity-proxy",
    currency: "KRW",
    assumptions,
    status: "ok",
  };
}

/** IPS/배분 표시용: 확정 종목명만 */
export function ipsEquityLabels(stocks: Array<{ name: string; ticker: string }>): string {
  if (stocks.length === 0) return "주식형 · PB 확정 대기";
  return `주식형 · ${stocks.map((s) => `${s.name}(${s.ticker})`).join(", ")}`;
}
