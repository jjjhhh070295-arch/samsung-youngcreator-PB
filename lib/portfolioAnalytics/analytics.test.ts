import test from "node:test";
import assert from "node:assert/strict";
import { analyzePortfolio, validateRequest } from "./analytics";
import { annualizedVolatility, cleanPrices, drawdown, portfolioNav, shouldRebalance } from "./calculations";
import { expectedReturn } from "./expectedReturn";
import { parseFundamentals, parseNaverHistory, parseYahooHistory } from "./marketData";
import { selectionToHoldings } from "./selection";
import { portfolioAnalytics } from "./service";
import { assumptionKey, calculatePBScenario, parsePBAssumption } from "./pbScenario";
import type { Holding, MarketData, Options, Price } from "./types";

const options: Options = { years: 5, rebalance: "quarterly", baseCurrency: "KRW" };
const stock = (overrides: Partial<Holding> = {}): Holding => ({ ticker: "005930", name: "삼성전자", weight: 1, currency: "KRW", assetType: "stock", subType: "equity", ...overrides });
const dates = ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"];
const prices = (values: number[], ds = dates): Price[] => values.map((close, i) => ({ date: ds[i], close }));
const data = (values: number[], ds = dates): MarketData => ({ prices: prices(values, ds), source: ["fixture"] });
const close = (a: number | null, b: number, epsilon = 1e-10) => assert.ok(a != null && Math.abs(a - b) < epsilon, `${a} != ${b}`);

test("PB scenario validates explicit inputs, including zero and negative returns", () => {
  for (const rate of ["", " ", "NaN", "Infinity", "-101", "1001"]) assert.throws(() => parsePBAssumption(rate, "근거"));
  assert.throws(() => parsePBAssumption("10", " "));
  close(parsePBAssumption("0", "가격 유지 판단").value, 0);
  close(parsePBAssumption("-20", "하락 시나리오").value, -0.2);
});
test("PB scenario keeps original result untouched, rejects partial coverage, and reweights", () => {
  const holdings = [stock({ weight: 0.6 }), stock({ ticker: "NEW", weight: 0.4 })];
  const input = [data([100, 101, 99, 102]), data([100, 100, 100, 100])];
  const result = analyzePortfolio(holdings, input, null, options, dates[3]);
  const original = JSON.stringify(result);
  const assumptions = { [assumptionKey(holdings[0])]: parsePBAssumption("10", "PB 판단") };
  assert.equal(calculatePBScenario(result, assumptions).value, null);
  assumptions[assumptionKey(holdings[1])] = parsePBAssumption("-5", "신규상장 보수적 시나리오");
  close(calculatePBScenario(result, assumptions).value, 0.04);
  const changed = analyzePortfolio(holdings.map(h => ({ ...h, weight: 0.5 })), input, null, options, dates[3]);
  close(calculatePBScenario(changed, assumptions).value, 0.025);
  assert.equal(JSON.stringify(result), original);
  assert.equal(result.portfolio.expectedReturn, null);
  assert.equal(calculatePBScenario(result, {}).value, null);
});
test("PB overrides only missing evidence and ignores stale unrelated symbols", () => {
  const h = stock();
  const input = { ...data([100, 101, 99, 102]), fundamentals: { currentPrice: 100, forwardEPS: 5, targetPE: 20, expectedEPSGrowth: 0.1, dividendYield: 0.02 } };
  const result = analyzePortfolio([h], [input], null, options, dates[3]);
  const scenario = calculatePBScenario(result, { [assumptionKey(h)]: parsePBAssumption("90", "이전 가정"), stale: parsePBAssumption("50", "다른 종목") });
  close(scenario.value, 0.12); close(scenario.assumedWeight, 0);
});

