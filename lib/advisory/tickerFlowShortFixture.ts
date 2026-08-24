import { MOMENTUM_DEMO_SYMBOLS, type MomentumDemoSymbol } from "./tickerMomentumFixture";
import {
  calculateRatioPctDeterministic,
  finalDatum,
  missingDatum,
  provisionalDatum,
  type FlowShortMetadata,
  type InstitutionCategory,
  type InvestorFlowDay,
  type TickerFlowShortDataset,
} from "./tickerFlowShort";

export const FLOW_SHORT_DEMO_SYMBOLS = MOMENTUM_DEMO_SYMBOLS;
export type FlowShortDemoSymbol = MomentumDemoSymbol;

export const FLOW_SHORT_FIXTURE_AS_OF = "2026-08-21";
export const FLOW_SHORT_FIXTURE_PUBLICATION_DATE = "2026-08-22";
export const FLOW_SHORT_FIXED_TRADING_DATES = [
  "2026-07-24",
  "2026-07-27",
  "2026-07-28",
  "2026-07-29",
  "2026-07-30",
  "2026-07-31",
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
] as const;

const FIXTURE_VERSION = "2026-08-23.v1";
const FIXTURE_SOURCE = "local-fixture:ticker-flow-short-education";

function metricProvenance(metric: "short-sale-trading" | "reportable-net-short-position" | "securities-lending") {
  return {
    source: `${FIXTURE_SOURCE}:${metric}`,
    publicationDate: FLOW_SHORT_FIXTURE_PUBLICATION_DATE,
    publicationStatus: "not_applicable" as const,
    freshness: "fixture" as const,
  };
}

const DISPLAY_NAMES: Record<FlowShortDemoSymbol, string> = {
  "DEMO-HIGH": "가상 모멘텀 A (데모 신고가)",
  "DEMO-NEAR": "가상 모멘텀 B (데모 근접)",
  "DEMO-SHORT": "가상 모멘텀 C (데모 신규상장)",
};

