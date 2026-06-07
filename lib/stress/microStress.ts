export type MicroStressInput = {
  annualRevenue: number;
  ebitdaMargin: number;
  operatingLeverage: number;
  annualRentalIncomeCurrent: number;
  currentVacancyRate: number;
  floatingDebt: number;
  creditBondAmount: number;
  creditDuration: number;
  cashBuffer: number;
  eventLiquidityNeed: number;
  forcedSale: boolean;
};

export type MicroStressScenario = {
  revenueShock: number;
  vacancyShockPp: number;
  spreadShockBp: number;
  fundingSpreadShockBp: number;
};

export function calculateMicroStress(
  input: MicroStressInput,
  scenario: MicroStressScenario
) {
  const revenueLoss = input.annualRevenue * Math.abs(scenario.revenueShock);

  const operatingCashflowLoss =
    revenueLoss * (input.ebitdaMargin / 100) * input.operatingLeverage;

  const currentOccupancyRate = Math.max(
    1 - input.currentVacancyRate / 100,
    0.1
  );

  const rentalIncomeLoss =
    input.annualRentalIncomeCurrent *
    (scenario.vacancyShockPp / 100) /
    currentOccupancyRate;

  const creditAssetLoss =
    input.creditBondAmount *
    input.creditDuration *
    (scenario.spreadShockBp / 10000);

  const additionalInterestCost =
    input.floatingDebt * (scenario.fundingSpreadShockBp / 10000);

  const cashflowStress =
    operatingCashflowLoss + rentalIncomeLoss + additionalInterestCost;

  const liquidityGapWithoutForcedSale =
    input.eventLiquidityNeed + cashflowStress - input.cashBuffer;

  const liquidityGapWithForcedSale =
    liquidityGapWithoutForcedSale + creditAssetLoss;

  const liquidityGap = input.forcedSale
    ? liquidityGapWithForcedSale
    : liquidityGapWithoutForcedSale;

  const monthlyCashBurn = Math.max(cashflowStress / 12, 0.01);
  const survivalMonths = input.cashBuffer / monthlyCashBurn;

  const riskLevel =
    liquidityGap <= 0 ? "safe" : survivalMonths >= 9 ? "watch" : "danger";

  return {
    revenueLoss,
    operatingCashflowLoss,
    rentalIncomeLoss,
    creditAssetLoss,
    additionalInterestCost,
    cashflowStress,
    liquidityGapWithoutForcedSale,
    liquidityGapWithForcedSale,
    liquidityGap,
    survivalMonths,
    riskLevel,
  };
}
