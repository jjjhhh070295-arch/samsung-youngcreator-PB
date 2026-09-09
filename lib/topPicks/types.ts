export type PickType = "CORE" | "GROWTH" | "MOMENTUM" | "DEFENSIVE";

export interface ResearchObservation {
  broker: string | null;
  publishedAt: string;
  epsRevisionPct: number | null;
  targetPriceRevisionPct: number | null;
  ratingRevision: -1 | 0 | 1 | null;
  investmentPointStrength: number | null;
}

export interface FundamentalInputs {
  epsRevisionPct: number | null;
  earningsGrowthPct: number | null;
  revenueGrowthPct: number | null;
  roePct: number | null;
  relativeValuationPct: number | null;
  /** 원천 팩트 보존용. 업종 중앙값이 없으면 점수에는 사용하지 않는다. */
  forwardPe?: number | null;
  priceToBook?: number | null;
}

export interface PriceInputs {
  momentum20Pct: number | null;
  momentum60Pct: number | null;
  relativeStrengthPct: number | null;
  drawdownPct: number | null;
  volatilityPct: number | null;
  shortTermSurgePct?: number | null;
  historyDays: number;
}

export interface ConsensusInputs {
  buyRatioPct: number | null;
  targetUpsidePct: number | null;
  epsRevisionPct: number | null;
  targetDispersionPct: number | null;
}

export interface ScoreInput {
  ticker: string;
  company: string;
  market: string;
  sector: string | null;
  themes: string[];
  research: ResearchObservation[];
  fundamental: FundamentalInputs;
  price: PriceInputs;
  consensus: ConsensusInputs;
  regimeByTheme: Record<string, number>;
  minimumLiquidityMet: boolean;
  dividendYieldPct?: number | null;
}

export interface ScoreBreakdown {
  research: Record<string, number | null>;
  fundamental: Record<string, number | null>;
  price: Record<string, number | null>;
  consensus: Record<string, number | null>;
  regime: Record<string, number | null>;
  coverage: Record<string, number>;
}

export interface ScoredStock extends ScoreInput {
  researchScore: number;
  fundamentalScore: number;
  priceScore: number;
  consensusScore: number;
  regimeScore: number;
  totalScore: number;
  confidenceScore: number;
  pickType: PickType;
  breakdown: ScoreBreakdown;
}

export interface TopPickExplanation {
  summary: string;
  keyReasons: string[];
  risks: string[];
}

export interface SelectedTopPick extends ScoredStock {
  rank: number;
  previousRank: number | null;
  rankChange: number | null;
  isNew: boolean;
  explanation?: TopPickExplanation | null;
}
