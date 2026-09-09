export const PERIODS = [1, 3, 5, 10] as const;
export const REBALANCES = ["none", "monthly", "quarterly", "semiannual", "annual"] as const;
export type Period = typeof PERIODS[number];
export type Rebalance = typeof REBALANCES[number];
export type Currency = "KRW" | "USD";
export type AssetType = "stock" | "etf" | "other" | "cash";
export type SubType = "equity" | "bond" | "dividend" | "commodity" | "cash";

export interface BondEtfMetricOverride {
  /** Percentage points. 5.2 means 5.2%. */
  ytmPct: number | null;
  effectiveDurationYears: number | null;
  spreadDurationYears: number | null;
  /** Percentage points. 0.14 means 0.14%. */
  expenseRatioPct: number | null;
  secYieldPct?: number | null;
  distributionYieldPct?: number | null;
  asOf: string;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface BondEtfScenarioSettings {
  /** Basis points. +100 means market yields rise by 1%p. */
  rateChangeBp: number;
  /** Basis points. +100 means credit spreads widen by 1%p. */
  spreadChangeBp: number;
  allowMissingSpreadDuration: boolean;
  overridesBySymbol: Record<string, BondEtfMetricOverride>;
}

export interface BondEtfHoldingScenario {
  rateChangeBp: number;
  spreadChangeBp: number;
  allowMissingSpreadDuration: boolean;
  override?: BondEtfMetricOverride;
}

export interface Holding {
  ticker: string; name: string; weight: number; currency: Currency;
  assetType: AssetType; subType: SubType;
  bondEtfScenario?: BondEtfHoldingScenario;
}
export interface Options { years: Period; rebalance: Rebalance; baseCurrency: Currency }
export interface Price { date: string; close: number }
export interface Fundamentals {
  currentPrice?: number; forwardEPS?: number; expectedEPSGrowth?: number;
  currentForwardPE?: number; targetPE?: number; dividendYield?: number;
  yieldToMaturity?: number; secYield?: number; distributionYield?: number;
  expenseRatio?: number; duration?: number; spreadDuration?: number;
  factsAsOf?: string; factsSourceLabel?: string; factsSourceUrl?: string;
}
export interface MarketData { prices: Price[]; source: string[]; fundamentals?: Fundamentals; warnings?: Warning[] }
export interface Warning { type: string; ticker?: string; message: string }
export interface ExpectedReturn {
  value: number | null; method: string; confidence: "low" | "medium";
  source: string[]; calculationDate: string; assumptions: string[];
  bondScenario?: {
    status: "ok" | "unavailable" | "partial";
    ytm: number | null;
    expenseRatio: number | null;
    effectiveDuration: number | null;
    spreadDuration: number | null;
    rateChangeBp: number;
    spreadChangeBp: number;
    carryRoll: number | null;
    expenseDrag: number | null;
    ratePriceEffect: number | null;
    spreadPriceEffect: number | null;
    factsAsOf: string | null;
    factsSourceLabel: string | null;
    factsSourceUrl: string | null;
    sourceKind: "official" | "pb_override";
  };
}
export interface Drawdown { mdd: number; peakDate: string; troughDate: string; recoveryDate: string | null; recoveryDays: number | null }
export interface AnalyticsResult {
  portfolio: {
    expectedReturn: number | null; expectedReturnCoverage: number; historicalCAGR: number | null; mdd: number | null;
    annualizedVolatility: number | null;
    analysisPeriod: { start: string; end: string; years: number } | null;
    baseCurrency: Currency; fxApplied: boolean; rebalance: Rebalance;
  };
  drawdown: Drawdown | null;
  holdings: Array<Holding & { expectedReturn: ExpectedReturn; contributionToExpectedReturn: number | null }>;
  warnings: Warning[];
  nav: Array<{ date: string; value: number }>;
}
