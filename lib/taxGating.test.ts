import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractWithholdingSlipAmounts, withholdingExtractSucceeded } from "./withholdingSlipParse";
import {
  isFinancialIncomeReadyForTax,
  financialIncomeBlockReason,
} from "./financialIncome";
import { emptyIPS } from "./types";
import type { Client } from "./types";

function clientBase(overrides: Partial<Client> = {}): Client {
  return {
    id: "c1",
    code: "C-1",
    clientType: "individual",
    name: "테스트",
    birthDate: "1980-01-01",
    assignedPbId: "PB-001",
    assetSize: 2_000_000_000,
    consultationNotes: "",
    ips: emptyIPS(),
    cashFlows: [],
    portfolios: [],
    stages: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    financialIncomeComprehensiveTax: false,
    ...overrides,
  };
}

describe("withholdingSlipParse", () => {
  it("이자·배당 라벨 금액을 추출한다", () => {
    const text = "원천징수영수증\n이자소득 12,000,000원\n배당소득 8,500,000원";
    const extract = extractWithholdingSlipAmounts(text);
    assert.equal(extract.interestIncomeWon, 12_000_000);
    assert.equal(extract.dividendIncomeWon, 8_500_000);
    assert.equal(withholdingExtractSucceeded(extract), true);
  });

  it("금액이 없으면 실패로 본다", () => {
    const extract = extractWithholdingSlipAmounts("영수증 샘플");
    assert.equal(withholdingExtractSucceeded(extract), false);
  });
});

describe("financialIncome readiness", () => {
  it("종합과세 아니오이면 바로 준비 완료", () => {
    assert.equal(isFinancialIncomeReadyForTax(clientBase()), true);
  });

  it("종합과세 예인데 미첨부면 차단", () => {
    const client = clientBase({ financialIncomeComprehensiveTax: true });
    assert.equal(isFinancialIncomeReadyForTax(client), false);
    assert.match(financialIncomeBlockReason(client), /원천징수|수동/);
  });

  it("수동 입력이 있으면 계산 가능", () => {
    const client = clientBase({
      financialIncomeComprehensiveTax: true,
      financialIncomeProfile: {
        interestIncomeWon: 15_000_000,
        dividendIncomeWon: 6_000_000,
        parseStatus: "manual",
      },
    });
    assert.equal(isFinancialIncomeReadyForTax(client), true);
  });
});

describe("taxProjection overseas split", () => {
  it("해외주식 양도세를 종합과세와 분리한다 (preview 경로)", async () => {
    const { buildPreviewFromApprovedPortfolio, defaultTaxContextFromClient, projectPortfolioPreviewTax } =
      await import("./tax/portfolioPreviewTax");
    const client = clientBase({
      financialIncomeComprehensiveTax: true,
      financialIncomeProfile: {
        interestIncomeWon: 25_000_000,
        dividendIncomeWon: 0,
        parseStatus: "manual",
        confirmedNonFinancialTaxableBaseWon: 40_000_000,
        expectedWageGrossWon: 50_000_000,
        employmentIncomeDeductionWon: 10_000_000,
      },
      portfolios: [
        {
          id: "p1",
          label: "t",
          allocations: [{ assetClass: "해외주식", weight: 100 }],
          instruments: [
            {
              symbol: "AAPL",
              name: "Apple",
              assetClassKey: "globalEquity",
              assetClassLabel: "해외주식",
              currency: "USD",
              weightWithinClass: 100,
              totalWeightPct: 100,
              allocationAmountWon: 100_000_000,
              quantity: 1,
              priceSnapshot: 1,
              bookkeepingNote: "장부",
            },
          ],
          metricsStatus: "ok",
          expectedReturn: 10,
          expectedRisk: 15,
          taxNote: "",
          rationale: "",
          editedByPb: true,
        },
      ],
    });
    const preview = buildPreviewFromApprovedPortfolio({
      client,
      portfolio: client.portfolios[0],
      returnAssumptions: new Map([["AAPL", { priceReturnPct: 10, dividendYieldPct: 0 }]]),
    })!;
    const result = projectPortfolioPreviewTax({
      preview,
      taxContext: defaultTaxContextFromClient(client),
      assumeForeignShareSaleAfterHorizon: true,
    });
    assert.ok((result.taxes.foreignStockCgtWon ?? 0) > 0);
    assert.ok((result.taxes.comprehensiveExtraWon ?? 0) >= 0);
    assert.equal(result.taxes.domesticListedShareCgtWon, 0);
  });
});
