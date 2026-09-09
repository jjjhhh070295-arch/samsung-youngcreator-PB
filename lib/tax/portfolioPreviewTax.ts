/**
 * Portfolio preview 기준 세전·세후 산출.
 * SET 버킷·휴리스틱 비중·고정 0.15% 수수료·국내양도 22% 가정 사용 금지.
 */

import type { ApprovedInstrument, Client, Portfolio } from "../types";
import type { DepositProduct } from "./depositInterest";
import { calculateDepositInterest } from "./depositInterest";
import {
  article62ComparisonTax,
  crossesFinancialIncomeThreshold,
  DIVIDEND_WITHHOLDING_COMBINED_RATE,
  FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON,
  foreignStockCapitalGainsTax,
  ordinaryDomesticListedShareCgtWon,
  roundWon,
} from "./koreanResidentTax2026";
import { deriveNonFinancialTaxableBaseWon } from "../financialIncome";
import {
  baselineExistingDividendWon,
  baselineExistingInterestWon,
} from "../financialIncomeBreakdown";
import { getAssumptionForSymbol } from "../returnAssumptions";
import type { InstrumentReturnAssumptionPct } from "../returnAssumptions";

export type ListingJurisdiction = "kr_listed" | "foreign_listed" | "unlisted" | "unknown";
export type LegalProductKind =
  | "stock"
  | "etf_kr"
  | "etf_foreign"
  | "bond_direct"
  | "bond_etf"
  | "deposit"
  | "cash"
  | "other";

export type ReturnComponentBasis =
  | "price_only"
  | "total_return"
  | "includes_distributions"
  | "ytm"
  | "unknown";

export interface PreviewInstrumentLine {
  id: string;
  symbol: string;
  name: string;
  legalKind: LegalProductKind;
  listing: ListingJurisdiction;
  currency: string;
  marketValueWon: number;
  quantity: number | null;
  /** 취득원가(원). null = 미상 */
  costBasisWon: number | null;
  /** 세전 기대 총수익(원) — 구성 요소 합 */
  grossReturnWon: number;
  priceReturnWon: number;
  dividendWon: number;
  interestWon: number;
  /** 수익률 가정이 없어 0원으로 위장하지 않아야 함 */
  missingReturnAssumption: boolean;
  /** 이미 펀드보수 차감된 수익률이면 true */
  expensesAlreadyInReturn: boolean;
  feeWon: number;
  returnBasis: ReturnComponentBasis;
  source: string;
  asOf: string | null;
}

export interface PortfolioPreviewSnapshot {
  revision: string;
  clientId: string;
  asOf: string;
  horizonYears: number;
  /** preview 원금(포함 자산만) */
  principalWon: number;
  instruments: PreviewInstrumentLine[];
  residualCashWon: number;
  depositsInPreview: DepositProduct[];
}

export interface CustomerTaxContext {
  taxYear: number;
  declaredComprehensiveHistorically: boolean | null;
  /** 확정/기타 금융소득(이미 실현·외부) */
  existingInterestWon: number | null;
  existingDividendWon: number | null;
  /** 올해 예상 총급여 등 — null = 미입력 */
  expectedWageGrossWon: number | null;
  otherComprehensiveIncomeWon: number | null;
  /** 근로소득공제 후 등 비금융 과세표준(확정 입력). wage와 이중합산하지 않음 */
  confirmedNonFinancialTaxableBaseWon: number | null;
  employmentIncomeDeductionWon: number | null;
  otherDeductionsWon: number | null;
  taxCreditsWon: number | null;
  withheldOrPrepaidWon: number | null;
  priorYearWageGrossWon: number | null;
  priorYearAssessedNationalWon: number | null;
  priorYearAssessedLocalWon: number | null;
  isLargeShareholderConfirmed: boolean | null;
  majorShareholderStatus: "no" | "yes" | "unknown";
  /** 법인·비거주 등 개인 규칙 미지원 */
  unsupportedEntity?: boolean;
  /** 이미 사용한 주식양도 기본공제 */
  cgtDeductionUsedWon: number;
  /** 외부에서 이미 실현된 과세대상 양도차익 */
  outsideTaxableCgtGainsWon: number;
}

export type ProjectionStatus = "ok" | "pending_income" | "incomplete" | "unsupported";

