import type { AssetAllocation } from "./types";

export interface BenchmarkApiPoint {
  date: string;
  label: string;
  sp500?: number | null;
  kospi?: number | null;
  usTreasury10y?: number | null;
  bond?: number | null;
  gold?: number | null;
  dollar?: number | null;
  commodity?: number | null;
}

export interface BenchmarkApiResponse {
  ok?: boolean;
  source?: string;
  fallback?: boolean;
  updatedAt?: string;
  points?: BenchmarkApiPoint[];
}

export type PortfolioBacktestPoint = BenchmarkApiPoint & {
  portfolio: number;
  blendedBenchmark: number;
};

export const FALLBACK_BENCHMARK_POINTS: BenchmarkApiPoint[] = [
  { date: "fallback-0", label: "12M 전", sp500: 0, kospi: 0, usTreasury10y: 0, bond: 0, gold: 0, dollar: 0, commodity: 0 },
  { date: "fallback-1", label: "11M 전", sp500: -1.1, kospi: -2.0, usTreasury10y: 0.2, bond: 0.2, gold: 1.6, dollar: -0.4, commodity: -1.7 },
  { date: "fallback-2", label: "10M 전", sp500: -0.2, kospi: 1.8, usTreasury10y: -0.3, bond: -0.3, gold: 0.7, dollar: 0.8, commodity: -0.6 },
  { date: "fallback-3", label: "9M 전", sp500: 2.1, kospi: 0.9, usTreasury10y: 0.1, bond: 0.1, gold: 3.9, dollar: 1.1, commodity: 1.5 },
  { date: "fallback-4", label: "8M 전", sp500: 3.7, kospi: 4.4, usTreasury10y: 0.8, bond: 0.8, gold: 5.4, dollar: -0.2, commodity: 0.2 },
  { date: "fallback-5", label: "7M 전", sp500: 1.9, kospi: 3.1, usTreasury10y: 0.4, bond: 0.4, gold: 4.8, dollar: 1.7, commodity: 2.8 },
  { date: "fallback-6", label: "6M 전", sp500: 5.2, kospi: 6.8, usTreasury10y: 1.1, bond: 1.1, gold: 7.2, dollar: 1.2, commodity: 1.9 },
  { date: "fallback-7", label: "5M 전", sp500: 4.3, kospi: 5.3, usTreasury10y: 1.0, bond: 1.0, gold: 6.1, dollar: 2.4, commodity: 4.1 },
  { date: "fallback-8", label: "4M 전", sp500: 7.1, kospi: 9.5, usTreasury10y: 1.7, bond: 1.7, gold: 10.4, dollar: 1.6, commodity: 3.2 },
  { date: "fallback-9", label: "3M 전", sp500: 6.4, kospi: 7.7, usTreasury10y: 1.4, bond: 1.4, gold: 9.2, dollar: 2.9, commodity: 5.6 },
  { date: "fallback-10", label: "2M 전", sp500: 8.8, kospi: 11.1, usTreasury10y: 2.0, bond: 2.0, gold: 12.7, dollar: 2.0, commodity: 4.3 },
  { date: "fallback-11", label: "1M 전", sp500: 7.6, kospi: 9.4, usTreasury10y: 1.8, bond: 1.8, gold: 10.8, dollar: 1.3, commodity: 3.8 },
  { date: "fallback-12", label: "현재", sp500: 9.2, kospi: 6.4, usTreasury10y: 2.2, bond: 2.2, gold: 11.6, dollar: 1.8, commodity: 4.9 },
];

function finiteNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function fixedIncomeProxy(index: number, total: number, annualReturn: number) {
  if (total <= 1) return 0;
  return (Math.pow(1 + annualReturn / 100, index / (total - 1)) - 1) * 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function bucketForAssetClass(assetClass: string): "equity" | "bond" | "cash" | "gold" | "dollar" | "commodity" {
  if (/주식|ETF|Equity/i.test(assetClass)) return "equity";
  if (/채권|Bond/i.test(assetClass)) return "bond";
  if (/현금|MMF|RP|CMA|Cash/i.test(assetClass)) return "cash";
  if (/금|Gold/i.test(assetClass)) return "gold";
  if (/달러|환|Dollar|FX/i.test(assetClass)) return "dollar";
  return "commodity";
}

export function buildPortfolioBacktestSeries(
  allocations: AssetAllocation[],
  points: BenchmarkApiPoint[] = FALLBACK_BENCHMARK_POINTS,
  alphaPct = 3.5,
): PortfolioBacktestPoint[] {
  const sourcePoints = points.length >= 2 ? points : FALLBACK_BENCHMARK_POINTS;
  const total = sourcePoints.length;
  const totalWeight = allocations.reduce((sum, allocation) => sum + allocation.weight, 0) || 100;

  return sourcePoints.map((point, index) => {
    const sp500 = finiteNumber(point.sp500);
    const kospi = finiteNumber(point.kospi, sp500);
    const usTreasury10y = finiteNumber(point.usTreasury10y, finiteNumber(point.bond, fixedIncomeProxy(index, total, 3.2)));
    const cash = fixedIncomeProxy(index, total, 3.0);
    const gold = finiteNumber(point.gold, fixedIncomeProxy(index, total, 4.0));
    const dollar = finiteNumber(point.dollar, fixedIncomeProxy(index, total, 2.3));
    const commodity = finiteNumber(point.commodity, fixedIncomeProxy(index, total, 3.6));
    const bucketReturns = {
      equity: kospi * 0.4 + sp500 * 0.6,
      bond: usTreasury10y,
      cash,
      gold,
      dollar,
      commodity,
    };
    const blendedBenchmark = allocations.reduce((sum, allocation) => {
      const bucket = bucketForAssetClass(allocation.assetClass);
      return sum + (allocation.weight / totalWeight) * bucketReturns[bucket];
    }, 0);
    const progress = total <= 1 ? 1 : index / (total - 1);

    return {
      ...point,
      sp500: roundPercent(sp500),
      kospi: roundPercent(kospi),
      usTreasury10y: roundPercent(usTreasury10y),
      portfolio: roundPercent(blendedBenchmark + alphaPct * progress),
      blendedBenchmark: roundPercent(blendedBenchmark),
    };
  });
}
