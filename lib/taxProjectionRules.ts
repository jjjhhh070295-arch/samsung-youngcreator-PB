import type { PortfolioOption } from "@/lib/portfolio";

export const WITHHOLDING_TAX_RATE_PCT = 15.4;
export const DOMESTIC_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT = 22;
export const LARGE_SHAREHOLDER_CAPITAL_GAIN_TAX_RATE_PCT = 27.5;
export const OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT = 22;
export const FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON = 20_000_000;
export const DEFAULT_FEE_RATE_PCT = 0.15;
export const DEFAULT_HORIZON_YEARS = 1;

export const ASSET_PRETAX_RETURN_PCT: Record<keyof PortfolioOption["weights"], number> = {
  etf: 12,
  bond: 4.5,
  els: 5.2,
  mmf: 3.5,
  gold: 5,
  dollar: 2,
  raw: 4,
};

export const TAXABLE_RETURN_SPLIT: Record<
  keyof PortfolioOption["weights"],
  {
    interest: number;
    dividend: number;
    capitalGain: number;
  }
> = {
  mmf: { interest: 1, dividend: 0, capitalGain: 0 },
  bond: { interest: 1, dividend: 0, capitalGain: 0 },
  etf: { interest: 0, dividend: 0.3, capitalGain: 0.7 },
  gold: { interest: 0, dividend: 0, capitalGain: 1 },
  dollar: { interest: 0, dividend: 0, capitalGain: 1 },
  raw: { interest: 0, dividend: 0, capitalGain: 1 },
  els: { interest: 0.7, dividend: 0, capitalGain: 0.3 },
};

export function corporateTaxRateForTaxableIncome(taxableIncomeWon: number): number {
  if (taxableIncomeWon <= 200_000_000) return 9;
  if (taxableIncomeWon <= 20_000_000_000) return 19;
  if (taxableIncomeWon <= 300_000_000_000) return 21;
  return 24;
}

export const TAX_PROJECTION_ASSUMPTIONS = [
  `이자·배당 원천징수 ${WITHHOLDING_TAX_RATE_PCT}%`,
  `금융소득종합과세 간이: 기존+예상 금융소득 ${FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON.toLocaleString("ko-KR")}원 초과분에 한계세율과 원천징수율 차이 적용`,
  `국내주식 양도 ${DOMESTIC_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT}%, 대주주 플래그 시 ${LARGE_SHAREHOLDER_CAPITAL_GAIN_TAX_RATE_PCT}%`,
  `해외주식 양도 ${OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT}%`,
  `수수료·보수 기본 연 ${DEFAULT_FEE_RATE_PCT}%`,
  "상담용 추정 모델이며 세무 신고·납부 확정 금액이 아닙니다.",
];
