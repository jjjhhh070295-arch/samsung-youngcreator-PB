/**
 * 레거시 SET 버킷 규칙 — 신규 경로는 lib/tax/portfolioPreviewTax.ts 를 사용한다.
 * 아래 국내양도 22%·고정 0.15% 수수료·30/70 분할은 신규 산출에 쓰지 않는다.
 */

import type { PortfolioOption } from "@/lib/portfolio";
import {
  FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON as THRESHOLD,
  INTEREST_WITHHOLDING_COMBINED_RATE,
} from "@/lib/tax/koreanResidentTax2026";

export const WITHHOLDING_TAX_RATE_PCT = INTEREST_WITHHOLDING_COMBINED_RATE * 100;
/** @deprecated 일반 국내상장 장내 매도는 0 — portfolioPreviewTax 사용 */
export const DOMESTIC_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT = 0;
export const LARGE_SHAREHOLDER_CAPITAL_GAIN_TAX_RATE_PCT = 27.5;
export const OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT = 22;
export const FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON = THRESHOLD;
/** @deprecated 일괄 수수료 금지 — 종목별 명시 비용만 */
export const DEFAULT_FEE_RATE_PCT = 0;
export const DEFAULT_HORIZON_YEARS = 1;
export const STOCK_CAPITAL_GAINS_BASIC_DEDUCTION_WON = 2_500_000;

/** 레거시 호환용 — 신규 UI는 사용하지 말 것 */
export const ASSET_PRETAX_RETURN_PCT: Record<keyof PortfolioOption["weights"], number> = {
  etf: 0,
  bond: 0,
  els: 0,
  mmf: 0,
  gold: 0,
  dollar: 0,
  raw: 0,
};

/** @deprecated 30/70 임의 분할 금지 */
export const TAXABLE_RETURN_SPLIT: Record<
  keyof PortfolioOption["weights"],
  { interest: number; dividend: number; capitalGain: number }
> = {
  mmf: { interest: 1, dividend: 0, capitalGain: 0 },
  bond: { interest: 1, dividend: 0, capitalGain: 0 },
  etf: { interest: 0, dividend: 0, capitalGain: 1 },
  gold: { interest: 0, dividend: 0, capitalGain: 1 },
  dollar: { interest: 0, dividend: 0, capitalGain: 1 },
  raw: { interest: 0, dividend: 0, capitalGain: 1 },
  els: { interest: 1, dividend: 0, capitalGain: 0 },
};

export function corporateTaxRateForTaxableIncome(taxableIncomeWon: number): number {
  if (taxableIncomeWon <= 200_000_000) return 9;
  if (taxableIncomeWon <= 20_000_000_000) return 19;
  if (taxableIncomeWon <= 300_000_000_000) return 21;
  return 24;
}

export const TAX_PROJECTION_ASSUMPTIONS = [
  `이자·배당 원천징수 참고 ${WITHHOLDING_TAX_RATE_PCT}% (원천징수 ≠ 최종세)`,
  `금융소득 종합과세: ${FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON.toLocaleString("ko-KR")}원 초과 시 소득세법 제62조 비교과세`,
  "일반 국내 상장주식 장내 매도 양도소득세 0 (대주주 등 예외는 확인 필요)",
  `해외주식 양도 가정: 기본공제 ${STOCK_CAPITAL_GAINS_BASIC_DEDUCTION_WON.toLocaleString("ko-KR")}원 후 22%`,
  "일괄 연 수수료·30/70 수익분할·자산규모 기반 한계세율 추측을 사용하지 않습니다.",
  "상담용 추정 모델이며 세무 신고·납부 확정 금액이 아닙니다.",
];
