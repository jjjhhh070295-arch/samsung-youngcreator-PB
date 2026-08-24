// PB Insight advisory layer — 결정론 엔진 공유 타입.
// AI는 설명만 하고, 수익률·변동성·비중·세금·VaR/CVaR는 여기서 확정하지 않는다.

export type AdvisoryStatus = "draft" | "review" | "locked" | "blocked";

export const ADVISORY_STATUS_LABEL: Record<AdvisoryStatus, string> = {
  draft: "초안",
  review: "검토",
  locked: "확정",
  blocked: "고객 제안 차단",
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
  /** 엄격 제약 검증용 카탈로그 메타. 표시 문구를 추론 근거로 쓰지 않는다. */
  isOverseas?: boolean;
  productStructure?: "wrap" | "trust" | "other";
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
  sma5: number | null;
  sma20: number | null;
  sma60: number | null;
  sma120: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
}

export interface TickerProfile {
  asOf: string;
  source: string;
  sector: string | null;
  industry: string | null;
  longBusinessSummary: string | null;
  warning: string | null;
}

export interface TickerLiveQuote {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  price: number;
  previousClose: number | null;
  changePct: number | null;
  asOf: string;
  source: string;
  /** 제공처가 명시한 지연 시간. 알 수 없으면 null. */
  delayMinutes: number | null;
  marketState: string | null;
}

export type TickerMomentumDataMode = "demo" | "live";
export type TickerMomentumApprovalStatus = "not_applicable" | "approved" | "not_approved";
export type TickerMomentumAdjustmentStatus =
  | "provider_adjusted"
  | "split_adjusted"
  | "unadjusted"
  | "unknown";

/**
 * 한 거래일의 정규장 완료 OHLCV입니다. 가격 필드는 dataset의 adjustmentStatus에
 * 적힌 기준으로 이미 보정된 값만 넣습니다. 거래량 누락은 0이 아니라 null입니다.
 */
export interface TickerMomentumOhlcvBar {
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  /** 교육용 액면분할 회귀 테스트와 감사 표시에만 사용하며 계산에는 쓰지 않습니다. */
  rawHigh?: number;
  rawClose?: number;
}

export interface TickerMomentumDataset {
  dataMode: TickerMomentumDataMode;
  approvalStatus: TickerMomentumApprovalStatus;
  datasetId: string;
  version: string;
  label: string;
  asOf: string;
  source: string;
  adjustmentStatus: TickerMomentumAdjustmentStatus;
  adjustmentBasis: string;
  volumeBasis: string;
  sessionCompleteness: "complete" | "partial" | "unknown";
  bars: TickerMomentumOhlcvBar[];
}

export interface TickerMomentumEvidence {
  status: "ok" | "warning" | "blocked" | "unavailable";
  dataMode: TickerMomentumDataMode | "unavailable";
  approvalStatus: TickerMomentumApprovalStatus | "unknown";
  datasetId: string | null;
  version: string | null;
  label: string;
  asOf: string;
  source: string;
  adjustmentStatus: TickerMomentumAdjustmentStatus;
  adjustmentBasis: string;
  volumeBasis: string;
  sessionCompleteness: "complete" | "partial" | "unknown";
  freshness: "fixture" | "current" | "stale" | "unknown";
  observationCount: number;
  previousWindowCount: number;
  duplicateDatesRemoved: number;
  missingVolumeCount: number;
  currentAdjustedClose: number | null;
  currentAdjustedHigh: number | null;
  prior252High: number | null;
  distanceToPriorHighPct: number | null;
  isNewHigh: boolean | null;
  proximityState: "new_high" | "near_high" | "below_high" | "unavailable";
  nearThresholdPct: number;
  returnsPct: {
    d20: number | null;
    d60: number | null;
    d120: number | null;
    d252: number | null;
  };
  movingAverages: {
    sma20: number | null;
    sma60: number | null;
    sma120: number | null;
  };
  volumeRatio20: number | null;
  warnings: string[];
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
    sma5: MeasuredNumber | null;
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
  momentum: TickerMomentumEvidence;
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
  /** 추천 실행의 Judge·출처는 계산 PDF 게이트와 분리해 실행 단위로 보존한다. */
  judge?: JudgeResult;
  citations?: CitationRef[];
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
  /** 고객별 검토본 순번. 과거 데이터는 migration에서 1로 보정한다. */
  version: number;
  /** 새 검토본이 보존·대체하지 않고 참조하는 직전 locked/blocked 원본 ID. */
  previousBundleId: string | null;
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
  /** locked 전 soft gate — UI에 "무엇을 해야 하는지" 안내. blocked와 구분. */
  pendingReasons: string[];
  runs: EvidenceRun[];
  judge: JudgeResult | null;
  approvals: ApprovalEvent[];
}
