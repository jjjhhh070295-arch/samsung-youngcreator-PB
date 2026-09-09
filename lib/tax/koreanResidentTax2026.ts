/**
 * 2026 귀속 한국 거주 개인 — 상담용 세율·한도 (확정 신고용이 아님).
 * 출처 스냅샷: docs/tax-rules-2026.md (2026-09-09 조회)
 */

/** 금융소득 종합과세 기준금액 (원). 초과 시에만 종합과세 검토. 정확히 2천만 원은 미초과. */
export const FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON = 20_000_000;

/** 보통 예·적금 이자 원천징수 (국세 14% + 지방세 1.4%) */
export const INTEREST_WITHHOLDING_NATIONAL_RATE = 0.14;
export const INTEREST_WITHHOLDING_LOCAL_RATE = 0.014;
export const INTEREST_WITHHOLDING_COMBINED_RATE =
  INTEREST_WITHHOLDING_NATIONAL_RATE + INTEREST_WITHHOLDING_LOCAL_RATE; // 0.154

/** 보통 배당 원천징수 (일반) */
export const DIVIDEND_WITHHOLDING_COMBINED_RATE = 0.154;

/** 해외주식 등 양도소득 — 기본공제 (연 1회, 납세자 단위) */
export const STOCK_CAPITAL_GAINS_BASIC_DEDUCTION_WON = 2_500_000;

/** 일반 외국법인 주식 양도 — 국세 20% + 지방세 2% */
export const FOREIGN_STOCK_CGT_NATIONAL_RATE = 0.2;
export const FOREIGN_STOCK_CGT_LOCAL_RATE = 0.02;
export const FOREIGN_STOCK_CGT_COMBINED_RATE =
  FOREIGN_STOCK_CGT_NATIONAL_RATE + FOREIGN_STOCK_CGT_LOCAL_RATE; // 0.22

/** 지방소득세 (소득세의 10%) */
export const LOCAL_INCOME_TAX_RATE_ON_NATIONAL = 0.1;

/**
 * 종합소득세 기본세율 (과세표준 구간). 2024~ 귀속 일반세율.
 * [상한(원, exclusive 마지막은 Infinity), 한계세율]
 */
export const PROGRESSIVE_BRACKETS: Array<{ upTo: number; rate: number }> = [
  { upTo: 14_000_000, rate: 0.06 },
  { upTo: 50_000_000, rate: 0.15 },
  { upTo: 88_000_000, rate: 0.24 },
  { upTo: 150_000_000, rate: 0.35 },
  { upTo: 300_000_000, rate: 0.38 },
  { upTo: 500_000_000, rate: 0.4 },
  { upTo: 1_000_000_000, rate: 0.42 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.45 },
];

