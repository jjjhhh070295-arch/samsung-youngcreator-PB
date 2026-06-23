import type { CashFlow, Client } from "@/lib/types";
import type { PortfolioOption } from "@/lib/portfolio";
import {
  ASSET_PRETAX_RETURN_PCT,
  DEFAULT_FEE_RATE_PCT,
  DEFAULT_HORIZON_YEARS,
  DOMESTIC_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT,
  FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON,
  LARGE_SHAREHOLDER_CAPITAL_GAIN_TAX_RATE_PCT,
  OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT,
  TAX_PROJECTION_ASSUMPTIONS,
  TAXABLE_RETURN_SPLIT,
  WITHHOLDING_TAX_RATE_PCT,
  corporateTaxRateForTaxableIncome,
} from "@/lib/taxProjectionRules";

export interface TaxProfile {
  annualFinancialIncomeWon?: number;
  marginalTaxRatePct?: number;
  domesticEquityPct?: number;
  overseasEquityPct?: number;
  avgHoldingMonths?: number;
  pensionAccountPct?: number;
  isLargeShareholder?: boolean;
  feeRatePct?: number;
  isCorporate?: boolean;
  corporateTaxRatePct?: number;
}

export interface TaxProjectionInput {
  principalWon: number;
  horizonYears: number;
  weights: PortfolioOption["weights"];
  expectedReturnPct: number;
  taxProfile: TaxProfile;
  cashFlows: CashFlow[];
  label?: string;
}

export interface TaxProjectionResult {
  label: string;
  principalWon: number;
  grossReturnWon: number;
  taxes: {
    interestTaxWon: number;
    dividendTaxWon: number;
    capitalGainTaxWon: number;
    comprehensiveTaxWon: number;
    scheduledTaxWon: number;
    totalTaxWon: number;
  };
  feesWon: number;
  netEndingWon: number;
  effectiveTaxRatePct: number;
  preTaxReturnPct: number;
  afterTaxReturnPct: number;
  breakdownByAsset: Array<{ asset: string; grossWon: number; taxWon: number }>;
  assumptions: string[];
  warnings: string[];
}

export interface TaxProjectionComparison {
  deltaGrossReturnWon: number;
  deltaTotalTaxWon: number;
  deltaFeesWon: number;
  deltaNetEndingWon: number;
  deltaEffectiveTaxRatePct: number;
  deltaAfterTaxReturnPct: number;
  summary: string[];
}

export interface TaxProfileQuestion {
  code: string;
  title: string;
  question: string;
  reason: string;
  severity: "상" | "중" | "하";
}

const ASSET_LABELS: Record<keyof PortfolioOption["weights"], string> = {
  etf: "주식/ETF",
  bond: "채권",
  els: "ELS",
  mmf: "MMF/RP",
  gold: "금",
  dollar: "달러",
  raw: "원자재",
};

const TAX_FLOW_PATTERN = /세|증여|상속|양도|법인세|종부|재산|tax|inheritance|gift/i;

