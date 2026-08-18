import type { Client } from "../types";
import { calculateSimulatedMetrics, buildPortfolioViewModel } from "../portfolio";
import { mergeTaxProfile, projectTax } from "../taxProjection";
import { DEFAULT_HORIZON_YEARS } from "../taxProjectionRules";
import { ENGINE_ASSUMPTION, ENGINE_CURRENCY, ENGINE_SOURCE } from "./constants";
import { defaultCalcConfig } from "./control";
import { sha256HexSync, stableStringify } from "./hash";
import { buildRiskMetrics, measured } from "./riskEngine";
import { runStressScenarios } from "./stressScenarios";
import type { CalcResults, CitationRef, TaxWaterfall } from "./types";

const ENGINE_CITATIONS: CitationRef[] = [
  {
    sourceId: "eng-risk-parametric",
    title: "파라메트릭 VaR/CVaR · Sharpe (결정론 엔진)",
    asOf: "engine",
    chunkId: "risk-engine-v1",
  },
  {
    sourceId: "eng-tax-waterfall",
    title: "세전·세금·비용·세후 워터폴 (결정론 엔진)",
    asOf: "engine",
    chunkId: "tax-projection-v1",
  },
  {
    sourceId: "eng-stress-scenarios",
    title: "금리/주식/환율/공실/매출 스트레스 시나리오",
    asOf: "engine",
    chunkId: "stress-scenarios-v1",
  },
];

function asOfNow() {
  return new Date().toISOString();
}

export function buildEngineSnapshot(client: Client, asOf = asOfNow()) {
  const vm = buildPortfolioViewModel(client);
  const confirmedId = client.portfolios[0]?.id;
  const option =
    vm.portfolioOptions.find((item) => item.id === confirmedId) ?? vm.portfolioOptions[1] ?? vm.portfolioOptions[0];
  const weights = option?.weights ?? {
    etf: 30,
    bond: 25,
    els: 0,
    mmf: 30,
    gold: 10,
    dollar: 5,
    raw: 0,
  };

  const pf = client.portfolios[0];
  const metrics = calculateSimulatedMetrics(weights);
  const expectedReturnPct = pf?.expectedReturn ?? metrics.expectedReturn;
  const volatilityPct = pf?.expectedRisk ?? metrics.volatility;
  const mddPct = metrics.mdd;
  const principalWon = client.assetSize || 0;

  const risk = buildRiskMetrics({
    expectedReturnPct,
    volatilityPct,
    mddPct,
    asOf,
    source: ENGINE_SOURCE,
  });
  const stress = runStressScenarios({
    weights,
    principalWon,
    asOf,
    clientType: client.clientType,
  });

  const merged = mergeTaxProfile(client);
  const tax = projectTax({
    principalWon,
    horizonYears: DEFAULT_HORIZON_YEARS,
    weights,
    expectedReturnPct,
    taxProfile: merged.profile,
    cashFlows: client.cashFlows,
    cashflowTaxSummary: merged.cashflowSummary,
    label: pf?.label ?? "기준안",
  });

  const pretaxEnding = tax.principalWon + tax.grossReturnWon;
  const waterfall: TaxWaterfall = {
    pretaxEnding: measured(pretaxEnding, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
    expectedTax: measured(tax.taxes.totalTaxWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
    productCost: measured(tax.feesWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
    afterTaxEnding: measured(tax.netEndingWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
  };

  const calcConfig = defaultCalcConfig();
  const calcResults: CalcResults = { risk, stress, waterfall };

  const citations: CitationRef[] = ENGINE_CITATIONS.map((c) => ({ ...c, asOf: asOf.slice(0, 10) }));

  const inputPayload = {
    clientId: client.id,
    notes: client.consultationNotes,
    ips: client.ips,
    cashFlows: client.cashFlows,
    portfolios: client.portfolios,
    assetSize: client.assetSize,
    clientType: client.clientType,
  };
  const inputHash = sha256HexSync(stableStringify(inputPayload));
  const settingsHash = sha256HexSync(stableStringify(calcConfig));
  const resultHash = sha256HexSync(stableStringify(calcResults));

  return {
    consultationInput: client.consultationNotes || "",
    ipsExtract: client.ips,
    calcConfig,
    calcResults,
    citations,
    inputHash,
    settingsHash,
    resultHash,
  };
}
