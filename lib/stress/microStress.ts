export const CREDIT_RATINGS = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"] as const;

export type CreditRating = (typeof CREDIT_RATINGS)[number];
export type MicroRiskLevel = "safe" | "watch" | "danger";

export type MicroStressInput = {
  annualRevenue: number;
  ebitdaMargin: number;
  operatingLeverage: number;
  annualRentalIncomeCurrent: number;
  currentVacancyRate: number;
  totalDebt: number;
  floatingDebt: number;
  maturingDebtWithinYear: number;
  averageFundingRate: number;
  currentRating: CreditRating;
  cashBuffer: number;
  eventLiquidityNeed: number;
  currentRatio: number;
  debtToEquityRatio: number;
  interestCoverageRatio: number;
  receivablesDays: number;
  inventoryDays: number;
  forcedRefinancing: boolean;
};

export type MicroStressScenario = {
  revenueShock: number;
  marginShockPp: number;
  vacancyShockPp: number;
  rentShock: number;
  fundingSpreadShockBp: number;
  ratingDowngradeNotches: number;
  workingCapitalShockPct: number;
  collectionDelayDays: number;
};

const ratingSpreadPerNotchBp: Record<CreditRating, number> = {
  AAA: 25,
  AA: 35,
  A: 50,
  BBB: 75,
  BB: 120,
  B: 180,
  CCC: 280,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function normalizeCreditRating(value: string): CreditRating {
  const upper = value.toUpperCase().replace(/[+-]/g, "");
  if (upper === "AAA") return "AAA";
  if (upper === "AA") return "AA";
  if (upper === "A") return "A";
  if (upper === "BBB") return "BBB";
  if (upper === "BB") return "BB";
  if (upper === "B") return "B";
  return "CCC";
}

export function calculateRatingSpreadShockBp(
  rating: CreditRating,
  downgradeNotches: number,
) {
  return ratingSpreadPerNotchBp[rating] * Math.max(0, downgradeNotches);
}

export function calculateMicroStress(
  input: MicroStressInput,
  scenario: MicroStressScenario,
) {
  const annualRevenue = Math.max(0, input.annualRevenue);
  const ebitdaMargin = clamp(input.ebitdaMargin, -20, 60);
  const operatingLeverage = clamp(input.operatingLeverage, 0.1, 5);
  const totalDebt = Math.max(0, input.totalDebt);
  const normalDebtExposure = Math.min(
    totalDebt,
    Math.max(0, input.floatingDebt) + Math.max(0, input.maturingDebtWithinYear),
  );
  const exposedDebt = input.forcedRefinancing ? totalDebt : normalDebtExposure;

  const baseEbitda = annualRevenue * (ebitdaMargin / 100);
  const stressedRevenue = annualRevenue * (1 + Math.min(0, scenario.revenueShock));
  const stressedMargin = clamp(ebitdaMargin + scenario.marginShockPp, -20, 60);
  const stressedEbitda = Math.max(0, stressedRevenue * (stressedMargin / 100));

  const revenueLoss = Math.max(0, annualRevenue - stressedRevenue);
  const marginCashflowLoss = Math.max(0, baseEbitda - stressedEbitda);
  const operatingCashflowLoss = marginCashflowLoss * operatingLeverage;

  const currentOccupancyRate = clamp(1 - input.currentVacancyRate / 100, 0.05, 1);
  const stressedVacancyRate = clamp(
    input.currentVacancyRate + scenario.vacancyShockPp,
    0,
    95,
  );
  const stressedOccupancyRate = clamp(1 - stressedVacancyRate / 100, 0.01, 1);
  const stressedRentFactor = clamp(1 + scenario.rentShock, 0.2, 1.5);
  const stressedRentalIncome =
    Math.max(0, input.annualRentalIncomeCurrent) *
    (stressedOccupancyRate / currentOccupancyRate) *
    stressedRentFactor;
  const rentalIncomeLoss = Math.max(
    0,
    Math.max(0, input.annualRentalIncomeCurrent) - stressedRentalIncome,
  );

  const marketSpreadInterestCost =
    exposedDebt * (Math.max(0, scenario.fundingSpreadShockBp) / 10000);
  const ratingSpreadShockBp = calculateRatingSpreadShockBp(
    input.currentRating,
    scenario.ratingDowngradeNotches,
  );
  const ratingDowngradeInterestCost = exposedDebt * (ratingSpreadShockBp / 10000);
  const additionalInterestCost =
    marketSpreadInterestCost + ratingDowngradeInterestCost;

  const collectionDelayNeed =
    (annualRevenue / 365) * Math.max(0, scenario.collectionDelayDays);
  const workingCapitalShockNeed =
    annualRevenue * (Math.max(0, scenario.workingCapitalShockPct) / 100);
  const workingCapitalNeed = collectionDelayNeed + workingCapitalShockNeed;

  const baselineInterestExpense =
    totalDebt * (Math.max(0, input.averageFundingRate) / 100);
  const stressedInterestExpense = Math.max(
    baselineInterestExpense + additionalInterestCost,
    0.01,
  );
  const stressedInterestCoverage = stressedEbitda / stressedInterestExpense;
  const stressedDebtToEbitda = totalDebt / Math.max(stressedEbitda, 0.1);

  const covenantLiquidityNeed =
    scenario.ratingDowngradeNotches <= 0
      ? 0
      : totalDebt *
        (0.005 * Math.max(0, scenario.ratingDowngradeNotches) +
          (stressedInterestCoverage < 2 ? 0.01 : 0) +
          (input.currentRatio < 1.1 ? 0.01 : 0));

  const cashflowStress =
    operatingCashflowLoss + rentalIncomeLoss + additionalInterestCost;
  const stressUseOfCash =
    input.eventLiquidityNeed +
    cashflowStress +
    workingCapitalNeed +
    covenantLiquidityNeed;
  const liquidityGap = stressUseOfCash - input.cashBuffer;
  const monthlyCashBurn = Math.max(
    (cashflowStress + workingCapitalNeed + covenantLiquidityNeed) / 12,
    0.01,
  );
  const survivalMonths = input.cashBuffer / monthlyCashBurn;

  const workingCapitalBase = Math.max(annualRevenue * 0.12, 1);
  const stressedCurrentRatio = Math.max(
    0.1,
    input.currentRatio - (workingCapitalNeed + Math.max(0, liquidityGap)) / workingCapitalBase,
  );

  let riskLevel: MicroRiskLevel = "watch";
  if (
    liquidityGap <= 0 &&
    stressedInterestCoverage >= 3 &&
    stressedCurrentRatio >= 1.2
  ) {
    riskLevel = "safe";
  } else if (
    liquidityGap > Math.max(2, input.cashBuffer * 0.6) ||
    stressedInterestCoverage < 1.5 ||
    stressedCurrentRatio < 0.9 ||
    stressedDebtToEbitda >= 6
  ) {
    riskLevel = "danger";
  }

  return {
    revenueLoss,
    operatingCashflowLoss,
    rentalIncomeLoss,
    marketSpreadInterestCost,
    ratingSpreadShockBp,
    ratingDowngradeInterestCost,
    additionalInterestCost,
    workingCapitalNeed,
    covenantLiquidityNeed,
    cashflowStress,
    stressUseOfCash,
    liquidityGap,
    survivalMonths,
    baseEbitda,
    stressedEbitda,
    stressedInterestCoverage,
    stressedCurrentRatio,
    stressedDebtToEbitda,
    exposedDebt,
    riskLevel,
  };
}