function roundWon(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function roundPct(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWeights(weights: PortfolioOption["weights"]): PortfolioOption["weights"] {
  const effective = {
    ...weights,
    bond: weights.bond + weights.els * 0.7,
    mmf: weights.mmf + weights.els * 0.3,
    els: 0,
  };
  const positive = Object.fromEntries(
    Object.entries(effective).map(([key, value]) => [key, Math.max(0, value)]),
  ) as PortfolioOption["weights"];
  const total = Object.values(positive).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(
    Object.entries(positive).map(([key, value]) => [key, (value / total) * 100]),
  ) as PortfolioOption["weights"];
}

function scheduledTaxWon(cashFlows: CashFlow[], horizonYears: number) {
  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setMonth(horizonEnd.getMonth() + Math.max(1, horizonYears) * 12);

  return cashFlows
    .filter((flow) => flow.amount < 0)
    .filter((flow) => TAX_FLOW_PATTERN.test(`${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""}`))
    .filter((flow) => {
      if (!flow.date) return true;
      const normalized = flow.date.length === 7 ? `${flow.date}-01` : flow.date;
      const flowDate = new Date(normalized);
      if (Number.isNaN(flowDate.getTime())) return true;
      return flowDate >= now && flowDate <= horizonEnd;
    })
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
}

function financialIncomeExtraTax(projectedFinancialIncomeWon: number, profile: TaxProfile, horizonYears: number) {
  const annualProjected = projectedFinancialIncomeWon / Math.max(1, horizonYears);
  const existing = Math.max(0, profile.annualFinancialIncomeWon ?? 0);
  const marginal = clamp(profile.marginalTaxRatePct ?? 24, WITHHOLDING_TAX_RATE_PCT, 45);
  const extraRate = Math.max(0, marginal - WITHHOLDING_TAX_RATE_PCT) / 100;
  const beforeExcess = Math.max(0, existing - FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON);
  const afterExcess = Math.max(0, existing + annualProjected - FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON);
  return (afterExcess - beforeExcess) * extraRate * Math.max(1, horizonYears);
}

function pensionTaxDiscountWon(investmentTaxWon: number, grossReturnWon: number, profile: TaxProfile) {
  const pensionPct = clamp(profile.pensionAccountPct ?? 0, 0, 100);
  if (pensionPct <= 0 || grossReturnWon <= 0) return 0;
  const discountRatePct = pensionPct >= 50 ? 1 : 0.5;
  const pensionGrossWon = grossReturnWon * (pensionPct / 100);
  return Math.min(investmentTaxWon, pensionGrossWon * (discountRatePct / 100));
}

function applyProportionalDiscount(
  taxes: Pick<TaxProjectionResult["taxes"], "interestTaxWon" | "dividendTaxWon" | "capitalGainTaxWon" | "comprehensiveTaxWon">,
  discountWon: number,
) {
  const total = taxes.interestTaxWon + taxes.dividendTaxWon + taxes.capitalGainTaxWon + taxes.comprehensiveTaxWon;
  if (total <= 0 || discountWon <= 0) return taxes;
  const ratio = Math.min(1, discountWon / total);
  return {
    interestTaxWon: taxes.interestTaxWon * (1 - ratio),
    dividendTaxWon: taxes.dividendTaxWon * (1 - ratio),
    capitalGainTaxWon: taxes.capitalGainTaxWon * (1 - ratio),
    comprehensiveTaxWon: taxes.comprehensiveTaxWon * (1 - ratio),
  };
}

export function projectTax(input: TaxProjectionInput): TaxProjectionResult {
  const label = input.label ?? "세후 추정";
  const principalWon = Math.max(0, input.principalWon);
  const horizonYears = Math.max(1, input.horizonYears || DEFAULT_HORIZON_YEARS);
  const weights = normalizeWeights(input.weights);
  const expectedReturnPct = Math.max(0, input.expectedReturnPct);
  const profile = input.taxProfile;
  const feeRatePct = Math.max(0, profile.feeRatePct ?? DEFAULT_FEE_RATE_PCT);
  const equityDomesticPct = clamp(profile.domesticEquityPct ?? 40, 0, 100);
  const equityOverseasPct = clamp(profile.overseasEquityPct ?? 100 - equityDomesticPct, 0, 100);
  const equitySplitTotal = equityDomesticPct + equityOverseasPct || 100;
  const domesticEquityRatio = equityDomesticPct / equitySplitTotal;
  const overseasEquityRatio = equityOverseasPct / equitySplitTotal;

  const rawReturnPct = (Object.entries(weights) as Array<[keyof PortfolioOption["weights"], number]>)
    .reduce((sum, [asset, weight]) => sum + (weight / 100) * ASSET_PRETAX_RETURN_PCT[asset], 0);
  const scale = rawReturnPct > 0 ? expectedReturnPct / rawReturnPct : 0;

  let interestIncomeWon = 0;
  let dividendIncomeWon = 0;
  let domesticCapitalGainWon = 0;
  let overseasCapitalGainWon = 0;
  let otherCapitalGainWon = 0;
  const breakdownSource: Record<keyof PortfolioOption["weights"], { grossWon: number; taxWon: number }> = {
    etf: { grossWon: 0, taxWon: 0 },
    bond: { grossWon: 0, taxWon: 0 },
    els: { grossWon: 0, taxWon: 0 },
    mmf: { grossWon: 0, taxWon: 0 },
    gold: { grossWon: 0, taxWon: 0 },
    dollar: { grossWon: 0, taxWon: 0 },
    raw: { grossWon: 0, taxWon: 0 },
  };

  for (const [asset, weight] of Object.entries(weights) as Array<[keyof PortfolioOption["weights"], number]>) {
    const grossWon = principalWon * (weight / 100) * (ASSET_PRETAX_RETURN_PCT[asset] / 100) * scale * horizonYears;
    const split = TAXABLE_RETURN_SPLIT[asset];
    const interestWon = grossWon * split.interest;
    const dividendWon = grossWon * split.dividend;
    const capitalWon = grossWon * split.capitalGain;

    interestIncomeWon += interestWon;
    dividendIncomeWon += dividendWon;
    if (asset === "etf") {
      domesticCapitalGainWon += capitalWon * domesticEquityRatio;
      overseasCapitalGainWon += capitalWon * overseasEquityRatio;
    } else {
      otherCapitalGainWon += capitalWon;
    }
    breakdownSource[asset].grossWon = grossWon;
  }

  const domesticCapitalRate =
    profile.isLargeShareholder
      ? LARGE_SHAREHOLDER_CAPITAL_GAIN_TAX_RATE_PCT
      : DOMESTIC_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT;
  let interestTaxWon = interestIncomeWon * (WITHHOLDING_TAX_RATE_PCT / 100);
  let dividendTaxWon = dividendIncomeWon * (WITHHOLDING_TAX_RATE_PCT / 100);
  let capitalGainTaxWon =
    domesticCapitalGainWon * (domesticCapitalRate / 100) +
    overseasCapitalGainWon * (OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT / 100) +
    otherCapitalGainWon * (OVERSEAS_EQUITY_CAPITAL_GAIN_TAX_RATE_PCT / 100);
  let comprehensiveTaxWon = financialIncomeExtraTax(interestIncomeWon + dividendIncomeWon, profile, horizonYears);

  const grossReturnWon = interestIncomeWon + dividendIncomeWon + domesticCapitalGainWon + overseasCapitalGainWon + otherCapitalGainWon;
  if (profile.isCorporate) {
    const corporateRate = profile.corporateTaxRatePct ?? corporateTaxRateForTaxableIncome(grossReturnWon);
    const corporateTaxWon = grossReturnWon * (corporateRate / 100);
    const bucketTaxWon = interestTaxWon + dividendTaxWon + capitalGainTaxWon;
    comprehensiveTaxWon = Math.max(comprehensiveTaxWon, corporateTaxWon - bucketTaxWon);
  }

  const discounted = applyProportionalDiscount(
    { interestTaxWon, dividendTaxWon, capitalGainTaxWon, comprehensiveTaxWon },
    pensionTaxDiscountWon(interestTaxWon + dividendTaxWon + capitalGainTaxWon + comprehensiveTaxWon, grossReturnWon, profile),
  );
  interestTaxWon = discounted.interestTaxWon;
  dividendTaxWon = discounted.dividendTaxWon;
  capitalGainTaxWon = discounted.capitalGainTaxWon;
  comprehensiveTaxWon = discounted.comprehensiveTaxWon;

  for (const [asset, item] of Object.entries(breakdownSource) as Array<[keyof PortfolioOption["weights"], { grossWon: number; taxWon: number }]>) {
    const split = TAXABLE_RETURN_SPLIT[asset];
    const interestShare = interestIncomeWon > 0 ? (item.grossWon * split.interest) / interestIncomeWon : 0;
    const dividendShare = dividendIncomeWon > 0 ? (item.grossWon * split.dividend) / dividendIncomeWon : 0;
    const capitalShare =
      domesticCapitalGainWon + overseasCapitalGainWon + otherCapitalGainWon > 0
        ? (item.grossWon * split.capitalGain) / (domesticCapitalGainWon + overseasCapitalGainWon + otherCapitalGainWon)
        : 0;
    item.taxWon =
      interestTaxWon * interestShare +
      dividendTaxWon * dividendShare +
      capitalGainTaxWon * capitalShare;
  }

  const scheduledTax = scheduledTaxWon(input.cashFlows, horizonYears);
  const feesWon = principalWon * (feeRatePct / 100) * horizonYears;
  const totalTaxWon = interestTaxWon + dividendTaxWon + capitalGainTaxWon + comprehensiveTaxWon + scheduledTax;
  const netEndingWon = principalWon + grossReturnWon - totalTaxWon - feesWon;
  const investmentTaxesWon = interestTaxWon + dividendTaxWon + capitalGainTaxWon + comprehensiveTaxWon;

  const warnings = [
    "상담용 추정이며 세무 확정·신고 금액이 아닙니다.",
    ...(scheduledTax > 0 ? ["현금흐름의 세금 일정은 투자성과 세금과 별도로 기말자산에서 차감했습니다."] : []),
    ...(profile.isLargeShareholder ? ["대주주 플래그가 켜져 국내주식 양도세율을 높게 적용했습니다."] : []),
    ...(profile.isCorporate ? ["법인 고객은 법인세 간이세율을 종합/법인세 항목에 반영했습니다."] : []),
  ];

  return {
    label,
    principalWon: roundWon(principalWon),
    grossReturnWon: roundWon(grossReturnWon),
    taxes: {
      interestTaxWon: roundWon(interestTaxWon),
      dividendTaxWon: roundWon(dividendTaxWon),
      capitalGainTaxWon: roundWon(capitalGainTaxWon),
      comprehensiveTaxWon: roundWon(comprehensiveTaxWon),
      scheduledTaxWon: roundWon(scheduledTax),
      totalTaxWon: roundWon(totalTaxWon),
    },
    feesWon: roundWon(feesWon),
    netEndingWon: roundWon(netEndingWon),
    effectiveTaxRatePct: grossReturnWon > 0 ? roundPct((investmentTaxesWon / grossReturnWon) * 100) : 0,
    preTaxReturnPct: principalWon > 0 ? roundPct((grossReturnWon / principalWon) * 100) : 0,
    afterTaxReturnPct: principalWon > 0 ? roundPct(((netEndingWon - principalWon) / principalWon) * 100) : 0,
    breakdownByAsset: (Object.entries(breakdownSource) as Array<[keyof PortfolioOption["weights"], { grossWon: number; taxWon: number }]>)
      .filter(([, item]) => Math.abs(item.grossWon) >= 1)
      .map(([asset, item]) => ({ asset: ASSET_LABELS[asset], grossWon: roundWon(item.grossWon), taxWon: roundWon(item.taxWon) })),
    assumptions: [
      ...TAX_PROJECTION_ASSUMPTIONS,
      `ETF 차익 국내 ${roundPct(domesticEquityRatio * 100)}% / 해외 ${roundPct(overseasEquityRatio * 100)}%`,
      `수익률은 현재 포트폴리오 비중 기반 기대수익률 ${expectedReturnPct}%를 자산군별 세전 수익으로 분해했습니다.`,
    ],
    warnings,
  };
}

export function compareTaxProjections(
  base: TaxProjectionResult,
  adjusted: TaxProjectionResult,
): TaxProjectionComparison {
  const deltaGrossReturnWon = adjusted.grossReturnWon - base.grossReturnWon;
  const deltaTotalTaxWon = adjusted.taxes.totalTaxWon - base.taxes.totalTaxWon;
  const deltaFeesWon = adjusted.feesWon - base.feesWon;
  const deltaNetEndingWon = adjusted.netEndingWon - base.netEndingWon;
  const deltaEffectiveTaxRatePct = roundPct(adjusted.effectiveTaxRatePct - base.effectiveTaxRatePct);
  const deltaAfterTaxReturnPct = roundPct(adjusted.afterTaxReturnPct - base.afterTaxReturnPct);

  const summary = [
    deltaNetEndingWon >= 0
      ? `조정안 세후 기말자산이 기준안보다 ${Math.abs(deltaNetEndingWon).toLocaleString("ko-KR")}원 증가합니다.`
      : `조정안 세후 기말자산이 기준안보다 ${Math.abs(deltaNetEndingWon).toLocaleString("ko-KR")}원 감소합니다.`,
    deltaTotalTaxWon >= 0
      ? `총 세금은 ${Math.abs(deltaTotalTaxWon).toLocaleString("ko-KR")}원 증가합니다.`
      : `총 세금은 ${Math.abs(deltaTotalTaxWon).toLocaleString("ko-KR")}원 감소합니다.`,
    `세후수익률 변화는 ${deltaAfterTaxReturnPct >= 0 ? "+" : ""}${deltaAfterTaxReturnPct}%p입니다.`,
  ];

  return {
    deltaGrossReturnWon,
    deltaTotalTaxWon,
    deltaFeesWon,
    deltaNetEndingWon,
    deltaEffectiveTaxRatePct,
    deltaAfterTaxReturnPct,
    summary,
  };
}

export function inferTaxProfile(client: Client): TaxProfile {
  const fullText = [
    client.ips.tax.value,
    client.ips.tax.notes,
    client.ips.tax.inferenceHint,
    client.ips.unique.value,
    client.ips.unique.notes,
    client.consultationNotes,
  ].join(" ");
  const mentionsOverseas = /해외|미국|나스닥|S&P|sp500|외화|달러/i.test(fullText);
  const mentionsDomestic = /국내|코스피|상장주식|삼성전자|하이닉스/i.test(fullText);
  const annualFinancialIncomeWon =
    /금융소득종합과세|종합과세/i.test(fullText)
      ? 30_000_000
      : client.assetSize >= 5_000_000_000
        ? 25_000_000
        : client.assetSize >= 1_000_000_000
          ? 12_000_000
          : 5_000_000;
  const marginalTaxRatePct = client.assetSize >= 10_000_000_000 ? 38 : client.assetSize >= 3_000_000_000 ? 35 : 24;
  const overseasEquityPct = mentionsOverseas && !mentionsDomestic ? 70 : 60;
  const domesticEquityPct = 100 - overseasEquityPct;
  const isCorporate = client.clientType === "corporate";

  return {
    annualFinancialIncomeWon,
    marginalTaxRatePct,
    domesticEquityPct,
    overseasEquityPct,
    avgHoldingMonths: 12,
    pensionAccountPct: /연금|IRP|irp|퇴직/i.test(fullText) ? 10 : 0,
    isLargeShareholder: Boolean(client.isMajorityShareholder) || /대주주|최대주주|majority/i.test(fullText),
    feeRatePct: DEFAULT_FEE_RATE_PCT,
    isCorporate,
    corporateTaxRatePct: isCorporate ? corporateTaxRateForTaxableIncome(Math.max(0, client.assetSize * 0.04)) : undefined,
  };
}

export function taxProfileQuestions(client: Client): TaxProfileQuestion[] {
  const profile = inferTaxProfile(client);
  const fullText = [
    client.ips.tax.value,
    client.ips.tax.notes,
    client.ips.unique.value,
    client.consultationNotes,
  ].join(" ");
  const hasScheduledTax = client.cashFlows.some(
    (flow) =>
      flow.amount < 0 &&
      TAX_FLOW_PATTERN.test(`${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""}`),
  );
  const questions: TaxProfileQuestion[] = [];

  questions.push({
    code: "T-1",
    title: "기존 금융소득 확인",
    question: "올해 이미 발생했거나 예정된 이자·배당 금융소득 합계가 얼마인가요?",
    reason: `현재 간이 추정값은 ${Math.round((profile.annualFinancialIncomeWon ?? 0) / 10_000).toLocaleString("ko-KR")}만원이며, 2,000만원 초과 시 종합과세 추가분이 달라집니다.`,
    severity: (profile.annualFinancialIncomeWon ?? 0) >= FINANCIAL_INCOME_COMPREHENSIVE_THRESHOLD_WON ? "상" : "중",
  });
  questions.push({
    code: "T-2",
    title: "대주주·특수관계자 여부",
    question: "국내 상장주식 대주주 요건 또는 특수관계자 합산 지분율에 해당하나요?",
    reason: "대주주 플래그가 켜지면 국내주식 양도세율을 27.5%로 높여 민감도를 봅니다.",
    severity: profile.isLargeShareholder ? "상" : "중",
  });
  questions.push({
    code: "T-3",
    title: "국내/해외 ETF 비중",
    question: "ETF·주식 버킷 안에서 국내주식과 해외주식의 실제 비중은 어떻게 나뉘나요?",
    reason: "국내/해외 양도세 적용이 달라 세후 기말자산이 바뀝니다.",
    severity: "중",
  });
  questions.push({
    code: "T-4",
    title: "연금·IRP 계좌 활용",
    question: "이번 포트폴리오 중 연금저축·IRP·과세이연 계좌에 담을 비중이 있나요?",
    reason: "연금·IRP 비중은 해당 수익분의 세금 부담을 0.5~1%p 낮추는 간이 효과로 반영합니다.",
    severity: "하",
  });
  if (hasScheduledTax) {
    questions.push({
      code: "T-5",
      title: "세금 납부 일정 확정",
      question: "증여세·상속세·양도세·법인세의 납부월과 금액이 확정되었나요?",
      reason: "현금흐름 세금 일정은 투자성과 세금과 별도로 세후 기말자산에서 차감됩니다.",
      severity: "상",
    });
  }
  if (client.clientType === "corporate") {
    questions.push({
      code: "T-6",
      title: "법인세율 구간 확인",
      question: "법인 과세표준 예상 구간과 이월결손금·세액공제 여부를 확인했나요?",
      reason: "MVP는 9~24% 법인세율 구간만 단순 적용합니다.",
      severity: "중",
    });
  }

  return questions.filter((question) => !/확정|확인완료/i.test(fullText) || question.severity !== "하");
}