export function roundWon(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** 과세표준에 대한 종합소득 산출세액(국세) */
export function progressiveNationalTax(taxableBaseWon: number): number {
  const base = Math.max(0, taxableBaseWon);
  let tax = 0;
  let prev = 0;
  for (const bracket of PROGRESSIVE_BRACKETS) {
    const slice = Math.min(base, bracket.upTo) - prev;
    if (slice <= 0) break;
    tax += slice * bracket.rate;
    prev = bracket.upTo;
    if (base <= bracket.upTo) break;
  }
  return roundWon(tax);
}

export function localIncomeTaxOnNational(nationalTaxWon: number): number {
  return roundWon(Math.max(0, nationalTaxWon) * LOCAL_INCOME_TAX_RATE_ON_NATIONAL);
}

export function interestWithholdingParts(grossInterestWon: number): {
  nationalWon: number;
  localWon: number;
  totalWon: number;
} {
  const gross = Math.max(0, grossInterestWon);
  const nationalWon = roundWon(gross * INTEREST_WITHHOLDING_NATIONAL_RATE);
  const localWon = roundWon(gross * INTEREST_WITHHOLDING_LOCAL_RATE);
  return { nationalWon, localWon, totalWon: nationalWon + localWon };
}

/**
 * 소득세법 제62조 비교과세(간이 확정 모델).
 * - otherTaxableBaseWon: 금융소득을 제외한 종합과세표준
 * - eligibleFinancialIncomeWon: 종합과세 대상 금융소득(이자·배당 등)
 * 분리과세 가정: 금융소득 × 14% 국세 (+ 지방세 10%)
 * 종합과세: (기타+금융) 과세표준에 누진세
 * 추가부담 = max(0, 종합세액 − 기타만세액 − 분리금융세액)
 */
export function article62ComparisonTax(input: {
  otherTaxableBaseWon: number;
  eligibleFinancialIncomeWon: number;
}): {
  exceedsThreshold: boolean;
  nationalExtraWon: number;
  localExtraWon: number;
  totalExtraWon: number;
  method: "below_threshold" | "separate_cheaper_or_equal" | "comprehensive_extra";
  detail: {
    taxOtherOnlyNational: number;
    taxWithFinancialNational: number;
    separateFinancialNational: number;
  };
} {
  const other = Math.max(0, input.otherTaxableBaseWon);
  const fin = Math.max(0, input.eligibleFinancialIncomeWon);
  const exceedsThreshold = fin > FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON;

  const taxOtherOnlyNational = progressiveNationalTax(other);
  const taxWithFinancialNational = progressiveNationalTax(other + fin);
  const separateFinancialNational = roundWon(fin * INTEREST_WITHHOLDING_NATIONAL_RATE);

  if (!exceedsThreshold) {
    return {
      exceedsThreshold: false,
      nationalExtraWon: 0,
      localExtraWon: 0,
      totalExtraWon: 0,
      method: "below_threshold",
      detail: { taxOtherOnlyNational, taxWithFinancialNational, separateFinancialNational },
    };
  }

  const comprehensiveBurden = taxWithFinancialNational;
  const separateBurden = taxOtherOnlyNational + separateFinancialNational;
  const nationalExtraWon = Math.max(0, comprehensiveBurden - separateBurden);
  const localExtraWon = localIncomeTaxOnNational(nationalExtraWon);

  return {
    exceedsThreshold: true,
    nationalExtraWon,
    localExtraWon,
    totalExtraWon: nationalExtraWon + localExtraWon,
    method: nationalExtraWon > 0 ? "comprehensive_extra" : "separate_cheaper_or_equal",
    detail: { taxOtherOnlyNational, taxWithFinancialNational, separateFinancialNational },
  };
}

/**
 * 해외(및 과세대상) 주식 양도 — 연간 손익 통산 후 기본공제 1회.
 * exemptDomesticLossesWon 은 해외 과세이익과 상계하지 않음.
 */
export function foreignStockCapitalGainsTax(input: {
  netTaxableGainsWon: number;
  /** 이미 소진된 기본공제 */
  deductionAlreadyUsedWon?: number;
}): {
  taxableAfterDeductionWon: number;
  nationalWon: number;
  localWon: number;
  totalWon: number;
  deductionAppliedWon: number;
} {
  const net = input.netTaxableGainsWon;
  const used = Math.max(0, input.deductionAlreadyUsedWon ?? 0);
  const remainingDeduction = Math.max(0, STOCK_CAPITAL_GAINS_BASIC_DEDUCTION_WON - used);

  if (!Number.isFinite(net) || net <= 0) {
    return {
      taxableAfterDeductionWon: 0,
      nationalWon: 0,
      localWon: 0,
      totalWon: 0,
      deductionAppliedWon: 0,
    };
  }

  const deductionAppliedWon = Math.min(remainingDeduction, net);
  const taxableAfterDeductionWon = Math.max(0, net - deductionAppliedWon);
  const nationalWon = roundWon(taxableAfterDeductionWon * FOREIGN_STOCK_CGT_NATIONAL_RATE);
  const localWon = roundWon(taxableAfterDeductionWon * FOREIGN_STOCK_CGT_LOCAL_RATE);
  return {
    taxableAfterDeductionWon,
    nationalWon,
    localWon,
    totalWon: nationalWon + localWon,
    deductionAppliedWon,
  };
}

/** 일반 비상장·대주주가 아닌 국내 상장 주식 장내 매도 — 양도소득세 0 */
export function ordinaryDomesticListedShareCgtWon(_priceGainWon: number): number {
  return 0;
}

export function crossesFinancialIncomeThreshold(eligibleFinancialIncomeWon: number): boolean {
  return eligibleFinancialIncomeWon > FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON;
}
