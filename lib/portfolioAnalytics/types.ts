export const PERIODS = [1, 3, 5, 10] as const;
export const REBALANCES = ["none", "monthly", "quarterly", "semiannual", "annual"] as const;
export type Period = typeof PERIODS[number];
export type Rebalance = typeof REBALANCES[number];
export type Currency = "KRW" | "USD";
export type AssetType = "stock" | "etf" | "other" | "cash";
export type SubType = "equity" | "bond" | "dividend" | "commodity" | "cash";
export interface Holding {
  ticker: string; name: string; weight: number; currency: Currency;
  assetType: AssetType; subType: SubType;
}
export interface Options { years: Period; rebalance: Rebalance; baseCurrency: Currency }
export interface Price { date: string; close: number }
export interface Fundamentals {
  currentPrice?: number; forwardEPS?: number; expectedEPSGrowth?: number;
  currentForwardPE?: number; targetPE?: number; dividendYield?: number;
  yieldToMaturity?: number; secYield?: number; distributionYield?: number;
  expenseRatio?: number; duration?: number;
}
export interface MarketData { prices: Price[]; source: string[]; fundamentals?: Fundamentals; warnings?: Warning[] }
export interface Warning { type: string; ticker?: string; message: string }
export interface ExpectedReturn {
  value: number; method: string; confidence: "low" | "medium";
  source: string[]; calculationDate: string; assumptions: string[];
}
export interface Drawdown { mdd: number; peakDate: string; troughDate: string; recoveryDate: string | null; recoveryDays: number | null }
export interface AnalyticsResult {
  portfolio: {
    expectedReturn: number; historicalCAGR: number | null; mdd: number | null;
    annualizedVolatility: number | null;
    analysisPeriod: { start: string; end: string; years: number } | null;
    baseCurrency: Currency; fxApplied: boolean; rebalance: Rebalance;
  };
  drawdown: Drawdown | null;
  holdings: Array<Holding & { expectedReturn: ExpectedReturn; contributionToExpectedReturn: number }>;
  warnings: Warning[];
  nav: Array<{ date: string; value: number }>;
}