export interface PortfolioTaxProjectionResult {
  status: ProjectionStatus;
  statusMessageKo: string;
  scopeLabelKo: string;
  principalWon: number;
  preTaxExpectedProfitWon: number | null;
  estimatedTaxWon: number | null;
  costsWon: number | null;
  afterTaxExpectedProfitWon: number | null;
  afterTaxEndingAssetsWon: number | null;
  components: {
    priceReturnWon: number;
    dividendWon: number;
    interestWon: number;
    depositInterestWon: number;
  };
  taxes: {
    interestWithholdingWon: number;
    dividendWithholdingWon: number;
    comprehensiveExtraWon: number | null;
    domesticListedShareCgtWon: number;
    foreignStockCgtWon: number | null;
    transactionLevyWon: number;
    totalAttributableWon: number | null;
  };
  projectedComprehensiveTaxStatus: "below" | "above" | "unknown";
  needsIncomeForm: boolean;
  assumptions: string[];
  warnings: string[];
  breakdown: Array<{ label: string; amountWon: number | null; note?: string }>;
}

function classifyInstrument(inst: ApprovedInstrument): {
  legalKind: LegalProductKind;
  listing: ListingJurisdiction;
} {
  const kind = (inst.kind || "").toLowerCase();
  const asset = (inst.assetClassKey || "").toLowerCase();
  const cur = (inst.currency || "KRW").toUpperCase();
  const sym = (inst.symbol || "").trim().toUpperCase().replace(/\.(KS|KQ)$/i, "");
  const isEtf = kind.includes("etf") || kind.includes("etn") || /\betf\b|kodex|tiger|ace|kosef|arirang|ishares/i.test(`${inst.name} ${inst.symbol}`);
  const isUsListedBondEtf = sym === "LQD" || (cur === "USD" && isEtf && asset.includes("bond"));
  if (asset === "cash" || kind.includes("mmf") || kind.includes("rp")) {
    return { legalKind: "cash", listing: "kr_listed" };
  }
  if ((asset.includes("bond") && isEtf) || isUsListedBondEtf) {
    // 국내 상장 채권 ETF vs 해외 상장(LQD 등) — 통화만으로 과세 경로를 단정하지 않음
    return {
      legalKind: "bond_etf",
      listing: isUsListedBondEtf || cur === "USD" ? "foreign_listed" : "kr_listed",
    };
  }
  if (asset.includes("bond") && !isEtf) {
    return { legalKind: "bond_direct", listing: cur === "KRW" ? "kr_listed" : "foreign_listed" };
  }
  if (isEtf) {
    // 국내 상장 해외지수 ETF ≠ 해외 상장 주식
    return {
      legalKind: cur === "KRW" ? "etf_kr" : "etf_foreign",
      listing: cur === "KRW" ? "kr_listed" : "foreign_listed",
    };
  }
  if (asset.includes("global") || cur === "USD") {
    return { legalKind: "stock", listing: "foreign_listed" };
  }
  if (asset.includes("domestic") || cur === "KRW") {
    return { legalKind: "stock", listing: "kr_listed" };
  }
  return { legalKind: "other", listing: "unknown" };
}

/**
 * 승인 포트폴리오 → preview 스냅샷.
 * expectedReturn 이 total_return 이고 dividendYieldPct 가 있으면 가격수익 = 총 − 배당.
 */
