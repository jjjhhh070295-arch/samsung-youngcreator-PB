// PB Insight advisory layer — 결정론 엔진 공유 타입.
// AI는 설명만 하고, 수익률·변동성·비중·세금·VaR/CVaR는 여기서 확정하지 않는다.

export type AdvisoryStatus = "draft" | "review" | "locked" | "blocked";

export const ADVISORY_STATUS_LABEL: Record<AdvisoryStatus, string> = {
  draft: "초안",
  review: "검토",
  locked: "확정",
  blocked: "발행차단",
};

export type ProductCategory = "etf" | "els" | "stock" | "bond" | "pension" | "trust";

export const PRODUCT_CATEGORY_LABEL: Record<ProductCategory, string> = {
  etf: "ETF",
  els: "ELS/ELB",
  stock: "개별주식",
  bond: "채권",
  pension: "연금",
  trust: "신탁/랩",
};

export type RiskGrade = "안정" | "안정추구" | "위험중립" | "적극" | "공격";

export type ClientFlagKind = "high_risk" | "low_return" | "low_liquidity";

export const CLIENT_FLAG_LABEL: Record<ClientFlagKind, string> = {
  high_risk: "위험고객",
  low_return: "수익률 저조",
  low_liquidity: "유동성 부족",
};

/** 결정론 엔진이 산출한 수치. AI가 이 필드를 채우거나 덮어쓰면 Judge가 차단한다. */
export interface MeasuredNumber {
  value: number;
  unit: string;
  currency?: string;
  asOf: string;
  source: string;
  assumption?: string;
}

export interface CitationRef {
  sourceId: string;
  title: string;
  asOf: string;
  chunkId: string;
  url?: string;
}

export interface CitationVerdict {
  passed: boolean;
  count: number;
  incompleteIds: string[];
  message: string;
}

export interface ConflictAudit {
  passed: boolean;
  needsReview: boolean;
  conflicts: string[];
  message: string;
}

export interface StressScenarioResult {
  id: string;
  label: string;
  assumption: string;
  shockPct: MeasuredNumber;
  pnlWon: MeasuredNumber;
}

export interface TaxWaterfall {
  pretaxEnding: MeasuredNumber;
  expectedTax: MeasuredNumber;
  productCost: MeasuredNumber;
  afterTaxEnding: MeasuredNumber;
}

export type PipelineStepId =
  | "consult"
  | "ips"
  | "approve"
  | "portfolio"
  | "risk"
  | "tax"
  | "pdf";

export type PipelineStepState = "complete" | "review" | "blocked" | "pending";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  state: PipelineStepState;
  note: string;
}

export interface CalcConfig {
  horizonYears: number;
  riskFreeRatePct: number;
  varConfidence: number;
  currency: "KRW";
  engine: string;
}

export interface CalcResults {
  risk: {
    expectedReturn: MeasuredNumber;
    volatility: MeasuredNumber;
    sharpe: MeasuredNumber;
    mdd: MeasuredNumber;
    var95: MeasuredNumber;
    cvar95: MeasuredNumber;
  };
  stress: StressScenarioResult[];
  waterfall: TaxWaterfall | null;
}

export type GoldLabel = "pass" | "block";

export interface BookHolding {
  id: string;
  clientId: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  evalAmount: number;
  returnPct: number | null;
  category: ProductCategory;
  asOf: string;
  source: string;
}

export interface HoldingChip {
  name: string;
  ticker: string | null;
  category: ProductCategory;
  weightPct: number;
}

export interface ClientFlag {
  kind: ClientFlagKind;
  reason: string;
}

export interface ConsultationStatus {
  at: string;
  label: string;
  notesPreview: string;
}

export interface ClientBookRow {
  clientId: string;
  code: string;
  name: string;
  clientType: string;
  birthDate: string;
  totalAssets: number;
  investedAmount: number;
  totalReturnPct: number | null;
  riskGrade: RiskGrade;
  riskScore: number | null;
  holdings: HoldingChip[];
  lastConsultation: ConsultationStatus | null;
  flags: ClientFlag[];
  cashNeed12m: number;
}

export interface ProductMixSlice {
  category: ProductCategory;
  amount: number;
  weightPct: number;
  clientCount: number;
}

export interface ProductRankItem {
  name: string;
  ticker: string | null;
  category: ProductCategory;
  clientCount: number;
  totalAmount: number;
  avgWeightPct: number;
}

