import type { Client } from "../types";
import { calculateSimulatedMetrics, buildPortfolioViewModel } from "../portfolio";
import { mergeTaxProfile, projectTax } from "../taxProjection";
import { DEFAULT_HORIZON_YEARS } from "../taxProjectionRules";
import { ENGINE_ASSUMPTION, ENGINE_CURRENCY, ENGINE_SOURCE } from "./constants";
import { defaultCalcConfig } from "./control";
import { sha256HexSync, stableStringify } from "./hash";
import { advisoryInputHash, type AdvisoryInputContext } from "./integrity";
import { buildRiskMetrics, measured } from "./riskEngine";
import { runStressScenarios } from "./stressScenarios";
import type { CalcResults, CitationRef, TaxWaterfall } from "./types";
import { isPortfolioWorkflowApproved } from "./workflowApprovals";
import { isFinancialIncomeReadyForTax } from "../financialIncome";

const ENGINE_CITATIONS: CitationRef[] = [
  {
    sourceId: "eng-risk-parametric",
    title: "파라메트릭 VaR/CVaR · Sharpe 계산 기준",
    asOf: "engine",
    chunkId: "risk-engine-v1",
  },
  {
    sourceId: "eng-tax-waterfall",
    title: "세전·세금·비용·세후 계산 기준",
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

export function buildEngineSnapshot(
  client: Client,
  inputContext: AdvisoryInputContext = {},
  asOf = asOfNow(),
  /** 부동산 제외 투자가능자산. 없으면 총자산으로 폴백(기존 동작). */
  investableWon?: number,
) {
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
  // 스트레스·세금 원금은 실제로 운용되는 자산이어야 한다 — 부동산은 시나리오 하락률을
  // 그대로 맞지도, 금융소득세를 내지도 않는다. 값이 없으면 기존대로 총자산으로 폴백.
  const principalWon = investableWon ?? (client.assetSize || 0);

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
  const taxReady = isPortfolioWorkflowApproved(client) && isFinancialIncomeReadyForTax(client);
  let waterfall: TaxWaterfall | null = null;
  if (taxReady) {
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
    waterfall = {
      pretaxEnding: measured(pretaxEnding, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
      expectedTax: measured(tax.taxes.totalTaxWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
      productCost: measured(tax.feesWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
      afterTaxEnding: measured(tax.netEndingWon, "KRW", asOf, ENGINE_SOURCE, ENGINE_ASSUMPTION, ENGINE_CURRENCY),
    };
  }

  const calcConfig = defaultCalcConfig();
  const calcResults: CalcResults = { risk, stress, waterfall };

  const citations: CitationRef[] = ENGINE_CITATIONS.map((c) => ({ ...c, asOf: asOf.slice(0, 10) }));

  const inputHash = advisoryInputHash(client, inputContext);
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
