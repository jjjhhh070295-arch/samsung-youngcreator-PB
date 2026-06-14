import type { Portfolio, ScenarioShock } from "../types";
import { FACTOR_IDS } from "../stresstest";
import { findSensitivity } from "../sensitivities";

export interface MonteCarloSummary {
  portfolioId: string;
  label: string;
  simulations: number;
  meanReturn: number;
  volatility: number;
  var95: number;
  cvar95: number;
  probabilityOfLoss: number;
  probabilityBelowMinus10: number;
  worstReturn: number;
  bestReturn: number;
  histogram: { bucket: string; count: number }[];
}

export interface MonteCarloOptions {
  simulations?: number;
  seed?: number;
  horizonMonths?: number;
}

const DEFAULT_SIMULATIONS = 5000;
const ASSET_CORRELATION = 0.35;
const T_DF = 5;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number) {
  const u1 = Math.max(rand(), Number.EPSILON);
  const u2 = Math.max(rand(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function chiSquare(rand: () => number, df: number) {
  let total = 0;
  for (let i = 0; i < df; i += 1) {
    const z = normal(rand);
    total += z * z;
  }
  return total;
}

function studentT(rand: () => number, df = T_DF) {
  return normal(rand) / Math.sqrt(chiSquare(rand, df) / df);
}

function scenarioImpact(assetClass: string, shock: ScenarioShock) {
  const sens = findSensitivity(assetClass);
  return FACTOR_IDS.reduce((sum, id) => sum + sens.betas[id] * shock[id], 0);
}

function percentile(sortedAsc: number[], p: number) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(sortedAsc.length * p) - 1));
  return sortedAsc[idx];
}

function buildHistogram(values: number[]) {
  const edges = [-30, -20, -15, -10, -5, 0, 5, 10, 15, 20, 30];
  const buckets = [
    "-30% 미만",
    "-30~-20%",
    "-20~-15%",
    "-15~-10%",
    "-10~-5%",
    "-5~0%",
    "0~5%",
    "5~10%",
    "10~15%",
    "15~20%",
    "20~30%",
    "30% 초과",
  ].map((bucket) => ({ bucket, count: 0 }));

  for (const value of values) {
    let index = edges.findIndex((edge) => value < edge);
    if (index === -1) index = buckets.length - 1;
    buckets[index].count += 1;
  }

  return buckets;
}

export function runMonteCarloCvar(
  portfolio: Portfolio,
  shock: ScenarioShock,
  options: MonteCarloOptions = {},
): MonteCarloSummary {
  const simulations = options.simulations ?? DEFAULT_SIMULATIONS;
  const horizonMonths = options.horizonMonths ?? 12;
  const rand = mulberry32(options.seed ?? 20260614);
  const horizonScale = Math.sqrt(horizonMonths);
  const monthlyDrift = portfolio.expectedReturn / 12;

  const assetInputs = portfolio.allocations.map((allocation) => {
    const sens = findSensitivity(allocation.assetClass);
    return {
      allocation,
      annualScenarioImpact: scenarioImpact(allocation.assetClass, shock),
      monthlyVol: sens.monthlyVol,
    };
  });

  const returns: number[] = [];
  for (let i = 0; i < simulations; i += 1) {
    const commonShock = studentT(rand);
    let portfolioReturn = 0;

    for (const item of assetInputs) {
      const idiosyncraticShock = studentT(rand);
      const correlatedShock =
        Math.sqrt(ASSET_CORRELATION) * commonShock +
        Math.sqrt(1 - ASSET_CORRELATION) * idiosyncraticShock;
      const stochasticMove = item.monthlyVol * horizonScale * correlatedShock;
      const assetReturn = monthlyDrift * horizonMonths + item.annualScenarioImpact + stochasticMove;
      portfolioReturn += (item.allocation.weight / 100) * assetReturn;
    }

    returns.push(portfolioReturn);
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    Math.max(1, returns.length - 1);
  const varCutoff = percentile(sorted, 0.05);
  const tail = sorted.filter((value) => value <= varCutoff);
  const cvar = tail.reduce((sum, value) => sum + value, 0) / Math.max(1, tail.length);

  return {
    portfolioId: portfolio.id,
    label: portfolio.label,
    simulations,
    meanReturn: r1(mean),
    volatility: r1(Math.sqrt(variance)),
    var95: r1(varCutoff),
    cvar95: r1(cvar),
    probabilityOfLoss: r2((returns.filter((value) => value < 0).length / returns.length) * 100),
    probabilityBelowMinus10: r2((returns.filter((value) => value < -10).length / returns.length) * 100),
    worstReturn: r1(sorted[0] ?? 0),
    bestReturn: r1(sorted[sorted.length - 1] ?? 0),
    histogram: buildHistogram(returns),
  };
}