export function buildPreviewFromApprovedPortfolio(input: {
  client: Client;
  portfolio: Portfolio;
  revision?: string;
  horizonYears?: number;
  /** symbol → { totalReturnPct?, priceReturnPct?, dividendYieldPct?, expensesInNav? } */
  returnAssumptions?: Map<string, InstrumentReturnAssumptionPct & { explicitFeeWon?: number | null }>;
  deposits?: DepositProduct[];
}): PortfolioPreviewSnapshot | null {
  const pf = input.portfolio;
  const instruments = pf.instruments ?? [];
  if (!instruments.length && !(pf.allocations?.length > 0)) return null;

  const asOf = new Date().toISOString();
  const horizonYears = input.horizonYears ?? 1;
  const lines: PreviewInstrumentLine[] = [];
  let principalWon = 0;

  for (const inst of instruments) {
    const mv = inst.allocationAmountWon;
    if (mv == null || !Number.isFinite(mv) || mv < 0) continue;
    principalWon += mv;
    const { legalKind, listing } = classifyInstrument(inst);
    const assume = getAssumptionForSymbol(input.returnAssumptions, inst.symbol);
    const portReturn =
      pf.metricsStatus === "ok" && pf.expectedReturn != null && Number.isFinite(pf.expectedReturn)
        ? pf.expectedReturn
        : null;

    let priceReturnPct: number | null = null;
    let dividendYieldPct: number | null = null;
    let interestPct: number | null = null;
    let basis: ReturnComponentBasis = "unknown";
    let expensesAlready = false;

    if (assume) {
      expensesAlready = !!assume.expensesAlreadyInReturn;
      basis = (assume.returnBasis as ReturnComponentBasis | undefined) ?? "unknown";
      if (assume.totalReturnPct != null && assume.dividendYieldPct != null) {
        // 총수익 8% + 배당 2% 포함 → 가격 6% + 배당 2% (이중가산 금지)
        priceReturnPct = assume.totalReturnPct - assume.dividendYieldPct;
        dividendYieldPct = assume.dividendYieldPct;
        basis = "total_return";
      } else if (assume.priceReturnPct != null && assume.dividendYieldPct != null) {
        priceReturnPct = assume.priceReturnPct;
        dividendYieldPct = assume.dividendYieldPct;
        basis = "price_only";
      } else if (
        assume.totalReturnPct != null &&
        assume.couponPct != null &&
        (legalKind === "bond_etf" || legalKind === "bond_direct")
      ) {
        // ETF/직접채권: couponPct 는 총수익에 포함된 인컴 성분 — 이자로 다시 가산하지 않음
        priceReturnPct = assume.totalReturnPct - assume.couponPct;
        interestPct = assume.couponPct;
        basis = "total_return";
      } else if (assume.totalReturnPct != null) {
        priceReturnPct = assume.totalReturnPct;
        basis = "total_return";
      } else if (assume.priceReturnPct != null) {
        priceReturnPct = assume.priceReturnPct;
        basis = "price_only";
      }
      if (assume.couponPct != null && interestPct == null) interestPct = assume.couponPct;
      if (assume.dividendYieldPct != null && dividendYieldPct == null) {
        dividendYieldPct = assume.dividendYieldPct;
      }
    } else if (portReturn != null) {
      // 포트폴리오 공통 기대수익만 있을 때 — 구성 미상 → 가격수익으로만 배분, 배당 추정 금지
      priceReturnPct = portReturn;
      basis = "unknown";
    }

    if (legalKind === "cash") {
      priceReturnPct = 0;
      dividendYieldPct = 0;
      interestPct = 0;
      basis = "price_only";
    }

    const hasAnyReturnPct =
      priceReturnPct != null || dividendYieldPct != null || interestPct != null;
    const missingReturnAssumption = legalKind !== "cash" && !hasAnyReturnPct;

    const priceReturnWon =
      priceReturnPct != null ? roundWon(mv * (priceReturnPct / 100) * horizonYears) : 0;
    const dividendWon =
      dividendYieldPct != null ? roundWon(mv * (dividendYieldPct / 100) * horizonYears) : 0;
    const interestWon = interestPct != null ? roundWon(mv * (interestPct / 100) * horizonYears) : 0;
    const feeWon =
      assume && "explicitFeeWon" in assume && assume.explicitFeeWon != null && Number.isFinite(assume.explicitFeeWon)
        ? Math.max(0, assume.explicitFeeWon as number)
        : 0;

    const grossReturnWon = priceReturnWon + dividendWon + interestWon;

    lines.push({
      id: `${inst.symbol}-${inst.assetClassKey}`,
      symbol: inst.symbol,
      name: inst.name,
      legalKind,
      listing,
      currency: inst.currency || "KRW",
      marketValueWon: mv,
      quantity: inst.quantity,
      costBasisWon: null,
      grossReturnWon,
      priceReturnWon,
      dividendWon,
      interestWon,
      missingReturnAssumption,
      expensesAlreadyInReturn: expensesAlready,
      feeWon,
      returnBasis: basis,
      source: "approved-portfolio",
      asOf: pf.confirmedAt ?? asOf,
    });
  }

  const depositsInPreview = (input.deposits ?? []).filter((d) => d.includeInManagedPreview);
  for (const d of depositsInPreview) {
    if (d.identifiedInCashBalance) continue; // 현금에 이미 포함된 잔액은 원금 이중계상 금지
    if (d.principalWon != null) principalWon += d.principalWon;
  }

  return {
    revision: input.revision ?? pf.compositionRevision ?? `preview-${Date.now()}`,
    clientId: input.client.id,
    asOf,
    horizonYears,
    principalWon,
    instruments: lines,
    residualCashWon: 0,
    depositsInPreview,
  };
}