test("1: single 100% holding tracks its price return", () => {
  const result = analyzePortfolio([stock()], [data([100, 110, 99, 120])], null, options, dates[3]);
  assert.deepEqual(result.nav.map(p => p.value), [100, 110, 99, 120]);
  close(result.portfolio.mdd, -0.1);
});
test("2: constant asset and all-cash have zero risk", () => {
  const result = analyzePortfolio([stock()], [data([100, 100, 100, 100])], null, options, dates[3]);
  close(result.portfolio.mdd, 0); close(result.portfolio.annualizedVolatility, 0);
  const cash = analyzePortfolio([stock({ assetType: "cash", subType: "cash" })], [{ prices: [], source: [] }], null, options, dates[3]);
  close(cash.portfolio.historicalCAGR, 0); close(cash.portfolio.expectedReturn, 0); close(cash.portfolio.annualizedVolatility, 0);
});
test("3: 50/50 returns use current weights and drift between rebalance dates", () => {
  const nav = portfolioNav(dates.slice(0, 3), [[100, 100], [110, 90], [121, 81]], [0.5, 0.5], "none");
  close(nav[1].value, 100); close(nav[2].value, 101);
});
test("4: portfolio drawdown of 100,120,90,110 is -25%", () => {
  const dd = drawdown([100, 120, 90, 110].map((value, i) => ({ date: dates[i], value })))!;
  close(dd.mdd, -0.25); assert.equal(dd.peakDate, dates[1]); assert.equal(dd.troughDate, dates[2]); assert.equal(dd.recoveryDate, null);
  const recovered = drawdown([100, 120, 90, 120].map((value, i) => ({ date: dates[i], value })))!;
  assert.equal(recovered.recoveryDate, dates[3]); assert.equal(recovered.recoveryDays, 4);
});
test("5: incomplete, negative, zero, non-finite weights rejected", () => {
  for (const weight of [0.99, -1, 0, NaN, Infinity]) assert.throws(() => validateRequest([stock({ weight })], options));
  assert.throws(() => validateRequest([], options));
});
test("6: missing evidence yields null expectations and never fabricates history", () => {
  const result = analyzePortfolio([stock()], [{ prices: [], source: [] }], null, options, dates[3]);
  assert.equal(result.portfolio.historicalCAGR, null); assert.equal(result.portfolio.mdd, null);
  assert.equal(result.holdings[0].expectedReturn.method, "insufficient_evidence");
  assert.equal(result.holdings[0].expectedReturn.value, null);
  assert.equal(result.holdings[0].contributionToExpectedReturn, null);
  assert.equal(result.portfolio.expectedReturn, null);
  assert.equal(result.portfolio.expectedReturnCoverage, 0);
  assert.ok(result.warnings.some(w => w.type === "EXPECTED_RETURN_UNAVAILABLE"));
  assert.ok(result.warnings.some(w => w.type === "INSUFFICIENT_DATA"));
});
test("7: mixed KRW/USD uses historical FX and supports inverse USD conversion", () => {
  const holdings = [stock({ weight: 0.5 }), stock({ ticker: "AAPL", currency: "USD", weight: 0.5 })];
  const ds = dates.slice(0, 3), input = [data([100, 100, 100], ds), data([100, 100, 100], ds)];
  const fx = prices([1000, 1100, 1200], ds);
  const krw = analyzePortfolio(holdings, input, fx, options, dates[3]);
  close(krw.nav[1].value, 105); close(krw.nav[2].value, 110); assert.equal(krw.portfolio.fxApplied, true);
  const usd = analyzePortfolio(holdings, input, fx, { ...options, baseCurrency: "USD" }, dates[3]);
  close(usd.nav[2].value, 50 + 50 / 1.2);
  const missing = analyzePortfolio(holdings, input, null, options, dates[3]);
  assert.equal(missing.portfolio.historicalCAGR, null); assert.ok(missing.warnings.some(w => w.type === "FX_UNAVAILABLE"));
});
test("8: new listing constrains common analysis period; no backfill", () => {
  const holdings = [stock({ weight: 0.5 }), stock({ ticker: "NEW", weight: 0.5, assetType: "etf" })];
  const result = analyzePortfolio(holdings, [data([100, 110, 99, 120]), data([50, 51, 52], dates.slice(1))], null, options, dates[3]);
  assert.equal(result.portfolio.analysisPeriod?.start, dates[1]);
  assert.ok(result.warnings.some(w => w.type === "INSUFFICIENT_HISTORY" && w.ticker === "NEW"));
});
test("9: invalid prices and fundamental values never escape as NaN/Infinity", () => {
  const bad = [{ date: dates[0], close: NaN }, { date: dates[1], close: Infinity }, { date: dates[2], close: null as unknown as number }, { date: dates[3], close: undefined as unknown as number }];
  const result = analyzePortfolio([stock()], [{ prices: bad, source: [], fundamentals: { forwardEPS: NaN, dividendYield: Infinity } }], null, options, dates[3]);
  assert.equal(result.portfolio.historicalCAGR, null); assert.equal(result.portfolio.expectedReturn, null);
  const visit = (v: unknown) => { if (typeof v === "number") assert.ok(Number.isFinite(v)); else if (v && typeof v === "object") Object.values(v).forEach(visit); };
  visit(result); assert.deepEqual(cleanPrices(bad), []);
});
test("calendar rebalance resets weights; none remains buy-and-hold", () => {
  const ds = ["2025-01-02", "2025-03-31", "2025-04-01"], rows = [[100, 100], [200, 100], [100, 100]];
  close(portfolioNav(ds, rows, [0.5, 0.5], "none")[2].value, 100);
  close(portfolioNav(ds, rows, [0.5, 0.5], "quarterly")[2].value, 112.5);
  assert.equal(shouldRebalance("2025-01-31", "2025-02-03", "monthly"), true);
  assert.equal(shouldRebalance("2025-03-31", "2025-04-01", "semiannual"), false);
  assert.equal(shouldRebalance("2025-06-30", "2025-07-01", "semiannual"), true);
  assert.equal(shouldRebalance("2025-12-31", "2026-01-02", "annual"), true);
});
test("fundamental model, simplified assumptions and bond yield priority", () => {
  const d: MarketData = { prices: [], source: ["fixture"], fundamentals: { currentPrice: 100, forwardEPS: 5, expectedEPSGrowth: 0.1, targetPE: 20, dividendYield: 0.02 } };
  const fundamental = expectedReturn(stock(), d, dates[0]); close(fundamental.value, 0.12); assert.equal(fundamental.method, "fundamental");
  const simplified = expectedReturn(stock(), { ...d, fundamentals: { currentPrice: 100, forwardEPS: 5, currentForwardPE: 20 } }, dates[0]);
  assert.equal(simplified.method, "simplified_fundamental"); assert.ok(simplified.assumptions.some(a => a.includes("성장률 0%")));
  const bond = stock({ assetType: "etf", subType: "bond" });
  close(expectedReturn(bond, { ...d, fundamentals: { yieldToMaturity: 0.05, expenseRatio: 0.002, distributionYield: 0.04 } }, dates[0]).value, 0.048);
  assert.equal(expectedReturn(bond, { ...d, fundamentals: { distributionYield: 0.04 } }, dates[0]).method, "distribution_yield");
  assert.equal(expectedReturn(stock({ assetType: "etf", subType: "commodity" }), d, dates[0]).method, "insufficient_evidence");
});
test("long historical fallback requires at least a year; historical fund return not fee-deducted twice", () => {
  const ds = Array.from({ length: 366 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));
  const item = { ...data(ds.map((_, i) => 100 * 1.1 ** (i / 365.25)), ds), fundamentals: { expenseRatio: 0.01 } };
  const estimate = expectedReturn(stock({ assetType: "etf" }), item, dates[0]);
  assert.equal(estimate.method, "historical_cagr_fallback"); close(estimate.value, 0.1);
});
test("one unsupported holding blocks aggregate expectation without excluding it from historical NAV", () => {
  const holdings = [stock({ weight: 0.8 }), stock({ ticker: "NEW", weight: 0.2 })];
  const input = [
    { ...data([100, 110, 105, 120]), fundamentals: { currentPrice: 100, forwardEPS: 5, expectedEPSGrowth: 0.1, targetPE: 20, dividendYield: 0.02 } },
    data([100, 100, 100, 100]),
  ];
  const result = analyzePortfolio(holdings, input, null, options, dates[3]);
  assert.equal(result.portfolio.expectedReturn, null);
  close(result.portfolio.expectedReturnCoverage, 0.8);
  close(result.holdings[0].contributionToExpectedReturn, 0.096);
  assert.equal(result.holdings[1].contributionToExpectedReturn, null);
  close(result.nav.at(-1)!.value, 116);
  assert.notEqual(result.portfolio.historicalCAGR, null);
  const warnings = result.warnings.filter(w => w.type === "EXPECTED_RETURN_UNAVAILABLE");
  assert.equal(warnings.length, 1); assert.equal(warnings[0].ticker, "NEW");
  const resolved = analyzePortfolio([stock()], [input[0]], null, options, dates[3]);
  close(resolved.portfolio.expectedReturn, 0.12);
  close(resolved.portfolio.expectedReturnCoverage, 1);
  assert.equal(resolved.warnings.some(w => w.type === "EXPECTED_RETURN_UNAVAILABLE"), false);
});
test("common dates omit unknown missing dates and long data gaps suppress risk", () => {
  const h = [stock({ weight: 0.5 }), stock({ ticker: "OTHER", weight: 0.5 })];
  const result = analyzePortfolio(h, [data([100, 101, 102, 103]), data([100, 102, 103], [dates[0], dates[2], dates[3]])], null, options, dates[3]);
  assert.ok(result.warnings.some(w => w.type === "COMMON_DATES_ONLY"));
  const sparse = analyzePortfolio([stock()], [data([100, 101, 102], ["2024-01-01", "2024-06-01", "2025-01-01"])], null, options, dates[3]);
  assert.equal(sparse.portfolio.mdd, null); assert.equal(sparse.portfolio.annualizedVolatility, null);
  const holiday = analyzePortfolio([stock()], [data([100, 99, 101], ["2025-01-01", "2025-01-13", "2025-01-14"])], null, options, "2025-01-15");
  close(holiday.portfolio.mdd, -0.01);
});
test("sample standard deviation annualizes portfolio daily returns", () => {
  close(annualizedVolatility([0.1, -0.1]), Math.sqrt(0.02) * Math.sqrt(252));
  assert.equal(annualizedVolatility([0.1]), null);
});
test("provider parsing uses adjusted prices consistently and does not coerce nulls", () => {
  const parsed = parseYahooHistory({ chart: { result: [{ timestamp: [1735776000, 1735862400, 1736121600], indicators: { quote: [{ close: [100, 101, 102] }], adjclose: [{ adjclose: [50, null, 51] }] } }] } });
  assert.deepEqual(parsed.prices.map(p => p.close), [50, 51]);
  const naver = parseNaverHistory([{ localDate: "20250102", closePrice: "1,000" }, { localDate: "20250103", closePrice: null }]);
  assert.equal(naver.prices.length, 1); assert.equal(naver.prices[0].close, 1000);
  const fundamentals = parseFundamentals({ quoteSummary: { result: [{ defaultKeyStatistics: { forwardEps: { raw: 4 }, earningsQuarterlyGrowth: { raw: 0.9 } }, summaryDetail: { dividendYield: null } }] } });
  assert.equal(fundamentals.forwardEPS, 4); assert.equal(fundamentals.expectedEPSGrowth, undefined); assert.equal(fundamentals.dividendYield, undefined);
});
test("selection converts nested percentage weights and uses listing currency", () => {
  const result = selectionToHoldings({ globalEquity: 80, cash: 20 }, [{ symbol: "379800", name: "KODEX 미국S&P500", currency: "KRW", kind: "ETF", assetClass: "globalEquity", weightWithinClass: 100 }]);
  close(result[0].weight, 0.8); assert.equal(result[0].currency, "KRW"); close(result[1].weight, 0.2);
  assert.throws(() => selectionToHoldings({ globalEquity: 100 }, [{ symbol: "ABC", name: "ABC", currency: "EUR", kind: "stock", assetClass: "globalEquity", weightWithinClass: 100 }]));
});
test("service handles provider failures and validates before network calls", async () => {
  let calls = 0;
  const provider = { holding: async () => { calls++; throw new Error("offline"); }, usdKrw: async () => { throw new Error("offline"); } };
  await assert.rejects(() => portfolioAnalytics([stock({ weight: 0.5 })], options, provider)); assert.equal(calls, 0);
  const result = await portfolioAnalytics([stock()], options, provider);
  assert.equal(result.portfolio.historicalCAGR, null); assert.ok(result.warnings.some(w => w.type === "DATA_UNAVAILABLE"));
});
