export const CREDIT_RATINGS = ["AAA", "AA", "A", "BBB", "BB 이하", "무등급"] as const;

export type CreditRating = (typeof CREDIT_RATINGS)[number];
export type MicroRiskLevel = "safe" | "watch" | "danger";
export type CompanySize = "sme" | "middle" | "large";

export type MicroStressInput = {
  annualRevenue: number;
  ebitdaMargin: number;
  annualRentalIncomeCurrent: number;
  currentVacancyRate: number;
  cashBuffer: number;
  totalDebt: number;
  floatingDebt: number;
  refinancingDebtWithinYear: number;
  averageBorrowingRate: number;
  currentRating: CreditRating;
  currentRatio: number;
  debtToEquityRatio: number;
  interestCoverageRatio: number;
  receivablesDays: number;
  inventoryDays: number;
  eventLiquidityNeed: number;
};

export type MicroStressScenario = {
  revenueShock: number;
  marginShockPp: number;
  vacancyShockPp: number;
  fundingSpreadShockBp: number;
  ratingDowngradeNotches: number;
  receivablesDelayDays: number;
  inventoryDelayDays: number;
  shortTermDebtConcentrationPct: number;
};

export type MicroStressModifiers = {
  portfolioSensitivity: number;
  fundingSensitivity: number;
  companySize: CompanySize;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

const positive = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

export function normalizeCreditRating(value: string): CreditRating {
  const normalized = value.trim().toUpperCase().replace(/[+-]/g, "");
  if (normalized === "AAA") return "AAA";
  if (normalized === "AA") return "AA";
  if (normalized === "A") return "A";
  if (normalized === "BBB") return "BBB";
  if (normalized.includes("BB")) return "BB 이하";
  if (normalized.includes("무") || normalized.includes("NR") || normalized.includes("NONE")) {
    return "무등급";
  }
  return "무등급";
}

export function calculateRatingSpreadShockBp(downgradeNotches: number) {
  return clamp(downgradeNotches, 0, 3) * 50;
}

export function calculateMicroStress(
  input: MicroStressInput,
  scenario: MicroStressScenario,
  modifiers: MicroStressModifiers = {
    portfolioSensitivity: 1,
    fundingSensitivity: 1,
    companySize: "middle",
  },
) {
  const annualRevenue = positive(input.annualRevenue);
  const ebitdaMargin = clamp(input.ebitdaMargin, 0, 60);
  const rentalIncome = positive(input.annualRentalIncomeCurrent);
  const cashBuffer = positive(input.cashBuffer);
  const totalDebt = positive(input.totalDebt);
  const floatingDebt = Math.min(totalDebt, positive(input.floatingDebt));
  const refinancingDebtWithinYear = Math.min(totalDebt, positive(input.refinancingDebtWithinYear));
  const averageBorrowingRate = positive(input.averageBorrowingRate);
  const portfolioSensitivity = positive(modifiers.portfolioSensitivity || 1);
  const fundingSensitivity = positive(modifiers.fundingSensitivity || 1);

  const baseEbitda = annualRevenue * (ebitdaMargin / 100);
  const stressedRevenue = annualRevenue * (1 + Math.min(0, scenario.revenueShock));
  const stressedMargin = clamp(ebitdaMargin + Math.min(0, scenario.marginShockPp), 0, 60);
  const stressedEbitda = stressedRevenue * (stressedMargin / 100);
  const revenueLoss = Math.max(0, annualRevenue - stressedRevenue);
  const operatingCashflowLoss = Math.max(0, baseEbitda - stressedEbitda);

  const currentOccupancyRate = clamp(1 - positive(input.currentVacancyRate) / 100, 0.05, 1);
  const stressedVacancyRate = clamp(
    positive(input.currentVacancyRate) + positive(scenario.vacancyShockPp),
    0,
    95,
  );
  const stressedOccupancyRate = clamp(1 - stressedVacancyRate / 100, 0.01, 1);
  const stressedRentalIncome = rentalIncome * (stressedOccupancyRate / currentOccupancyRate);
  const rentalIncomeLoss = Math.max(0, rentalIncome - stressedRentalIncome);

  const ratingSpreadShockBp = calculateRatingSpreadShockBp(
    scenario.ratingDowngradeNotches,
  );
  const fundingRateShockBp =
    (positive(scenario.fundingSpreadShockBp) + ratingSpreadShockBp) * fundingSensitivity;
  const fundingRateShockPct = fundingRateShockBp / 100;
  const fundingRateShockDecimal = fundingRateShockBp / 10000;
  const additionalInterestCost = floatingDebt * fundingRateShockDecimal;
  const refinancingConcentration = clamp(
    scenario.shortTermDebtConcentrationPct,
    0,
    100,
  ) / 100;
  const refinancingBurdenIncrease =
    refinancingDebtWithinYear * fundingRateShockDecimal * refinancingConcentration;

  const receivablesStressNeed =
    (annualRevenue / 365) * positive(scenario.receivablesDelayDays);
  const inventoryStressNeed =
    (annualRevenue * 0.55 / 365) * positive(scenario.inventoryDelayDays);
  const workingCapitalBurdenIncrease = receivablesStressNeed + inventoryStressNeed;

  const liquidityStressBeforePortfolio =
    operatingCashflowLoss +
    rentalIncomeLoss +
    additionalInterestCost +
    refinancingBurdenIncrease +
    workingCapitalBurdenIncrease;
  const liquidityStressAfterPortfolio =
    liquidityStressBeforePortfolio * portfolioSensitivity;
  const stressUseOfCash =
    positive(input.eventLiquidityNeed) + liquidityStressAfterPortfolio;
  const liquidityGap = stressUseOfCash - cashBuffer;

  const baselineInterestExpense = Math.max(totalDebt * (averageBorrowingRate / 100), 0.01);
  const stressedInterestExpense =
    baselineInterestExpense + additionalInterestCost + refinancingBurdenIncrease;
  const stressedInterestCoverage = stressedEbitda / Math.max(stressedInterestExpense, 0.01);
  const workingCapitalBase = Math.max(annualRevenue * 0.12, 1);
  const stressedCurrentRatio = Math.max(
    0.1,
    positive(input.currentRatio) -
      (workingCapitalBurdenIncrease + Math.max(0, liquidityGap)) / workingCapitalBase,
  );
  const stressedDebtToEbitda = totalDebt / Math.max(stressedEbitda, 0.1);
  const stressedReceivablesDays =
    positive(input.receivablesDays) + positive(scenario.receivablesDelayDays);
  const stressedInventoryDays =
    positive(input.inventoryDays) + positive(scenario.inventoryDelayDays);

  const monthlyCashBurn = Math.max(
    liquidityStressAfterPortfolio / 12,
    0.01,
  );
  const survivalMonths = cashBuffer / monthlyCashBurn;

  let creditWarningLevel: MicroRiskLevel = "safe";
  if (
    scenario.ratingDowngradeNotches >= 3 ||
    fundingRateShockBp >= 350 ||
    input.currentRating === "무등급"
  ) {
    creditWarningLevel = "danger";
  } else if (scenario.ratingDowngradeNotches >= 1 || fundingRateShockBp >= 150) {
    creditWarningLevel = "watch";
  }

  let riskLevel: MicroRiskLevel = "watch";
  if (
    liquidityGap <= 0 &&
    stressedInterestCoverage >= 3 &&
    stressedCurrentRatio >= 1.2 &&
    creditWarningLevel !== "danger"
  ) {
    riskLevel = "safe";
  } else if (
    liquidityGap > Math.max(2, cashBuffer * 0.6) ||
    stressedInterestCoverage < 1.5 ||
    stressedCurrentRatio < 0.9 ||
    stressedDebtToEbitda >= 6 ||
    creditWarningLevel === "danger"
  ) {
    riskLevel = "danger";
  }

  return {
    revenueLoss,
    operatingCashflowLoss,
    rentalIncomeLoss,
    ratingSpreadShockBp,
    fundingRateShockBp,
    fundingRateShockPct,
    additionalInterestCost,
    refinancingBurdenIncrease,
    workingCapitalBurdenIncrease,
    liquidityStressBeforePortfolio,
    liquidityStressAfterPortfolio,
    stressUseOfCash,
    liquidityGap,
    survivalMonths,
    baseEbitda,
    stressedEbitda,
    stressedInterestCoverage,
    stressedCurrentRatio,
    stressedDebtToEbitda,
    stressedReceivablesDays,
    stressedInventoryDays,
    creditWarningLevel,
    riskLevel,
  };
}