export function projectPortfolioPreviewTax(input: {
  preview: PortfolioPreviewSnapshot;
  taxContext: CustomerTaxContext;
  /** 1년 후 매도 가정 시뮬레이션 */
  assumeForeignShareSaleAfterHorizon?: boolean;
}): PortfolioTaxProjectionResult {
  const { preview, taxContext } = input;
  const assumptions: string[] = [
    "Portfolio preview 포함 자산만 세전·세후 5대 지표에 반영합니다.",
    "상담용 추정치이며 세무 신고·납부 확정 금액이 아닙니다.",
    `금융소득 종합과세 기준 ${FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON.toLocaleString("ko-KR")}원 초과 시 비교과세(소득세법 제62조)를 적용합니다.`,
  ];
  const warnings: string[] = [];

  let priceReturnWon = 0;
  let dividendWon = 0;
  let interestWon = 0;
  let costsWon = 0;
  let domesticListedShareCgtWon = 0;
  let foreignPriceGainsForCgt = 0;
  let transactionLevyWon = 0;

  for (const line of preview.instruments) {
    priceReturnWon += line.priceReturnWon;
    dividendWon += line.dividendWon;
    interestWon += line.interestWon;
    if (!line.expensesAlreadyInReturn) costsWon += line.feeWon;

    if (line.legalKind === "stock" && line.listing === "kr_listed") {
      if (taxContext.majorShareholderStatus === "yes" || taxContext.isLargeShareholderConfirmed) {
        warnings.push(`${line.symbol}: 대주주 등으로 국내 양도세 별도 확인이 필요합니다.`);
      } else if (taxContext.majorShareholderStatus === "unknown") {
        warnings.push(`${line.symbol}: 대주주 여부 미확인 — 국내 상장 양도세 0원으로 표시하지 않고 확인 필요로 둡니다.`);
      } else {
        domesticListedShareCgtWon += ordinaryDomesticListedShareCgtWon(Math.max(0, line.priceReturnWon));
      }
    }

    if (
      input.assumeForeignShareSaleAfterHorizon &&
      line.legalKind === "stock" &&
      line.listing === "foreign_listed"
    ) {
      // 매도 가정: 가격수익 성분만 (배당 포함 총수익 사용 금지)
      foreignPriceGainsForCgt += Math.max(0, line.priceReturnWon);
    }
  }

  let depositInterestWon = 0;
  for (const d of preview.depositsInPreview) {
    const r = calculateDepositInterest(d, {
      projectionYear: taxContext.taxYear,
      asOf: preview.asOf.slice(0, 10),
    });
    if (r.status === "ok" && r.grossInterestWon != null) {
      depositInterestWon += r.grossInterestWon;
      interestWon += r.grossInterestWon;
    } else if (r.status === "incomplete") {
      warnings.push(`${d.productName || d.id}: 예·적금 이자 산출 불완전`);
    }
  }

  const preTaxExpectedProfitWonRaw = priceReturnWon + dividendWon + interestWon;
  const missingReturnAssumption = preview.instruments.some((l) => l.missingReturnAssumption);

  const interestWithholdingWon = roundWon(interestWon * 0.154);
  const dividendWithholdingWon = roundWon(dividendWon * DIVIDEND_WITHHOLDING_COMBINED_RATE);

  const existingInterest = taxContext.existingInterestWon;
  const existingDividend = taxContext.existingDividendWon;
  const existingKnown =
    (existingInterest != null && Number.isFinite(existingInterest)) ||
    (existingDividend != null && Number.isFinite(existingDividend));

  const existingFin =
    Math.max(0, existingInterest ?? 0) + Math.max(0, existingDividend ?? 0);
  const previewFin = interestWon + dividendWon;
  const totalEligibleFin = existingFin + previewFin;

  const projectedComprehensiveTaxStatus: "below" | "above" | "unknown" = !existingKnown &&
    previewFin === 0
    ? "unknown"
    : crossesFinancialIncomeThreshold(totalEligibleFin)
      ? "above"
      : "below";

  const declaredNo =
    taxContext.declaredComprehensiveHistorically === false;
  const derivedOtherBase = deriveNonFinancialTaxableBaseWon({
    expectedWageGrossWon: taxContext.expectedWageGrossWon,
    employmentIncomeDeductionWon: taxContext.employmentIncomeDeductionWon,
    otherDeductionsWon: taxContext.otherDeductionsWon,
    otherComprehensiveIncomeWon: taxContext.otherComprehensiveIncomeWon,
  });
  const needsIncomeForm =
    !missingReturnAssumption &&
    projectedComprehensiveTaxStatus === "above" &&
    (declaredNo || derivedOtherBase == null);

  let comprehensiveExtraWon: number | null = 0;
  let status: ProjectionStatus = "ok";
  let statusMessageKo = "Portfolio preview 기준 산출";

  if (missingReturnAssumption) {
    status = "incomplete";
    statusMessageKo = "수익률 정보 확인 필요";
    comprehensiveExtraWon = null;
  } else if (needsIncomeForm) {
    status = "pending_income";
    statusMessageKo =
      "예상 금융소득이 종합과세 기준을 초과합니다. 소득 정보를 입력해 주세요.";
    comprehensiveExtraWon = null;
  } else if (taxContext.unsupportedEntity) {
    status = "unsupported";
    statusMessageKo = "법인·비거주 등은 개인 규칙을 적용하지 않습니다. 세무사 확인이 필요합니다.";
    comprehensiveExtraWon = null;
  } else if (projectedComprehensiveTaxStatus === "above") {
    const otherBase = derivedOtherBase ?? 0;

    // 증분: preview 금융소득을 넣은 경우 vs 제외한 경우의 추가세
    const withPreview = article62ComparisonTax({
      otherTaxableBaseWon: otherBase,
      eligibleFinancialIncomeWon: totalEligibleFin,
    });
    const withoutPreview = article62ComparisonTax({
      otherTaxableBaseWon: otherBase,
      eligibleFinancialIncomeWon: existingFin,
    });
    comprehensiveExtraWon = Math.max(
      0,
      withPreview.totalExtraWon - withoutPreview.totalExtraWon,
    );
    assumptions.push("종합과세 추가부담은 preview 금융소득 증분(비교과세)으로 귀속합니다.");
  }

  let foreignStockCgtWon: number | null = 0;
  if (
    !missingReturnAssumption &&
    input.assumeForeignShareSaleAfterHorizon &&
    foreignPriceGainsForCgt > 0
  ) {
    const outside = Math.max(0, taxContext.outsideTaxableCgtGainsWon);
    const combined = outside + foreignPriceGainsForCgt;
    const full = foreignStockCapitalGainsTax({
      netTaxableGainsWon: combined,
      deductionAlreadyUsedWon: taxContext.cgtDeductionUsedWon,
    });
    const outsideOnly = foreignStockCapitalGainsTax({
      netTaxableGainsWon: outside,
      deductionAlreadyUsedWon: taxContext.cgtDeductionUsedWon,
    });
    foreignStockCgtWon = Math.max(0, full.totalWon - outsideOnly.totalWon);
    assumptions.push(
      "해외주식 양도세는 '1년 후 매도 가정' 시뮬레이션이며 실제 매도·확정세액이 아닙니다.",
    );
  } else if (!input.assumeForeignShareSaleAfterHorizon || missingReturnAssumption) {
    foreignStockCgtWon = missingReturnAssumption ? null : 0;
  }

  if (taxContext.majorShareholderStatus === "unknown") {
    // 국내 양도 0 표시를 신뢰할 수 없음 — 해당 줄은 경고만
  }

  const withholdingAsCredit = interestWithholdingWon + dividendWithholdingWon;
  // 추정 세금(귀속): 원천징수 + 종합 추가 + 해외양도 − 이중계산 방지
  // 원천징수는 납부액이므로 종합 추가세에 다시 더하지 않되, 세후 수익에서는
  // 원천징수 + 추가 종합 + 양도세를 비용으로 인식
  let estimatedTaxWon: number | null =
    withholdingAsCredit +
    (comprehensiveExtraWon ?? 0) +
    domesticListedShareCgtWon +
    (foreignStockCgtWon ?? 0) +
    transactionLevyWon;

  if (status === "pending_income" || status === "unsupported" || status === "incomplete") {
    estimatedTaxWon = null;
  }

  const preTaxExpectedProfitWon = missingReturnAssumption ? null : preTaxExpectedProfitWonRaw;
  const costsWonOut = missingReturnAssumption ? null : costsWon;

  const afterTaxExpectedProfitWon =
    estimatedTaxWon == null || preTaxExpectedProfitWon == null
      ? null
      : preTaxExpectedProfitWon - estimatedTaxWon - (costsWonOut ?? 0);
  const afterTaxEndingAssetsWon =
    afterTaxExpectedProfitWon == null
      ? null
      : preview.principalWon + afterTaxExpectedProfitWon;

  if (preview.instruments.some((l) => l.returnBasis === "unknown" && !l.missingReturnAssumption)) {
    warnings.push("일부 종목은 수익 구성(가격/배당)이 미상입니다. 배당을 임의 분할하지 않았습니다.");
  }
  if (missingReturnAssumption) {
    warnings.push("일부 종목의 기대수익률이 없어 세전·세후 금액을 확정하지 않았습니다.");
  }

  return {
    status,
    statusMessageKo,
    scopeLabelKo: "Portfolio preview 기준",
    principalWon: preview.principalWon,
    preTaxExpectedProfitWon,
    estimatedTaxWon,
    costsWon: costsWonOut,
    afterTaxExpectedProfitWon,
    afterTaxEndingAssetsWon,
    components: {
      priceReturnWon,
      dividendWon,
      interestWon: interestWon - depositInterestWon,
      depositInterestWon,
    },
    taxes: {
      interestWithholdingWon,
      dividendWithholdingWon,
      comprehensiveExtraWon,
      domesticListedShareCgtWon,
      foreignStockCgtWon,
      transactionLevyWon,
      totalAttributableWon: estimatedTaxWon,
    },
    projectedComprehensiveTaxStatus,
    needsIncomeForm,
    assumptions,
    warnings,
    breakdown: [
      { label: "가격 손익", amountWon: missingReturnAssumption ? null : priceReturnWon },
      { label: "배당·분배금(총액)", amountWon: missingReturnAssumption ? null : dividendWon },
      { label: "이자(총액)", amountWon: missingReturnAssumption ? null : interestWon },
      { label: "원천징수(이자)", amountWon: missingReturnAssumption ? null : interestWithholdingWon },
      { label: "원천징수(배당)", amountWon: missingReturnAssumption ? null : dividendWithholdingWon },
      { label: "종합과세 추가(귀속)", amountWon: comprehensiveExtraWon },
      { label: "국내 상장주식 양도세", amountWon: missingReturnAssumption ? null : domesticListedShareCgtWon },
      { label: "해외주식 양도세(가정)", amountWon: foreignStockCgtWon },
      { label: "비용", amountWon: costsWonOut },
    ],
  };
}

