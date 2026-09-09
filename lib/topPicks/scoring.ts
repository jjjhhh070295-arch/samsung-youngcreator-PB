import type {
  ConsensusInputs,
  FundamentalInputs,
  PickType,
  PriceInputs,
  ResearchObservation,
  ScoreInput,
  ScoredStock,
} from "./types";

const HALF_LIFE_DAYS = 5;
const DAY_MS = 86_400_000;

export const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Linear normalization with explicit bounds. No missing value is fabricated. */
export function normalize(value: number | null | undefined, low: number, high: number): number | null {
  if (!finite(value) || high <= low) return null;
  return clamp(((value - low) / (high - low)) * 100);
}

function weightedAvailable(parts: Array<[number | null, number]>, neutralWhenEmpty = 50): number {
  const available = parts.filter((part): part is [number, number] => finite(part[0]));
  if (!available.length) return neutralWhenEmpty;
  const weight = available.reduce((sum, [, w]) => sum + w, 0);
  return clamp(available.reduce((sum, [score, w]) => sum + score * w, 0) / weight);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function exponentialDecay(publishedAt: string, now = new Date()): number {
  const timestamp = new Date(publishedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const daysAgo = Math.max(0, (now.getTime() - timestamp) / DAY_MS);
  return Math.exp(-(Math.log(2) / HALF_LIFE_DAYS) * daysAgo);
}

function decayedAverage(
  reports: ResearchObservation[],
  value: (report: ResearchObservation) => number | null,
  now: Date,
): number | null {
  const rows = reports
    .map((report) => ({ value: value(report), weight: exponentialDecay(report.publishedAt, now) }))
    .filter((row): row is { value: number; weight: number } => finite(row.value) && row.weight > 0);
  if (!rows.length) return null;
  const denominator = rows.reduce((sum, row) => sum + row.weight, 0);
  return rows.reduce((sum, row) => sum + row.value * row.weight, 0) / denominator;
}

export function calculateResearchScore(reports: ResearchObservation[], now = new Date()) {
  const epsRaw = decayedAverage(reports, (r) => r.epsRevisionPct, now);
  const targetRaw = decayedAverage(reports, (r) => r.targetPriceRevisionPct, now);
  const ratingRaw = decayedAverage(reports, (r) => r.ratingRevision, now);
  const pointRaw = decayedAverage(reports, (r) => r.investmentPointStrength, now);
  const recencyRaw = reports.length ? Math.max(...reports.map((r) => exponentialDecay(r.publishedAt, now))) : null;
  const brokerCount = new Set(reports.map((r) => r.broker?.trim()).filter(Boolean)).size;
  const brokerDiversity = reports.length ? clamp((Math.log1p(brokerCount) / Math.log(6)) * 100) : null;
  const parts: Array<[number | null, number]> = [
    [normalize(epsRaw, -20, 20), 0.3],
    [normalize(targetRaw, -20, 20), 0.25],
    [normalize(ratingRaw, -1, 1), 0.15],
    [normalize(pointRaw, 0, 5), 0.15],
    [finite(recencyRaw) ? recencyRaw * 100 : null, 0.1],
    [brokerDiversity, 0.05],
  ];
  return {
    score: round1(weightedAvailable(parts)),
    breakdown: { epsRevision: parts[0][0], targetPriceRevision: parts[1][0], ratingRevision: parts[2][0], investmentPoints: parts[3][0], recency: parts[4][0], brokerDiversity },
    coverage: parts.filter(([score]) => finite(score)).reduce((sum, [, weight]) => sum + weight, 0),
  };
}

export function calculateFundamentalScore(input: FundamentalInputs) {
  const parts: Array<[number | null, number]> = [
    [normalize(input.epsRevisionPct, -20, 20), 0.4],
    [normalize(input.earningsGrowthPct, -30, 40), 0.25],
    [normalize(input.revenueGrowthPct, -20, 30), 0.15],
    [normalize(input.roePct, 0, 25), 0.1],
    [finite(input.relativeValuationPct) ? normalize(-input.relativeValuationPct, -50, 50) : null, 0.1],
  ];
  return { score: round1(weightedAvailable(parts)), breakdown: { epsRevision: parts[0][0], earningsGrowth: parts[1][0], revenueGrowth: parts[2][0], roe: parts[3][0], valuation: parts[4][0] }, coverage: parts.filter(([v]) => finite(v)).reduce((s, [, w]) => s + w, 0) };
}

export function calculatePriceScore(input: PriceInputs) {
  const parts: Array<[number | null, number]> = [
    [normalize(input.momentum20Pct, -20, 20), 0.25],
    [normalize(input.momentum60Pct, -30, 35), 0.25],
    [normalize(input.relativeStrengthPct, -20, 20), 0.3],
    [finite(input.drawdownPct) ? normalize(-input.drawdownPct, -40, 0) : null, 0.1],
    [finite(input.volatilityPct) ? normalize(-input.volatilityPct, -60, -10) : null, 0.1],
  ];
  const surgePenalty = finite(input.shortTermSurgePct) && input.shortTermSurgePct > 25
    ? Math.min(20, (input.shortTermSurgePct - 25) * 0.8)
    : 0;
  return { score: round1(clamp(weightedAvailable(parts) - surgePenalty)), breakdown: { momentum20: parts[0][0], momentum60: parts[1][0], relativeStrength: parts[2][0], drawdown: parts[3][0], volatility: parts[4][0], surgePenalty }, coverage: Math.min(1, input.historyDays / 120) * parts.filter(([v]) => finite(v)).reduce((s, [, w]) => s + w, 0) };
}

export function calculateConsensusScore(input: ConsensusInputs) {
  const parts: Array<[number | null, number]> = [
    [normalize(input.buyRatioPct, 0, 100), 0.25],
    [normalize(input.targetUpsidePct, -20, 40), 0.3],
    [normalize(input.epsRevisionPct, -20, 20), 0.3],
    [finite(input.targetDispersionPct) ? normalize(-input.targetDispersionPct, -50, 0) : null, 0.15],
  ];
  return { score: round1(weightedAvailable(parts)), breakdown: { buyRatio: parts[0][0], targetUpside: parts[1][0], epsRevision: parts[2][0], targetDispersion: parts[3][0] }, coverage: parts.filter(([v]) => finite(v)).reduce((s, [, w]) => s + w, 0) };
}

export function calculateRegimeScore(themes: string[], regimeByTheme: Record<string, number>) {
  const values = themes.map((theme) => regimeByTheme[theme]).filter(finite).map((v) => clamp(v, -1, 1));
  const raw = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { score: round1((raw + 1) * 50), breakdown: { matchedThemeCount: values.length, raw }, coverage: values.length ? 1 : 0 };
}

export function classifyPick(input: Pick<ScoreInput, "dividendYieldPct"> & { researchScore: number; fundamentalScore: number; priceScore: number; volatilityPct: number | null; earningsGrowthPct: number | null; epsRevisionPct: number | null }): PickType {
  if ((input.volatilityPct ?? Infinity) <= 18 && (input.dividendYieldPct ?? 0) >= 2) return "DEFENSIVE";
  if ((input.earningsGrowthPct ?? -Infinity) >= 20 && (input.epsRevisionPct ?? -Infinity) >= 5) return "GROWTH";
  if (input.priceScore >= 75 && input.researchScore >= 65) return "MOMENTUM";
  return "CORE";
}

export function scoreStock(input: ScoreInput, now = new Date()): ScoredStock {
  const research = calculateResearchScore(input.research, now);
  const fundamental = calculateFundamentalScore(input.fundamental);
  const price = calculatePriceScore(input.price);
  const consensus = calculateConsensusScore(input.consensus);
  const regime = calculateRegimeScore(input.themes, input.regimeByTheme);
  const totalScore = round1(research.score * 0.4 + fundamental.score * 0.25 + price.score * 0.15 + consensus.score * 0.15 + regime.score * 0.05);
  const researchCoverage = Math.min(1, Math.log1p(input.research.length) / Math.log(6)) * research.coverage;
  const confidenceScore = round1(clamp((researchCoverage * 0.35 + consensus.coverage * 0.25 + fundamental.coverage * 0.2 + price.coverage * 0.2) * 100));
  const pickType = classifyPick({ ...input, researchScore: research.score, fundamentalScore: fundamental.score, priceScore: price.score, volatilityPct: input.price.volatilityPct, earningsGrowthPct: input.fundamental.earningsGrowthPct, epsRevisionPct: input.fundamental.epsRevisionPct });
  return { ...input, researchScore: research.score, fundamentalScore: fundamental.score, priceScore: price.score, consensusScore: consensus.score, regimeScore: regime.score, totalScore, confidenceScore, pickType, breakdown: { research: research.breakdown, fundamental: fundamental.breakdown, price: price.breakdown, consensus: consensus.breakdown, regime: regime.breakdown, coverage: { research: round1(researchCoverage * 100), fundamental: round1(fundamental.coverage * 100), price: round1(price.coverage * 100), consensus: round1(consensus.coverage * 100) } } };
}