const ALIASES: Record<string, FlowShortDemoSymbol> = {
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

interface ScenarioConfig {
  turnoverBaseKrw: number;
  individualBaseKrw: number;
  foreignBaseKrw: number;
  institutionBaseKrw: number;
  listedShares: number;
  shortSaleBasisPoints: number;
  reportableNetShortQuantity: number | null;
  lendingOutstandingQuantity: number;
}

const SCENARIOS: Record<FlowShortDemoSymbol, ScenarioConfig> = {
  "DEMO-HIGH": {
    turnoverBaseKrw: 25_000_000_000,
    individualBaseKrw: -420_000_000,
    foreignBaseKrw: 610_000_000,
    institutionBaseKrw: 180_000_000,
    listedShares: 120_000_000,
    shortSaleBasisPoints: 375,
    reportableNetShortQuantity: 850_000,
    lendingOutstandingQuantity: 2_400_000,
  },
  "DEMO-NEAR": {
    turnoverBaseKrw: 18_000_000_000,
    individualBaseKrw: 260_000_000,
    foreignBaseKrw: -170_000_000,
    institutionBaseKrw: -75_000_000,
    listedShares: 95_000_000,
    shortSaleBasisPoints: 520,
    reportableNetShortQuantity: null,
    lendingOutstandingQuantity: 1_650_000,
  },
  "DEMO-SHORT": {
    turnoverBaseKrw: 9_000_000_000,
    individualBaseKrw: -55_000_000,
    foreignBaseKrw: 84_000_000,
    institutionBaseKrw: -18_000_000,
    listedShares: 80_000_000,
    shortSaleBasisPoints: 260,
    reportableNetShortQuantity: 250_000,
    lendingOutstandingQuantity: 920_000,
  },
};

function metadataFor(symbol: FlowShortDemoSymbol): FlowShortMetadata {
  return {
    datasetId: `ticker-flow-short-${symbol.toLowerCase()}`,
    version: FIXTURE_VERSION,
    label: "교육용 데모 데이터",
    dataMode: "demo",
    approvalStatus: "not_applicable",
    asOfTradeDate: FLOW_SHORT_FIXTURE_AS_OF,
    publicationDate: FLOW_SHORT_FIXTURE_PUBLICATION_DATE,
    source: FIXTURE_SOURCE,
    sourceUrl: null,
    publicationStatus: "not_applicable",
    freshness: "fixture",
  };
}

function splitInstitutionTotal(total: number) {
  const securities = Math.trunc(total * 0.45);
  const investmentTrust = Math.trunc(total * 0.3);
  const privateFund = total - securities - investmentTrust;
  return {
    securities: finalDatum(securities),
    investment_trust: finalDatum(investmentTrust),
    private_fund: finalDatum(privateFund),
  } satisfies Partial<Record<InstitutionCategory, ReturnType<typeof finalDatum>>>;
}

function investorFlowsFor(symbol: FlowShortDemoSymbol): InvestorFlowDay[] {
  const config = SCENARIOS[symbol];
  return FLOW_SHORT_FIXED_TRADING_DATES.map((tradeDate, index) => {
    const turnover = config.turnoverBaseKrw + (index % 5) * 730_000_000 + index * 65_000_000;
    const individual = config.individualBaseKrw + ((index % 4) - 1) * 42_000_000;
    const foreign = config.foreignBaseKrw + ((index % 5) - 2) * 55_000_000;
    const institution = config.institutionBaseKrw + ((index % 3) - 1) * 31_000_000;
    return {
      kind: "investor-flow",
      tradeDate,
      totalTradingValueKrw: finalDatum(turnover),
      individualNetBuyKrw: finalDatum(individual),
      foreignNetBuyKrw: finalDatum(foreign),
      institution: {
        totalNetBuyKrw: finalDatum(institution),
        breakdownNetBuyKrw: splitInstitutionTotal(institution),
        aggregation: {
          mode: "source-total",
          includedChildren: [],
          exhaustive: false,
          mutuallyExclusive: false,
        },
      },
    };
  });
}

function datasetFor(symbol: FlowShortDemoSymbol): TickerFlowShortDataset {
  const config = SCENARIOS[symbol];
  const investorFlows = investorFlowsFor(symbol);
  const lastTurnover = investorFlows.at(-1)!.totalTradingValueKrw.value!;
  const shortSaleValue = Math.trunc(lastTurnover * config.shortSaleBasisPoints / 10_000);
  const shortSaleStatus = symbol === "DEMO-SHORT" ? provisionalDatum : finalDatum;
  const reportableQuantity = config.reportableNetShortQuantity == null
    ? missingDatum("신고·공시 기준 자료가 제공되지 않은 교육용 누락 상태입니다.")
    : finalDatum(config.reportableNetShortQuantity);
  const reportableRatio = config.reportableNetShortQuantity == null
    ? missingDatum("신고·공시 기준 원천 비율이 없는 교육용 누락 상태입니다.")
    : finalDatum(calculateRatioPctDeterministic(config.reportableNetShortQuantity, config.listedShares)!);
  const matchedQuantity = Math.trunc(config.lendingOutstandingQuantity * 0.18);
  const returnedQuantity = Math.trunc(config.lendingOutstandingQuantity * 0.11);

  return {
    symbol,
    displayName: DISPLAY_NAMES[symbol],
    metadata: metadataFor(symbol),
    tradingCalendar: [...FLOW_SHORT_FIXED_TRADING_DATES],
    investorFlows,
    shortSaleTrading: {
      ...metricProvenance("short-sale-trading"),
      kind: "short-sale-trading",
      tradeDate: FLOW_SHORT_FIXTURE_AS_OF,
      shortSaleTradingValueKrw: shortSaleStatus(shortSaleValue),
      totalTradingValueKrw: shortSaleStatus(lastTurnover),
      sourceReportedRatioPct: shortSaleStatus(
        calculateRatioPctDeterministic(shortSaleValue, lastTurnover)!,
      ),
    },
    reportableNetShortPosition: {
      ...metricProvenance("reportable-net-short-position"),
      kind: "reportable-net-short-position",
      referenceDate: FLOW_SHORT_FIXTURE_AS_OF,
      netShortPositionQuantity: reportableQuantity,
      denominator: {
        kind: "listed-shares",
        referenceDate: FLOW_SHORT_FIXTURE_AS_OF,
        quantity: finalDatum(config.listedShares),
      },
      sourceReportedRatioPct: reportableRatio,
      coverageScope: "reportable-positions-only",
    },
    securitiesLending: {
      ...metricProvenance("securities-lending"),
      kind: "securities-lending",
      referenceDate: FLOW_SHORT_FIXTURE_AS_OF,
      matchedQuantity: finalDatum(matchedQuantity),
      returnedQuantity: finalDatum(returnedQuantity),
      outstandingQuantity: finalDatum(config.lendingOutstandingQuantity),
      outstandingValueKrw: finalDatum(config.lendingOutstandingQuantity * 12_500),
      denominator: {
        kind: "listed-shares",
        referenceDate: FLOW_SHORT_FIXTURE_AS_OF,
        quantity: finalDatum(config.listedShares),
      },
    },
  };
}

const FIXTURES: Record<FlowShortDemoSymbol, TickerFlowShortDataset> = {
  "DEMO-HIGH": datasetFor("DEMO-HIGH"),
  "DEMO-NEAR": datasetFor("DEMO-NEAR"),
  "DEMO-SHORT": datasetFor("DEMO-SHORT"),
};

export function resolveFlowShortDemoSymbol(raw: string): FlowShortDemoSymbol | null {
  return ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function getTickerFlowShortDemoDataset(symbol: FlowShortDemoSymbol): TickerFlowShortDataset {
  return JSON.parse(JSON.stringify(FIXTURES[symbol])) as TickerFlowShortDataset;
}