export function defaultTaxContextFromClient(
  client: Client,
  taxYear = new Date().getFullYear(),
  opts?: {
    deposits?: DepositProduct[] | null;
    asOf?: string | null;
  },
): CustomerTaxContext {
  const profile = client.financialIncomeProfile ?? {
    interestIncomeWon: null,
    dividendIncomeWon: null,
    parseStatus: "none" as const,
  };
  const asOf = opts?.asOf ?? `${taxYear}-12-31`;
  return {
    taxYear,
    declaredComprehensiveHistorically: client.financialIncomeComprehensiveTax ?? null,
    existingInterestWon: baselineExistingInterestWon(profile, opts?.deposits ?? null, {
      asOf,
      projectionYear: taxYear,
    }),
    existingDividendWon: baselineExistingDividendWon(profile),
    expectedWageGrossWon: profile?.expectedWageGrossWon ?? null,
    otherComprehensiveIncomeWon: profile?.otherComprehensiveIncomeWon ?? null,
    /** @deprecated 신규 경로에서 무시 — 호환 필드만 유지 */
    confirmedNonFinancialTaxableBaseWon: null,
    employmentIncomeDeductionWon: profile?.employmentIncomeDeductionWon ?? null,
    otherDeductionsWon: profile?.otherDeductionsWon ?? null,
    taxCreditsWon: profile?.taxCreditsWon ?? null,
    withheldOrPrepaidWon: profile?.withheldOrPrepaidWon ?? null,
    priorYearWageGrossWon: profile?.priorYearWageGrossWon ?? null,
    priorYearAssessedNationalWon: profile?.priorYearAssessedNationalWon ?? null,
    priorYearAssessedLocalWon: profile?.priorYearAssessedLocalWon ?? null,
    isLargeShareholderConfirmed: client.isMajorityShareholder ?? null,
    majorShareholderStatus:
      client.isMajorityShareholder === true
        ? "unknown"
        : client.isMajorityShareholder === false
          ? "no"
          : "unknown",
    cgtDeductionUsedWon: profile?.cgtDeductionUsedWon ?? 0,
    outsideTaxableCgtGainsWon: profile?.outsideTaxableCgtGainsWon ?? 0,
    unsupportedEntity: client.clientType === "corporate",
  };
}