export interface BookAnalysis {
  asOf: string;
  source: string;
  currency: "KRW";
  clientCount: number;
  totalEvalAmount: MeasuredNumber;
  avgReturnPct: MeasuredNumber | null;
  productMix: ProductMixSlice[];
  productRanking: ProductRankItem[];
  flagged: {
    highRisk: ClientBookRow[];
    lowReturn: ClientBookRow[];
    lowLiquidity: ClientBookRow[];
  };
}

export interface AdvisoryConstraint {
  rawText: string;
  categoryOnly: ProductCategory | "wrap" | null;
  overseasOnly: boolean;
  minExpectedReturn: number | null;
  preferIndividualStocks: boolean;
  tags: string[];
}

export interface ProductIdea {
  category: ProductCategory;
  name: string;
  ticker?: string;
  role: string;
  fitReason: string;
  expectedReturnBand: string;
  expectedReturnPct: MeasuredNumber | null;
  riskNote: string;
  taxNote: string;
  liquidityNote: string;
  /** 엔진 초안 구간. 확정 비중이 아님. */
  suggestedWeightRange: string;
}

export interface RecommendPlan {
  id: "A" | "B" | "C";
  label: string;
  posture: "안정" | "균형" | "성장";
  products: ProductIdea[];
  constraintNote: string;
  weightDisclaimer: string;
}

export interface RecommendResult {
  asOf: string;
  source: string;
  currency: "KRW";
  constraints: AdvisoryConstraint;
  plans: RecommendPlan[];
  narrativePromptFacts: string[];
  disclaimers: string[];
  citations?: CitationRef[];
}

export interface GoldCase {
  id: string;
  title: string;
  humanLabel: GoldLabel;
  notes: string;
  result: RecommendResult;
  citations: CitationRef[];
}

export interface TickerBar {
  time: string;
  close: number;
}

export interface TickerProfile {
  asOf: string;
  source: string;
  sector: string | null;
  industry: string | null;
  longBusinessSummary: string | null;
  warning: string | null;
}

export interface TickerSnapshot {
  symbol: string;
  resolvedSymbol: string;
  name: string;
  exchange: string;
  currency: string;
  asOf: string;
  source: string;
  lastPrice: MeasuredNumber;
  warnings: string[];
  periodReturns: {
    d1: MeasuredNumber | null;
    m1: MeasuredNumber | null;
    m3: MeasuredNumber | null;
    m6: MeasuredNumber | null;
    y1: MeasuredNumber | null;
    ytd: MeasuredNumber | null;
  };
  volatility: {
    d20: MeasuredNumber | null;
    d60: MeasuredNumber | null;
  };
  mdd: MeasuredNumber | null;
  movingAverages: {
    sma20: MeasuredNumber | null;
    sma60: MeasuredNumber | null;
    sma120: MeasuredNumber | null;
  };
  rsi14: MeasuredNumber | null;
  macd: {
    macd: MeasuredNumber | null;
    signal: MeasuredNumber | null;
    histogram: MeasuredNumber | null;
  };
  technicalState: {
    trend: string;
    rsiState: string;
    macdState: string;
    summary: string;
  };
  bars: TickerBar[];
}

export interface JudgeFinding {
  code: string;
  severity: "pass" | "warn" | "fail";
  message: string;
}

export interface JudgeResult {
  at: string;
  passed: boolean;
  findings: JudgeFinding[];
}

export interface EvidenceRun {
  id: string;
  at: string;
  kind: "book" | "ticker" | "recommend" | "pdf" | "status" | "explain" | "snapshot" | "judge";
  engine: string;
  inputHash: string;
  outputHash: string;
  notes: string;
}

export interface ApprovalEvent {
  at: string;
  actor: string;
  from: AdvisoryStatus;
  to: AdvisoryStatus;
  note: string;
}

export interface EvidenceBundle {
  id: string;
  clientId: string;
  runId: string;
  createdAt: string;
  updatedAt: string;
  status: AdvisoryStatus;
  consultationInput: string;
  ipsExtract: unknown;
  calcConfig: CalcConfig | null;
  calcResults: CalcResults | null;
  citations: CitationRef[];
  citation: CitationVerdict | null;
  conflict: ConflictAudit | null;
  inputHash: string;
  settingsHash: string;
  resultHash: string;
  outputHash: string;
  judgeAttempts: number;
  blockReasons: string[];
  runs: EvidenceRun[];
  judge: JudgeResult | null;
  approvals: ApprovalEvent[];
}
