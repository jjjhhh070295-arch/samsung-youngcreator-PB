import { annualizedVolatility, cagr, cleanPrices, daysBetween, drawdown, finite, portfolioNav } from "./calculations";
import { expectedReturn } from "./expectedReturn";
import { PERIODS, REBALANCES, type AnalyticsResult, type Holding, type MarketData, type Options, type Price, type Warning } from "./types";

export function validateRequest(holdings: Holding[], options: Options) {
  if (!options || !PERIODS.includes(options.years) || !REBALANCES.includes(options.rebalance) || !["KRW", "USD"].includes(options.baseCurrency)) throw new Error("분석 설정이 올바르지 않습니다.");
  if (!Array.isArray(holdings) || !holdings.length || holdings.length > 60) throw new Error("분석 종목은 1~60개여야 합니다.");
  for (const h of holdings) {
    if (!h || typeof h.ticker !== "string" || !/^[A-Za-z0-9.^=-]{1,24}$/.test(h.ticker) || typeof h.name !== "string" || h.name.length > 200 ||
      !finite(h.weight) || h.weight <= 0 || h.weight > 1 || !["KRW", "USD"].includes(h.currency) ||
      !["stock", "etf", "other", "cash"].includes(h.assetType) || !["equity", "bond", "dividend", "commodity", "cash"].includes(h.subType)) throw new Error("종목 또는 비중 값이 올바르지 않습니다.");
    const scenario = h.bondEtfScenario;
    if (scenario) {
      if (h.assetType !== "etf" || h.subType !== "bond" ||
        !finite(scenario.rateChangeBp) || Math.abs(scenario.rateChangeBp) > 1000 ||
        !finite(scenario.spreadChangeBp) || Math.abs(scenario.spreadChangeBp) > 1000 ||
        typeof scenario.allowMissingSpreadDuration !== "boolean") {
        throw new Error("채권 ETF 시나리오 값이 올바르지 않습니다.");
      }
      const override = scenario.override;
      const validOptional = (value: unknown, min: number, max: number) =>
        value == null || (finite(value) && value >= min && value <= max);
      if (override && (
        !validOptional(override.ytmPct, -10, 100) ||
        !validOptional(override.effectiveDurationYears, 0, 50) ||
        !validOptional(override.spreadDurationYears, 0, 50) ||
        !validOptional(override.expenseRatioPct, 0, 10) ||
        !validOptional(override.secYieldPct, -10, 100) ||
        !validOptional(override.distributionYieldPct, -10, 100) ||
        typeof override.asOf !== "string" || (override.asOf !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(override.asOf)) ||
        typeof override.sourceLabel !== "string" || override.sourceLabel.length > 200 ||
        (override.sourceUrl != null && (typeof override.sourceUrl !== "string" || override.sourceUrl.length > 500 || (override.sourceUrl !== "" && !/^https?:\/\//i.test(override.sourceUrl))))
      )) throw new Error("채권 ETF PB 검증값이 올바르지 않습니다.");
    }
  }
  if (Math.abs(holdings.reduce((sum, h) => sum + h.weight, 0) - 1) > 0.00001) throw new Error("종목 비중 합계가 100%여야 합니다.");
}

/** No forward fill: only actual common closes are used. Without an exchange
 * calendar, we cannot reliably distinguish a holiday from a provider omission.
 * Long gaps disable risk statistics, rather than synthesizing zero returns. */
export function analyzePortfolio(holdings: Holding[], data: MarketData[], fx: Price[] | null, options: Options, today = new Date().toISOString().slice(0, 10)): AnalyticsResult {
  validateRequest(holdings, options);
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - options.years);
  const requestedStart = start.toISOString().slice(0, 10);
  const warnings: Warning[] = [];
  const needsFx = holdings.some(h => h.currency !== options.baseCurrency);
  const fxMap = new Map(cleanPrices(fx ?? []).filter(p => p.date >= requestedStart && p.date <= today).map(p => [p.date, p.close]));
  const series = holdings.map((h, i) => {
    const item = data[i] ?? { prices: [], source: [] };
    warnings.push(...item.warnings ?? []);
    const prices = cleanPrices(item.prices).filter(p => p.date >= requestedStart && p.date <= today);
    if (h.assetType !== "cash" && (!prices.length || daysBetween(requestedStart, prices[0].date) > 10)) {
      warnings.push({ type: "INSUFFICIENT_HISTORY", ticker: h.ticker, message: "해당 종목의 데이터 부족으로 포트폴리오 분석 기간이 단축되거나 분석이 제한됩니다." });
    }
    return { ...item, prices };
  });
  const expected = holdings.map((h, i) => {
    // Fundamental projections assume unchanged FX; historical fallback includes
    // actual FX when available, keeping base-currency and local returns explicit.
    let expectedData = series[i];
    if (h.currency !== options.baseCurrency && fxMap.size) {
      expectedData = { ...expectedData, prices: expectedData.prices.filter(p => fxMap.has(p.date)).map(p => ({
        date: p.date, close: p.close * (options.baseCurrency === "KRW" ? fxMap.get(p.date)! : 1 / fxMap.get(p.date)!),
      })), source: [...expectedData.source, "Yahoo Finance:USDKRW"] };
    }
    const estimate = expectedReturn(h, expectedData, today);
    if (estimate.value == null) warnings.push({ type: "EXPECTED_RETURN_UNAVAILABLE", ticker: h.ticker, message: `${h.name}: ${estimate.assumptions.join(" ")}` });
    if (estimate.value != null && h.currency !== options.baseCurrency) estimate.assumptions.push(estimate.method === "historical_cagr_fallback" && fxMap.size ? "과거 환율 반영" : "미래 환율 변화 0% 가정 (현지통화 기대수익률)");
    return { ...h, expectedReturn: estimate, contributionToExpectedReturn: estimate.value == null ? null : h.weight * estimate.value };
  });
  const result: AnalyticsResult = {
    portfolio: { expectedReturn: expected.some(h => h.expectedReturn.value == null) ? null : expected.reduce((sum, h) => sum + h.contributionToExpectedReturn!, 0),
      expectedReturnCoverage: expected.reduce((sum, h) => sum + (h.expectedReturn.value == null ? 0 : h.weight), 0), historicalCAGR: null, mdd: null,
      annualizedVolatility: null, analysisPeriod: null, baseCurrency: options.baseCurrency, fxApplied: false, rebalance: options.rebalance },
    holdings: expected, drawdown: null, warnings, nav: [],
  };
  warnings.push({ type: "MODEL_ASSUMPTIONS", message: "기대수익률은 종목별 추정·대용치의 가중합입니다. 세금·거래비용은 제외하며 대기 현금은 이자 0%로 가정합니다." });
  if (needsFx && fxMap.size < 2) {
    warnings.push({ type: "FX_UNAVAILABLE", message: "환율 데이터가 없어 기준통화 과거 지표를 계산하지 않았습니다. 기대수익률은 환율 변화 0% 가정입니다." });
    return result;
  }
  const active = series.filter((_, i) => holdings[i].assetType !== "cash");
  let dates: string[];
  if (!active.length) {
    dates = [];
    for (let d = new Date(start); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
    }
  } else {
    const sets = active.map(s => new Set(s.prices.map(p => p.date)));
    dates = active[0].prices.map(p => p.date).filter(date => sets.every(s => s.has(date)));
  }
  if (needsFx) dates = dates.filter(date => fxMap.has(date));
  if (dates.length < 3) {
    warnings.push({ type: "INSUFFICIENT_DATA", message: "모든 종목·환율의 공통 일봉이 부족하여 과거 지표를 계산하지 않았습니다." });
    return result;
  }
  const omitted = active.some(s => s.prices.some(p => p.date >= dates[0] && p.date <= dates.at(-1)! && !dates.includes(p.date)));
  if (omitted) warnings.push({ type: "COMMON_DATES_ONLY", message: "거래소 휴장·제공처 누락을 확정 구분할 수 없어 실제 공통 종가 날짜만 사용했습니다. 일부 수익률은 여러 거래일을 포함하며 √252 변동성은 근사치입니다." });
  // Combined KR/US holidays can exceed ten calendar days. Two weeks is a
  // conservative data-quality cutoff, not an assertion about exchange holidays.
  const longGap = dates.some((d, i) => i > 0 && daysBetween(dates[i - 1], d) > 14);
  if (longGap) warnings.push({ type: "DATA_GAP", message: "2주를 초과하는 공통 가격 공백이 있어 MDD·변동성을 제공하지 않습니다." });
  if (daysBetween(dates.at(-1)!, today) > 7) warnings.push({ type: "STALE_HISTORY", message: "최근 가격 데이터가 7일 이상 지연되었습니다. 실제 분석 종료일을 확인하세요." });
  const maps = series.map(s => new Map(s.prices.map(p => [p.date, p.close])));
  const rows = dates.map(date => holdings.map((h, i) => {
    const local = h.assetType === "cash" ? 1 : maps[i].get(date)!;
    return local * (h.currency === options.baseCurrency ? 1 : options.baseCurrency === "KRW" ? fxMap.get(date)! : 1 / fxMap.get(date)!);
  }));
  const nav = portfolioNav(dates, rows, holdings.map(h => h.weight), options.rebalance);
  const dd = drawdown(nav);
  const returns = nav.slice(1).map((p, i) => p.value / nav[i].value - 1);
  result.nav = nav;
  result.drawdown = longGap ? null : dd;
  Object.assign(result.portfolio, {
    historicalCAGR: cagr(nav.map(p => ({ date: p.date, close: p.value }))),
    mdd: longGap ? null : dd?.mdd ?? null,
    annualizedVolatility: longGap ? null : annualizedVolatility(returns),
    analysisPeriod: { start: dates[0], end: dates.at(-1)!, years: daysBetween(dates[0], dates.at(-1)!) / 365.25 },
    fxApplied: needsFx,
  });
  return result;
}
