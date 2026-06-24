// 포트폴리오 생성 엔진
//
// 산출 순서: 7요인 분석 → 현금흐름 분석 → 리포트/리서치 분석 → 고객 요구조건 반영 → 포트폴리오 산출.

import { CLIENT_TYPE_LABEL, FACTOR_META, type Client, type Portfolio, type AssetAllocation, type CashFlow, type FactorKey } from "./types";
import {
  FALLBACK_MARKET_RESEARCH,
  scoreResearchSignals,
  type MarketResearchItem,
  type ResearchSignal,
} from "./portfolioResearch";
import { scoreTaxPainPoints, type TaxPainId } from "./taxPainScoring";
import { FALLBACK_PROXY_RETURN_ESTIMATES as PROXY_FALLBACKS, type ProxyReturnEstimate } from "./proxyReturns";

export { FALLBACK_PROXY_RETURN_ESTIMATES, RETURN_ESTIMATE_LABEL } from "./proxyReturns";

function alloc(assetClass: string, weight: number): AssetAllocation {
  return { assetClass, weight };
}

function uid(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 8);
}

export function generatePortfolios(client: Client, heldAssets?: HeldAssets): Portfolio[] {
  const model = buildPortfolioViewModel(client, undefined, heldAssets);
  return model.portfolioOptions.map((option) =>
    normalizeWeights({
      id: uid("pf"),
      label: option.name,
      allocations: [
        alloc("주식/ETF", option.weights.etf),
        alloc("채권", option.weights.bond),
        alloc("현금", option.weights.mmf + option.weights.dollar),
        alloc("대체투자", option.weights.gold + option.weights.raw),
      ].filter((allocation) => allocation.weight > 0),
      expectedReturn: option.expectedReturn,
      expectedRisk: option.volatility,
      taxNote: model.rationale.tax,
      rationale: `${model.rationale.client} ${model.rationale.cashflow} ${model.rationale.market} ${model.rationale.preference}`,
      editedByPb: false,
    }),
  );
}

// 비중 합계를 100으로 맞춘다 (PB 수정 검증에도 재사용).
export function normalizeWeights(p: Portfolio): Portfolio {
  const clamped = p.allocations.map((a) => ({
    ...a,
    weight: Math.max(0, a.weight),
  }));
  const sum = clamped.reduce((s, a) => s + a.weight, 0) || 1;
  return {
    ...p,
    allocations: clamped.map((a) => ({
      ...a,
      weight: Math.round((a.weight / sum) * 1000) / 10,
    })),
  };
}

export function weightSum(p: Portfolio): number {
  return Math.round(p.allocations.reduce((s, a) => s + a.weight, 0) * 10) / 10;
}
// 1. 고객 요약 카드 타입
export interface ClientSummary {
  clientType: string;
  riskPropensity: string;
  investmentPeriod: string;
  liquidityNeed: string;
  taxSensitivity: string;
  keyRequirements: string[];
}

// 2. 매크로 리포트 타입
export interface MacroFactor {
  label: string;
  outlook: string;
  implication: string;
}

export interface MacroReport {
  title: string;
  date: string;
  factors: {
    interestRate: MacroFactor;
    exchangeRate: MacroFactor;
    inflation: MacroFactor;
    stockMarket: MacroFactor;
  };
}

// 3. 추천 포트폴리오 타입
export interface PortfolioOption {
  id: 'stable' | 'balanced' | 'growth';
  name: string;
  expectedReturn: number;
  volatility: number;
  mdd: number;
  taxReturn: number;
  weights: {
    etf: number;
    bond: number;
    els: number;
    mmf: number;
    gold: number;
    dollar: number;
    raw: number;
  };
  mainProducts: string[];
  detailedHoldings: PortfolioDetailHolding[];
}

export interface PortfolioDetailHolding {
  bucket: keyof PortfolioOption["weights"];
  name: string;
  weight: number;
  role: string;
  taxNote: string;
  source: string;
}

// 4. 상품군 적합도 타입
export type SuitabilityStatus = '적합' | '주의' | '비추천';

export interface AssetSuitability {
  category: string;
  status: SuitabilityStatus;
  reason: string;
}

const PORTFOLIO_OPTION_META: Array<{
  id: PortfolioOption["id"];
  name: string;
  riskTilt: -1 | 0 | 1;
}> = [
  { id: "stable", name: "방어형 추천안", riskTilt: -1 },
  { id: "balanced", name: "균형형 추천안", riskTilt: 0 },
  { id: "growth", name: "성장형 추천안", riskTilt: 1 },
];

// 간단한 시뮬레이션 계산 로직 (PB 편집 시 지표 연동용)
/** Risk-profile model portfolio starting points. Customer factors adjust these weights. */
export const MODEL_PORTFOLIO_TEMPLATES: Record<PortfolioOption["id"], PortfolioOption["weights"]> = {
  stable: { etf: 25, bond: 57, els: 0, mmf: 5, gold: 8, dollar: 3, raw: 2 },
  balanced: { etf: 34, bond: 47, els: 0, mmf: 6, gold: 7, dollar: 4, raw: 2 },
  growth: { etf: 43, bond: 38, els: 0, mmf: 5, gold: 8, dollar: 4, raw: 2 },
};

/** Fallback proxy estimates, not forward-return targets or performance promises. */

const VOLATILITY_PROXY_ORDER = ["etf", "bond", "mmf", "gold", "dollar", "raw"] as const;
const VOLATILITY_PROXY_ASSUMPTIONS: Record<(typeof VOLATILITY_PROXY_ORDER)[number], number> = {
  etf: 0.18, bond: 0.06, mmf: 0.01, gold: 0.16, dollar: 0.08, raw: 0.2,
};
// ETF = S&P500/KOSPI200 blend. Bond and MMF use bond/cash proxies;
// gold and USD remain explicit diversifier/hedge proxies.
const VOLATILITY_CORRELATION: number[][] = [
  [1, -0.1, 0.05, 0.12, -0.08, 0.35], [-0.1, 1, 0.35, 0.05, 0.1, 0.05],
  [0.05, 0.35, 1, 0, 0.05, 0], [0.12, 0.05, 0, 1, -0.15, 0.28],
  [-0.08, 0.1, 0.05, -0.15, 1, -0.08], [0.35, 0.05, 0, 0.28, -0.08, 1],
];

export function calculateVolatilityEstimate(weights: PortfolioOption["weights"]) {
  const effective = { ...weights, bond: weights.bond + weights.els * 0.7, mmf: weights.mmf + weights.els * 0.3, els: 0 };
  const total = Object.values(effective).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const vector = VOLATILITY_PROXY_ORDER.map((key) => Math.max(0, effective[key]) / total);
  const variance = vector.reduce((sum, weight, row) => sum + weight * VOLATILITY_CORRELATION[row].reduce((inner, correlation, column) => inner + correlation * VOLATILITY_PROXY_ASSUMPTIONS[VOLATILITY_PROXY_ORDER[row]] * VOLATILITY_PROXY_ASSUMPTIONS[VOLATILITY_PROXY_ORDER[column]] * vector[column], 0), 0);
  return Math.sqrt(Math.max(0, variance)) * 100;
}

export function getVolatilityRanges(volatility: number) {
  const round = (value: number) => Math.round(value * 10) / 10;
  // stressLow/stressHigh remain only for a non-rendered legacy JSX branch.
  // New UI stress ranges come from runHistoricalStressRange() MDD results.
  return { normalLow: round(volatility * 0.8), normalHigh: round(volatility * 1.25), stressLow: round(volatility * 1.8), stressHigh: round(volatility * 2.65) };
}

export function calculateSimulatedMetrics(weights: PortfolioOption['weights'], proxyReturns?: ProxyReturnEstimate[]) {
  // 실제 정밀 엔진 대신 MVP용 가중치 기반 근사치 계산 로직
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const normalized = total === 0 ? weights : weights;
  const rate = (key: keyof typeof PROXY_FALLBACKS): number => {
    const found = proxyReturns?.find((e) => e.key === key);
    return (found ? found.annualizedReturnPct : PROXY_FALLBACKS[key]) / 100;
  };
  const effectiveBond = normalized.bond + normalized.els * 0.7;
  const effectiveMmf = normalized.mmf + normalized.els * 0.3;
  const expReturn =
    (normalized.etf * rate('sp500')) +
    (effectiveBond * rate('bond')) +
    (effectiveMmf * rate('mmf')) +
    (normalized.gold * rate('gold')) +
    (normalized.dollar * rate('dollar')) +
    (normalized.raw * rate('raw'));
  const vol = calculateVolatilityEstimate(normalized);

  return {
    expectedReturn: Math.round(expReturn * 10) / 10,
    volatility: Math.round(vol * 10) / 10,
    mdd: Math.round((vol * -1.3) * 10) / 10,
    taxReturn: Math.round((expReturn * 0.846) * 10) / 10 // 대략적인 세율 감안
  };
}

export interface CashflowPortfolioSummary {
  monthlyIncome: number;
  monthlyOutflow: number;
  monthlyNet: number;
  scheduledOutflow: number;
  taxOutflow: number;
  corporateTaxOutflow: number;
  soleBusinessNet: number;
  mixedEntityOutflow: number;
  linkedDividendFlow: number;
  nearestOutflow?: CashFlow;
}

export interface PortfolioRationale {
  market: string;
  client: string;
  cashflow: string;
  tax: string;
  unique: string;
  preference: string;
}

export interface PortfolioCalculationStep {
  order: number;
  title: string;
  detail: string;
  impact: string;
}

export interface ClientPreferenceProfile {
  rawText: string;
  hasRequirement: boolean;
  overseasSingleStock: boolean;
  stockOnly: boolean;
  rejectsOtherProducts: boolean;
  highRiskAccepted: boolean;
  targetReturn?: number;
  benchmarkOutperformance: boolean;
  benchmarkTargets: string[];
  taxPriority: boolean;
  tags: string[];
  warnings: string[];
  actions: string[];
}

export interface PreferenceFeasibilityReport {
  feasible: boolean;
  suppressedPreferences: string[];
  conflicts: string[];
  weightBasedReturn: number;
  weightBasedVolatility: number;
  requestedTargetReturn?: number;
  maxAchievableReturn: number;
  mmfFloorPct: number;
  liquidityReasons: string[];
}

interface PreferenceFeasibilityOptions {
  client?: Client;
  cashflow?: CashflowPortfolioSummary;
  riskTilt?: -1 | 0 | 1;
  benchmarkTargetReturn?: number;
  investableKrw?: number;
  mmfFloorPct?: number;
  liquidityReasons?: string[];
  proxyReturns?: ProxyReturnEstimate[];
}

export interface KodexProduct {
  name: string;
  role: string;
  assetClass: "해외주식" | "국내주식" | "테마주식" | "채권/현금성" | "혼합자산";
  retirementLimit: "개인연금" | "IRP 70%" | "IRP 100%";
  url: string;
}

export interface PensionHolding {
  product: KodexProduct;
  weight: number;
}

export interface PensionPortfolio {
  accountType: "연금저축펀드" | "IRP";
  riskAssetWeight: number;
  safeAssetWeight: number;
  holdings: PensionHolding[];
  note: string;
}

export interface TaxSavingPlan {
  enabled: boolean;
  clientFit: string;
  annualContributionLimit: number;
  taxCreditBase: number;
  pensionSavingContribution: number;
  irpContribution: number;
  creditRate: number;
  estimatedCredit: number;
  portfolios: PensionPortfolio[];
  solutions: string[];
  sources: { label: string; url: string }[];
}

export interface TaxPainPoint {
  id: string;
  label: string;
  severity: "상" | "중" | "하";
  basis: string[];
  whyItMatters: string;
  portfolioResponse: string;
  source: { label: string; url: string };
}

export interface PortfolioViewModel {
  clientSummary: ClientSummary;
  macroReport: MacroReport;
  portfolioOptions: PortfolioOption[];
  assetSuitability: AssetSuitability[];
  cashflowSummary: CashflowPortfolioSummary;
  researchItems: MarketResearchItem[];
  researchSignals: ReturnType<typeof scoreResearchSignals>;
  rationale: PortfolioRationale;
  preferenceProfile: ClientPreferenceProfile;
  preferenceFeasibility: PreferenceFeasibilityReport;
  taxSavingPlan: TaxSavingPlan;
  taxPainPoints: TaxPainPoint[];
  executiveConclusion: string;
  recommendedId: PortfolioOption["id"];
  liquidityReserveManwon: number;
  calculationSteps: PortfolioCalculationStep[];
  assetLayer: AssetLayerSummary | null;
}

// ── 실제 보유자산 입력 (화면에서 조회한 KIS 현재가 기반) ──
export interface HeldAssets {
  stocksKrw: number;      // 주식 평가금액 (KRW 환산)
  realEstateKrw: number;  // 부동산 추정가 (DB 저장값)
  cashKrw: number;        // 현금·기타 (= totalKrw - stocks - realEstate)
  totalKrw: number;       // 합계
}

// ── 자산 3층 구조 계산 결과 ──
export interface AssetLayerSummary {
  totalKrw: number;
  investableKrw: number;  // 총자산 - 부동산 (실제 배분 대상)
  stocksPct: number;
  realEstatePct: number;
  cashPct: number;
  realEstateWarning: string | null;
}

export const REAL_ESTATE_WARNING_THRESHOLD = 0.5;

const factorValue = (client: Client, key: FactorKey, fallback = "미입력") =>
  client.ips?.[key]?.value || client.ips?.[key]?.inferenceHint || fallback;

const factorScore = (client: Client, key: FactorKey, fallback = 3) =>
  client.ips?.[key]?.score ?? fallback;

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function percentOfAssets(amountWon: number, client: Client): number {
  if (!client.assetSize || client.assetSize <= 0) return 0;
  return (Math.abs(amountWon) / client.assetSize) * 100;
}

// 현금흐름 압력을 투자가능자산 기준으로 환산 (부동산 제외 실배분 대상)
function percentOfBase(amountWon: number, base: number): number {
  if (!base || base <= 0) return 0;
  return (Math.abs(amountWon) / base) * 100;
}

function factorScoreSummary(client: Client): Record<FactorKey, number> {
  return {
    return: factorScore(client, "return"),
    risk: factorScore(client, "risk"),
    timeHorizon: factorScore(client, "timeHorizon"),
    tax: factorScore(client, "tax"),
    liquidity: factorScore(client, "liquidity"),
    legal: factorScore(client, "legal", 1),
    unique: factorScore(client, "unique", 1),
  };
}

const clampWeight = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const formatKRWShortLocal = (won: number) => {
  const abs = Math.abs(won);
  const sign = won < 0 ? "-" : "";
  if (abs >= 100_000_000) {
    return `${sign}${Math.round((abs / 100_000_000) * 10) / 10}억원`;
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 10_000).toLocaleString()}만원`;
  }
  return `${sign}${abs.toLocaleString()}원`;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const KODEX_PRODUCTS: Record<
  | "sp500"
  | "sp500Active"
  | "aiSemi"
  | "india"
  | "msciKorea"
  | "shortBond"
  | "kofr"
  | "aggregateBond"
  | "financialBond",
  KodexProduct
> = {
  sp500: {
    name: "KODEX 미국S&P500",
    role: "미국 대표지수 장기 핵심",
    assetClass: "해외주식",
    retirementLimit: "IRP 70%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETFE4",
  },
  sp500Active: {
    name: "KODEX 미국S&P500액티브",
    role: "S&P500 상위 종목 압축 성장",
    assetClass: "해외주식",
    retirementLimit: "IRP 70%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETFQ9",
  },
  aiSemi: {
    name: "KODEX AI반도체핵심장비",
    role: "AI·반도체 테마 알파",
    assetClass: "테마주식",
    retirementLimit: "IRP 70%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETFL7",
  },
  india: {
    name: "KODEX 인도Nifty50",
    role: "신흥국 성장 분산",
    assetClass: "해외주식",
    retirementLimit: "IRP 70%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETFJ1",
  },
  msciKorea: {
    name: "KODEX MSCI KOREA TR",
    role: "국내 대표주식 TR 분산",
    assetClass: "국내주식",
    retirementLimit: "IRP 70%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETF93",
  },
  shortBond: {
    name: "KODEX 단기채권",
    role: "IRP 안전자산·현금성 완충",
    assetClass: "채권/현금성",
    retirementLimit: "IRP 100%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETF35",
  },
  kofr: {
    name: "KODEX KOFR금리 액티브(합성)",
    role: "금리형 대기자금",
    assetClass: "채권/현금성",
    retirementLimit: "IRP 70%",
    url: "https://m.samsungfund.com/etf/product/view.do?id=2ETFG6",
  },
  aggregateBond: {
    name: "KODEX 종합채권(AA-이상) 액티브",
    role: "우량채권 중장기 코어",
    assetClass: "채권/현금성",
    retirementLimit: "IRP 100%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETF88",
  },
  financialBond: {
    name: "KODEX 26-12 금융채(AA-이상)액티브",
    role: "만기매칭형 우량 금융채",
    assetClass: "채권/현금성",
    retirementLimit: "IRP 100%",
    url: "https://www.samsungfund.com/etf/product/view.do?id=2ETFS7",
  },
};

const TAX_PAIN_SOURCES = {
  financialIncome: {
    label: "국세상담센터 금융소득 과세대상",
    url: "https://call.nts.go.kr/call/qna/selectQnaInfo.do?ctgId=CTG11775&mi=1441",
  },
  inheritanceGift: {
    label: "국세청 상속·증여세 세율",
    url: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7957&mi=6529",
  },
  stockGain: {
    label: "국세청 주식 양도소득세 신고대상",
    url: "https://s.nts.go.kr/asan/na/ntt/selectNttInfo.do?mi=2201&nttSn=1348384",
  },
  realEstate: {
    label: "국세청 종합부동산세 개요",
    url: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7733&mi=40375",
  },
  pension: {
    label: "국세청 연금계좌 세액공제",
    url: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7875",
  },
  brazilBond: {
    label: "삼일PwC 브라질채권 비과세 검토",
    url: "https://www.pwc.com/kr/ko/insights/issue-brief/one-point-tax-10.html",
  },
};

function parseTargetReturn(text: string): number | undefined {
  const patterns = [
    /(?:기대수익률|목표수익률|수익률)[^\d]{0,12}(\d{1,2}(?:\.\d+)?)\s*%?\s*(?:이상|넘|초과)?/i,
    /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:이상|넘|초과|나왔)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isNaN(value) && value > 0) return value;
    }
  }
  return undefined;
}

function parsePreferenceProfile(client: Client): ClientPreferenceProfile {
  const rawText = [
    client.ips.unique.value,
    client.ips.unique.inferenceHint,
    client.ips.unique.notes,
    client.ips.return.value,
    client.ips.return.notes,
  ]
    .filter(Boolean)
    .join(" ");
  const lower = rawText.toLowerCase();
  const overseasSingleStock = /해외주식|미국주식|미장|나스닥|해외 주식|foreign|us stock/.test(lower)
    && /단일종목|개별종목|개별주|여러개|종목 여러|single/.test(lower);
  const stockOnly = overseasSingleStock || /주식형|주식만|주식 100|전부 주식|올인|몰빵|equity only/.test(lower);
  const rejectsOtherProducts = /다른 상품.*싫|다른상품.*싫|채권.*싫|els.*싫|펀드.*싫|현금.*싫|싫어요|제외|빼고|only/.test(lower);
  const highRiskAccepted = /아무리 위험|위험해도|고위험|공격적|공격형|적극|손실.*감수|리스크.*감수/.test(lower);
  const targetReturn = parseTargetReturn(rawText);
  const benchmarkOutperformance = /(?:벤치마크|benchmark|kospi|코스피|kospi200|코스피200|s&p|snp|sp500|s&p500|에스앤피).{0,24}(?:보다|대비|이상|초과|상회|넘|높|이기|웃돌)|(?:보다|대비).{0,16}(?:수익률|성과).{0,12}(?:높|초과|상회|이기)|(?:알파|초과수익)/i.test(lower);
  const taxPriority = /(?:세금|절세|세후|비과세|과세이연|분리과세|금융소득종합과세|양도세|이자소득세).{0,24}(?:최대한|가장|최우선|우선|적게|줄|낮|절감|아끼|최소|안\s*내|안내|비과세)|(?:최대한|가장|최우선|우선).{0,16}(?:절세|세금|세후|비과세)|tax\s*(?:first|priority|efficient)/i.test(lower);
  const specificBenchmarkTargets = [
    /kospi|코스피|kospi200|코스피200/i.test(lower) ? "KOSPI" : "",
    /s&p|snp|sp500|s&p500|에스앤피/i.test(lower) ? "S&P500" : "",
  ].filter(Boolean);
  const benchmarkTargets = specificBenchmarkTargets.length > 0
    ? specificBenchmarkTargets
    : [/벤치마크|benchmark|알파|초과수익/i.test(lower) ? "벤치마크" : ""].filter(Boolean);

  const tags: string[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];

  if (overseasSingleStock) {
    tags.push("해외 단일종목 선호");
    actions.push("주식/ETF 버킷을 해외 단일종목 집중 바스켓으로 해석했습니다.");
  }
  if (stockOnly) {
    tags.push("주식형 자산 중심");
    actions.push("복잡한 구조화 상품보다 ETF·채권·MMF/RP 중심으로 비중을 단순화했습니다.");
  }
  if (rejectsOtherProducts) {
    tags.push("비주식 상품 배제 요청");
    warnings.push("비주식 상품 배제 요청은 세금 납부일·현금화 일정과 충돌할 수 있어 PB 확인이 필요합니다.");
  }
  if (highRiskAccepted) {
    tags.push("고위험 감수");
    warnings.push("고위험 감수 의사는 손실 가능성 확인 절차와 투자자성향 적합성 검토가 필요합니다.");
  }
  if (targetReturn) {
    tags.push(`목표 기대수익률 ${targetReturn}%`);
    actions.push(`목표 기대수익률 ${targetReturn}%를 별도 요구조건으로 기록했습니다.`);
    if (targetReturn >= 15) {
      warnings.push(`${targetReturn}% 목표수익률은 일반 분산 포트폴리오보다 매우 공격적인 가정이므로 보장 수익률이 아니라 요구조건으로만 표시합니다.`);
    }
  }
  if (benchmarkOutperformance) {
    const targets = benchmarkTargets.length > 0 ? benchmarkTargets : ["벤치마크"];
    tags.push(`${targets.join("·")} 초과수익 요구`);
    actions.push(`${targets.join("·")} 대비 높은 수익률 요구를 감지해 성장 ETF·테마주·해외주식 비중을 우선 보강했습니다.`);
    warnings.push("벤치마크 초과수익은 보장할 수 없으며, 시장 하락 시 손실폭과 추적오차가 커질 수 있어 고위험 적합성 확인이 필요합니다.");
  }
  if (taxPriority) {
    tags.push("세금 최우선");
    actions.push("비과세·분리과세·과세이연 가능성이 있는 자산을 우선 검토하고, 수익률·위험도는 후순위 제약으로 낮췄습니다.");
    actions.push("브라질 국채, 국내 상장주식 장내거래, 개별채권 직접투자, 연금저축·IRP 과세이연 계좌를 절세 후보군으로 올렸습니다.");
    warnings.push("절세 효과는 개인/법인 구분, 대주주 요건, 조세조약 요건, 계좌 한도에 따라 달라 세무 전문가 확인이 필요합니다.");
  }

  return {
    rawText,
    hasRequirement: tags.length > 0,
    overseasSingleStock,
    stockOnly,
    rejectsOtherProducts,
    highRiskAccepted,
    targetReturn,
    benchmarkOutperformance,
    benchmarkTargets,
    taxPriority,
    tags,
    warnings,
    actions,
  };
}

function normalizeOptionWeights(weights: PortfolioOption["weights"]): PortfolioOption["weights"] {
  const clamped: PortfolioOption["weights"] = {
    etf: clampWeight(weights.etf),
    bond: clampWeight(weights.bond + weights.els * 0.7),
    els: 0,
    mmf: clampWeight(weights.mmf + weights.els * 0.3),
    gold: clampWeight(weights.gold),
    dollar: clampWeight(weights.dollar),
    raw: clampWeight(weights.raw),
  };
  const sum = Object.values(clamped).reduce((acc, value) => acc + value, 0) || 1;

  const normalized = Object.fromEntries(
    Object.entries(clamped).map(([key, value]) => [key, Math.round((value / sum) * 100)]),
  ) as PortfolioOption["weights"];

  const diff = 100 - Object.values(normalized).reduce((acc, value) => acc + value, 0);
  normalized.mmf += diff;
  return normalized;
}

// 세금 판정 키워드 (bare "세" 제외 → "월세" 오인 방지)
const TAX_KEYWORDS = /세금|법인세|소득세|양도|증여|상속|재산세|종부|종합부동산|취득세|tax/i;
// 비세금(임대료·관리비류) — 라벨 폴백 시 세금 매칭에서 제외
const NON_TAX_EXPENSE = /월세|전세|임대|임차|세입|관리비/;

// 유출 항목의 세금 여부 — category 우선·단독, 없으면 라벨 정규식 폴백.
// category가 있으면 label/note는 보지 않음(월세 등 라벨 오염 차단).
function isTaxFlow(flow: CashFlow): boolean {
  const category = (flow.category ?? "").trim();
  if (category) return TAX_KEYWORDS.test(category); // ① category 우선·단독
  // ② category 비면(레거시) 라벨 폴백 — 임대료·관리비류는 세금에서 제외
  const text = `${flow.label} ${flow.taxAccountingNote ?? ""}`;
  if (NON_TAX_EXPENSE.test(text)) return false;
  return TAX_KEYWORDS.test(text);
}

function summarizeCashflows(cashFlows: CashFlow[]): CashflowPortfolioSummary {
  const recurring = cashFlows.filter((flow) => flow.recurring);
  // 세금 판정된 유출 (category 우선 하이브리드)
  const taxOutflows = cashFlows.filter((flow) => flow.amount < 0 && isTaxFlow(flow));
  const taxIds = new Set(taxOutflows.map((flow) => flow.id));
  // 비반복 유출: 전체(날짜 신호용) vs 세금 제외분(합계 — 이중계상 방지)
  const scheduledAll = cashFlows.filter((flow) => !flow.recurring && flow.amount < 0);
  const scheduledNonTax = scheduledAll.filter((flow) => !taxIds.has(flow.id));
  const corporateTaxFlows = cashFlows.filter((flow) =>
    flow.amount < 0 && /법인세|corporate[_\s-]?tax/i.test(`${flow.label} ${flow.category ?? ""}`),
  );
  const soleBusinessFlows = cashFlows.filter((flow) => flow.entity === "sole_business");
  const mixedOutflows = cashFlows.filter((flow) => flow.entity === "mixed" && flow.amount < 0);
  const linkedDividendFlows = cashFlows.filter((flow) =>
    /배당|dividend/i.test(`${flow.label} ${flow.category ?? ""}`),
  );
  // 가장 임박한 비반복 유출(세금 포함) — 날짜 신호는 유지
  const nearestOutflow = scheduledAll.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))[0];
  const monthlyIncome = recurring.filter((flow) => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const monthlyOutflow = recurring.filter((flow) => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);

  return {
    monthlyIncome,
    monthlyOutflow,
    monthlyNet: monthlyIncome - monthlyOutflow,
    // 세금은 scheduled 합계에서 제외 → 세금 0.7만, 일반 비반복 0.34만 (이중계상 제거)
    scheduledOutflow: scheduledNonTax.reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    taxOutflow: taxOutflows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    corporateTaxOutflow: corporateTaxFlows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    soleBusinessNet: soleBusinessFlows.reduce((sum, flow) => sum + flow.amount, 0),
    mixedEntityOutflow: mixedOutflows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    linkedDividendFlow: linkedDividendFlows.reduce((sum, flow) => sum + flow.amount, 0),
    nearestOutflow,
  };
}

function topSignalScore(scores: ReturnType<typeof scoreResearchSignals>, signal: ResearchSignal) {
  return scores.find((score) => score.signal === signal)?.score ?? 0;
}

// MMF(현금 버킷) = 실측 예정 지출만큼만 확보. 성향(방어/공격)은 MMF가 아니라 주식/채권 비율로 표현.
function liquidityReservePercent(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  investableKrw?: number,
): number {
  const base = investableKrw && investableKrw > 0 ? investableKrw : (client.assetSize || 0);
  if (base <= 0) return 3; // 자산정보 없으면 최소가드만

  // 실측 지출 기반: 세금×1.1(확정+여유) + 일반비반복×1.0 + 연적자×0.5(6개월 비상현금)
  // (세금/일반은 summarizeCashflows에서 category 하이브리드로 분리·이중계상 제거됨)
  const reserveWon =
    cashflow.taxOutflow * 1.1 +
    cashflow.scheduledOutflow * 1.0 +
    Math.max(0, -cashflow.monthlyNet) * 12 * 0.5;
  const measuredPct = (reserveWon / base) * 100;

  // 구조 플래그 (이번엔 유지 — 별도 결정 사항)
  const flagPct =
    (client.clientType === "corporate" ? 3 : 0) +
    (client.clientType === "sole_proprietor" ? 3 : 0) +
    (client.accountSeparation && client.accountSeparation !== "separated" ? 4 : 0) +
    (client.linkedClientId && client.isMajorityShareholder ? 2 : 0);

  // 최소가드 3%(성향현금 아님, 깡통방지) ~ 상한 60%
  return Math.min(60, Math.max(3, measuredPct + flagPct));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function liquidityReasonsFor(client: Client, cashflow: CashflowPortfolioSummary, investableKrw?: number): string[] {
  const base = investableKrw && investableKrw > 0 ? investableKrw : (client.assetSize || 0);
  const reasons: string[] = [];
  const taxFlowText = client.cashFlows
    .filter((flow) => flow.amount < 0)
    .map((flow) => `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""}`)
    .join(" ");
  const uniqueText = factorValue(client, "unique", "");

  if (/증여/.test(taxFlowText) || /증여/.test(uniqueText)) reasons.push("증여세 납부");
  if (/상속/.test(taxFlowText) || /상속/.test(uniqueText)) reasons.push("상속세 납부");
  if (/법인세/.test(taxFlowText) || /법인세/.test(uniqueText)) reasons.push("법인세 납부");
  if (/양도세/.test(taxFlowText) || /양도세/.test(uniqueText)) reasons.push("양도세 납부");
  if (cashflow.taxOutflow > 0) reasons.push(`taxOutflow ${Math.round(percentOfBase(cashflow.taxOutflow, base))}%`);
  if (cashflow.scheduledOutflow > 0) reasons.push(`scheduledOutflow ${Math.round(percentOfBase(cashflow.scheduledOutflow, base))}%`);
  if (cashflow.monthlyNet < 0) {
    reasons.push(`annualDeficit ${Math.round(percentOfBase(Math.abs(cashflow.monthlyNet) * 12, base))}%`);
  }
  if (cashflow.nearestOutflow) reasons.push(`${cashflow.nearestOutflow.date} ${cashflow.nearestOutflow.label}`);

  return uniqueStrings(reasons).slice(0, 6);
}

function estimateMaxAchievableReturn(
  weights: PortfolioOption["weights"],
  mmfFloorPct: number,
  proxyReturns?: ProxyReturnEstimate[],
): number {
  const rate = (key: keyof typeof PROXY_FALLBACKS): number => {
    const found = proxyReturns?.find((e) => e.key === key);
    return (found ? found.annualizedReturnPct : PROXY_FALLBACKS[key]) / 100;
  };
  const mmfFloor = clampNumber(mmfFloorPct, 0, 100);
  const dollarFloor = clampNumber(weights.dollar, 0, 100 - mmfFloor);
  const investableRiskBudget = Math.max(0, 100 - mmfFloor - dollarFloor);
  const maxReturn =
    investableRiskBudget * rate('sp500') +
    mmfFloor * rate('mmf') +
    dollarFloor * rate('dollar');

  return Math.round(maxReturn * 10) / 10;
}

function aggressiveBenchmarkTargetReturn(
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
  benchmarkTargetReturn?: number,
) {
  // A request to outperform is not a return assumption. It is intentionally
  // left for PB review and must not create a fixed alpha or KPI floor.
  void preference;
  void riskTilt;
  void benchmarkTargetReturn;
  return undefined;
}

function requestedAggressiveReturn(
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
  benchmarkTargetReturn?: number,
) {
  const requests = [
    preference.targetReturn,
    preference.overseasSingleStock ? 15 + riskTilt * 2 : undefined,
    aggressiveBenchmarkTargetReturn(preference, riskTilt, benchmarkTargetReturn),
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return requests.length > 0 ? Math.max(...requests) : undefined;
}

export function evaluatePreferenceFeasibility(
  weights: PortfolioOption["weights"],
  preference: ClientPreferenceProfile,
  options: PreferenceFeasibilityOptions = {},
): PreferenceFeasibilityReport {
  const riskTilt = options.riskTilt ?? 0;
  const metrics = calculateSimulatedMetrics(weights, options.proxyReturns);
  const mmfFloorPct = Math.round((options.mmfFloorPct ?? weights.mmf) * 10) / 10;
  const maxAchievableReturn = estimateMaxAchievableReturn(weights, mmfFloorPct, options.proxyReturns);
  const requestedTargetReturn = requestedAggressiveReturn(preference, riskTilt, options.benchmarkTargetReturn);
  const tolerance = 0.2;
  const suppressedPreferences: string[] = [];
  const conflicts: string[] = [];

  const addSuppression = (key: string) => {
    if (!suppressedPreferences.includes(key)) suppressedPreferences.push(key);
  };

  if (preference.targetReturn && preference.targetReturn > maxAchievableReturn + tolerance) {
    addSuppression("targetReturn");
    conflicts.push(
      `요구 목표수익률 ${preference.targetReturn}%는 MMF floor ${mmfFloorPct}% 기준 최대 가능 수익률 ${maxAchievableReturn}%를 초과합니다.`,
    );
  }

  const benchmarkRequiredReturn = aggressiveBenchmarkTargetReturn(
    preference,
    riskTilt,
    options.benchmarkTargetReturn,
  );
  if (preference.benchmarkOutperformance) {
    addSuppression("benchmarkOutperformance");
    conflicts.push("벤치마크 초과수익 요구는 고정 alpha나 기대수익률 보정에 사용하지 않으며 PB 담당자 확인 항목으로 분리합니다.");
    conflicts.push(
      benchmarkRequiredReturn
        ? `벤치마크 초과수익 가정 ${benchmarkRequiredReturn}%는 현재 비중으로 달성 가능한 상한 ${maxAchievableReturn}%를 초과합니다.`
        : `벤치마크 초과수익 요구는 현재 비중 기반 기대수익률 ${metrics.expectedReturn}%와 별도 검증 없이는 KPI에 반영할 수 없습니다.`,
    );
  }

  if (preference.overseasSingleStock && 15 + riskTilt * 2 > maxAchievableReturn + tolerance) {
    addSuppression("overseasSingleStock");
    conflicts.push(
      `해외 단일종목 집중형 수익 가정은 현재 유동성 reserve 이후 남는 위험예산으로 검증되지 않았습니다.`,
    );
  }

  const aggressiveRiskRequested =
    preference.highRiskAccepted ||
    (options.client ? factorScore(options.client, "risk") >= 4 : false);
  if (aggressiveRiskRequested && suppressedPreferences.length > 0) {
    addSuppression("aggressiveRisk");
  }

  if (suppressedPreferences.length > 0) {
    conflicts.push(
      `KPI는 고객 요구 수익률이 아니라 실제 자산비중 기반 예상 수익률 ${metrics.expectedReturn}%로 표시합니다.`,
    );
  }

  const liquidityReasons =
    options.liquidityReasons ??
    (options.client && options.cashflow
      ? liquidityReasonsFor(options.client, options.cashflow, options.investableKrw)
      : []);

  return {
    feasible: suppressedPreferences.length === 0,
    suppressedPreferences,
    conflicts: uniqueStrings(conflicts),
    weightBasedReturn: metrics.expectedReturn,
    weightBasedVolatility: metrics.volatility,
    requestedTargetReturn,
    maxAchievableReturn,
    mmfFloorPct,
    liquidityReasons,
  };
}

function dollarReservePercent(
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
): number {
  if (preference.rejectsOtherProducts && !preference.overseasSingleStock) return 0;
  const dollarSignal = topSignalScore(signals, "dollar");
  const riskSignal = topSignalScore(signals, "risk");
  const reserve =
    1.5 +
    Math.max(0, dollarSignal) * 0.45 +
    riskSignal * 0.18 +
    (preference.overseasSingleStock ? 3 : 0) +
    (preference.benchmarkTargets.includes("S&P500") ? 2 : 0) +
    riskTilt * 0.8;

  return clampNumber(reserve, 0, preference.overseasSingleStock ? 14 : 10);
}

function assetScoresFromAnalysis(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
  investableKrw?: number,
): Omit<PortfolioOption["weights"], "mmf" | "dollar"> {
  const template = MODEL_PORTFOLIO_TEMPLATES[
    riskTilt < 0 ? "stable" : riskTilt > 0 ? "growth" : "balanced"
  ];
  const scores = factorScoreSummary(client);
  const equitySignal = topSignalScore(signals, "equity");
  const bondSignal = topSignalScore(signals, "bond");
  const riskSignal = topSignalScore(signals, "risk");
  const goldSignal = topSignalScore(signals, "gold");
  // 현금흐름 압력 기준: 투자가능자산 우선, 없으면 총자산 폴백
  const cashflowBase = investableKrw && investableKrw > 0 ? investableKrw : (client.assetSize || 0);
  const taxPct = percentOfBase(cashflow.taxOutflow, cashflowBase);
  const scheduledPct = percentOfBase(cashflow.scheduledOutflow, cashflowBase);

  const growthCapacity =
    (scores.risk - 3) * 14 +
    (scores.return - 3) * 9 +
    (scores.timeHorizon - 3) * 7 -
    (scores.tax - 3) * 5 -
    // Liquidity 점수는 MMF 버킷(경로1)으로 처리 — ETF를 직접 깎지 않음
    Math.max(0, scores.legal - 2) * 5 -
    Math.max(0, scores.unique - 3) * 4 -
    Math.min(14, scheduledPct * 0.25 + taxPct * 0.35) +
    riskTilt * 11;

  const etf =
    template.etf +
    growthCapacity +
    equitySignal * 2.2 +
    (preference.stockOnly ? 42 : 0) +
    (preference.overseasSingleStock ? 16 : 0) +
    (preference.targetReturn ? clampNumber(preference.targetReturn - 8, 0, 22) : 0) +
    (preference.taxPriority ? 24 : 0);

  const bond =
    template.bond -
    growthCapacity * 0.5 +
    bondSignal * 2.1 +
    (scores.tax - 3) * 7 +
    (scores.liquidity - 3) * 4 +
    Math.max(0, scores.legal - 1) * 6 +
    (client.clientType === "corporate" ? 10 : 0) +
    (client.clientType === "sole_proprietor" ? 6 : 0) +
    (client.accountSeparation && client.accountSeparation !== "separated" ? 5 : 0) +
    (cashflow.corporateTaxOutflow > 0 ? 5 : 0) +
    (preference.taxPriority ? 44 : 0) +
    (riskSignal >= 6 ? riskSignal * 1.4 : 0) -
    (preference.stockOnly ? 30 : 0);

  const gold =
    template.gold +
    goldSignal * 1.5 +
    riskSignal * 0.55 +
    (scores.tax >= 4 ? 1 : 0) -
    (preference.stockOnly ? 4 : 0);

  const raw =
    template.raw +
    Math.max(0, goldSignal - 4) * 0.9 +
    (scores.risk >= 4 ? 2 : 0) -
    (scores.liquidity >= 4 ? 2 : 0) -
    (preference.taxPriority || preference.rejectsOtherProducts ? 4 : 0);

  if (preference.rejectsOtherProducts) {
    return { etf: Math.max(etf, 100), bond: 0, els: 0, gold: 0, raw: 0 };
  }

  return {
    etf: Math.max(0, etf),
    bond: Math.max(0, bond),
    els: 0,
    gold: Math.max(0, gold),
    raw: Math.max(0, raw),
  };
}

// 잔여 비중을 자산 점수 비율로 배분 (정규화 전 raw 비중). weightsFromAnalysis가 신호 반영/미반영 두 번 호출.
function splitRemaining(
  scores: Omit<PortfolioOption["weights"], "mmf" | "dollar">,
  remaining: number,
  mmf: number,
  dollar: number,
): PortfolioOption["weights"] {
  const scoreSum = Object.values(scores).reduce((sum, score) => sum + Math.max(0, score), 0);
  if (scoreSum <= 0) {
    return { etf: 0, bond: remaining, els: 0, mmf, gold: 0, dollar, raw: 0 };
  }
  return {
    etf: (remaining * scores.etf) / scoreSum,
    bond: (remaining * scores.bond) / scoreSum,
    els: 0,
    mmf,
    gold: (remaining * scores.gold) / scoreSum,
    dollar,
    raw: (remaining * scores.raw) / scoreSum,
  };
}

function weightsFromAnalysis(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
  investableKrw?: number,
): PortfolioOption["weights"] {
  const template = MODEL_PORTFOLIO_TEMPLATES[
    riskTilt < 0 ? "stable" : riskTilt > 0 ? "growth" : "balanced"
  ];
  const mmf = liquidityReservePercent(client, cashflow, investableKrw); // 신호 무관(실측)

  // 신호 반영 비중
  const dollar = Math.max(template.dollar, dollarReservePercent(signals, preference, riskTilt));
  const withSig = splitRemaining(
    assetScoresFromAnalysis(client, cashflow, signals, preference, riskTilt, investableKrw),
    Math.max(0, 100 - mmf - dollar), mmf, dollar,
  );

  // 신호=[] 미적용 baseline 비중
  const noSignals: ReturnType<typeof scoreResearchSignals> = [];
  const dollarBase = Math.max(template.dollar, dollarReservePercent(noSignals, preference, riskTilt));
  const baseline = splitRemaining(
    assetScoresFromAnalysis(client, cashflow, noSignals, preference, riskTilt, investableKrw),
    Math.max(0, 100 - mmf - dollarBase), mmf, dollarBase,
  );

  // 신호의 자산별 비중 영향을 ±9%p로 clamp(재정규화 후 ~±10%p, 제로섬 대칭) — 비례배분 비대칭 해소
  const clamped = {} as PortfolioOption["weights"];
  (Object.keys(withSig) as (keyof PortfolioOption["weights"])[]).forEach((k) => {
    clamped[k] = Math.max(0, baseline[k] + clampNumber(withSig[k] - baseline[k], -9, 9));
  });
  return normalizeOptionWeights(clamped);
}

function productsFor(
  weights: PortfolioOption["weights"],
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  feasibility?: PreferenceFeasibilityReport,
) {
  const products: string[] = [];
  const suppressed = (key: string) => feasibility?.suppressedPreferences.includes(key) ?? false;
  if (preference.taxPriority) {
    products.push("브라질 국채 비과세 검토 바스켓");
    products.push("국내 상장주식 장내거래 절세 바스켓");
    products.push("개별채권 직접투자 매매차익 비과세 검토");
    products.push("연금저축·IRP 과세이연 KODEX");
  }
  if (preference.overseasSingleStock && !suppressed("overseasSingleStock")) {
    products.push("해외 단일종목 8~12개 집중 바스켓");
    products.push("미국 대형 성장주·AI 반도체 개별주");
  }
  if (preference.targetReturn && preference.targetReturn >= 15 && !suppressed("targetReturn")) {
    products.push(`목표수익률 ${preference.targetReturn}% 요구 반영형`);
  }
  if (preference.benchmarkOutperformance && !suppressed("benchmarkOutperformance")) {
    if (preference.benchmarkTargets.includes("KOSPI")) products.push("KOSPI 초과수익 추구 국내 성장주·반도체 바스켓");
    if (preference.benchmarkTargets.includes("S&P500")) products.push("S&P500 초과수익 추구 미국 성장주·테크 바스켓");
    if (preference.benchmarkTargets.length === 0) products.push("벤치마크 알파 추구 ETF 바스켓");
  }
  if (weights.etf >= 25) {
    products.push(topSignalScore(signals, "equity") >= 5 ? "AI·반도체 핵심 ETF 바스켓" : "글로벌 대표지수 ETF");
  }
  if (weights.bond >= 25) products.push("국고채·우량 회사채 래더");
  if (weights.mmf >= 12) products.push("법인 MMF/RP 유동성 버킷");
  if (weights.dollar >= 5) products.push("달러 MMF·단기 미국채");
  if (weights.gold >= 5) products.push("금 현물/금 ETF 헤지");
  return products.slice(0, 4);
}

function splitWeight(totalWeight: number, ratios: number[]) {
  if (totalWeight <= 0 || ratios.length === 0) return [];
  const ratioSum = ratios.reduce((sum, ratio) => sum + ratio, 0) || 1;
  let used = 0;
  return ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return Math.round((totalWeight - used) * 10) / 10;
    const value = Math.round(((totalWeight * ratio) / ratioSum) * 10) / 10;
    used += value;
    return value;
  });
}

function detail(
  bucket: keyof PortfolioOption["weights"],
  name: string,
  weight: number,
  role: string,
  taxNote: string,
  source: string,
): PortfolioDetailHolding | null {
  if (weight <= 0) return null;
  return { bucket, name, weight, role, taxNote, source };
}

export function buildDetailedHoldings(
  weights: PortfolioOption["weights"],
  preference: ClientPreferenceProfile,
  optionId: PortfolioOption["id"],
): PortfolioDetailHolding[] {
  const details: Array<PortfolioDetailHolding | null> = [];
  const taxPriority = preference.taxPriority;
  const aggressive = optionId === "growth" || preference.stockOnly || preference.benchmarkOutperformance;

  const etf = splitWeight(
    weights.etf,
    taxPriority
      ? aggressive
        ? [30, 25, 20, 15, 10]
        : [30, 25, 20, 15, 10]
      : aggressive
        ? [30, 25, 20, 15, 10]
        : [35, 25, 20, 20],
  );

  if (taxPriority) {
    details.push(
      detail("etf", "삼성전자", etf[0], "국내 상장 대형주 장내거래 후보", "대주주 요건·특수관계자 지분율 확인 전제", "국내 상장주식 절세 후보"),
      detail("etf", "SK하이닉스", etf[1], "반도체 대표주 장내거래 후보", "대주주 요건·매매 시점별 양도세 확인", "국내 상장주식 절세 후보"),
      detail("etf", "KODEX 200TR", etf[2], "국내 대표지수 총수익 ETF", "분배금·매매차익 과세 구조 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX MSCI KOREA TR", etf[3], "국내 대형주 분산 ETF", "TR 구조와 보유계좌 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "현대차", etf[4], "국내 대형 가치주 보완 후보", "대주주 요건·배당소득 과세 확인", "국내 상장주식 절세 후보"),
    );
  } else if (preference.overseasSingleStock) {
    details.push(
      detail("etf", "NVIDIA", etf[0], "AI 반도체 핵심 개별주", "해외주식 양도소득세·환율 변동 확인", "해외 단일종목 후보"),
      detail("etf", "Microsoft", etf[1], "클라우드·AI 플랫폼 개별주", "해외주식 양도소득세 확인", "해외 단일종목 후보"),
      detail("etf", "Apple", etf[2], "미국 대형 기술주 분산", "해외 배당·양도세 확인", "해외 단일종목 후보"),
      detail("etf", "Broadcom", etf[3], "AI 인프라·반도체 보완", "해외주식 양도세 확인", "해외 단일종목 후보"),
      detail("etf", "Eli Lilly", etf[4], "헬스케어 성장 분산", "환율·해외 양도세 확인", "해외 단일종목 후보"),
    );
  } else if (aggressive) {
    details.push(
      detail("etf", "KODEX 미국S&P500", etf[0], "미국 대표지수 핵심", "해외 ETF 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX 미국나스닥100", etf[1], "미국 성장주 비중 확대", "해외 ETF 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX AI반도체핵심장비", etf[2], "AI·반도체 알파 추구", "국내 ETF 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX 인도Nifty50", etf[3], "신흥국 성장 분산", "해외 ETF 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX 200", etf[4], "국내 지수 보완", "국내 ETF 과세 확인", "삼성자산운용 KODEX"),
    );
  } else {
    details.push(
      detail("etf", "KODEX 200TR", etf[0], "국내 대표지수 분산", "분배금·매매차익 과세 구조 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX 미국S&P500", etf[1], "미국 대표지수 핵심", "해외 ETF 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX MSCI KOREA TR", etf[2], "국내 대형주 분산", "TR 구조와 보유계좌 과세 확인", "삼성자산운용 KODEX"),
      detail("etf", "KODEX AI반도체핵심장비", etf[3], "테마 알파 제한 편입", "테마 변동성 확인", "삼성자산운용 KODEX"),
    );
  }

  const bond = splitWeight(weights.bond, taxPriority ? [35, 25, 20, 20] : [35, 30, 20, 15]);
  if (taxPriority) {
    details.push(
      detail("bond", "브라질 국채 만기분산(헤알화)", bond[0], "조세조약상 이자 비과세 검토 후보", "환율·국가위험·조세조약 요건 세무 확인", "브라질 국채 절세 검토"),
      detail("bond", "국고채 3년 직접투자", bond[1], "세금 납부 재원 안정화", "채권 매매차익 과세 여부·이자소득 과세 확인", "채권 직접투자"),
      detail("bond", "AA- 이상 우량 회사채 직접투자", bond[2], "만기매칭 인컴 래더", "이자소득·법인 회계 처리 확인", "우량 회사채"),
      detail("bond", "KODEX 단기채권", bond[3], "단기 유동성 대기", "ETF 분배금 과세 확인", "삼성자산운용 KODEX"),
    );
  } else {
    details.push(
      detail("bond", "KODEX 종합채권(AA-이상)액티브", bond[0], "우량채권 코어", "분배금 과세 확인", "삼성자산운용 KODEX"),
      detail("bond", "KODEX 단기채권", bond[1], "단기 변동성 완충", "분배금 과세 확인", "삼성자산운용 KODEX"),
      detail("bond", "국고채 3년 직접투자", bond[2], "만기매칭 안정자산", "이자소득 과세 확인", "채권 직접투자"),
      detail("bond", "AA- 이상 우량 회사채", bond[3], "인컴 보강", "신용위험·이자소득 과세 확인", "우량 회사채"),
    );
  }

  const mmf = splitWeight(weights.mmf, taxPriority ? [45, 35, 20] : [50, 30, 20]);
  details.push(
    detail("mmf", "법인 MMF", mmf[0], "세금 납부 전 대기자금", "법인 회계·이자소득 처리 확인", "유동성 버킷"),
    detail("mmf", "RP 1~3개월 롤링", mmf[1], "납부월 전 만기매칭", "RP 이자소득 과세 확인", "유동성 버킷"),
    detail("mmf", "CMA 세금 납부 전용 계정", mmf[2], "법인세·증여세 납부 재원 분리", "계좌 목적별 내부 승인 확인", "유동성 버킷"),
  );

  const gold = splitWeight(weights.gold, [70, 30]);
  details.push(
    detail("gold", "KRX 금현물", gold[0], "시장 충격 헤지", "거래 방식별 과세 확인", "금 헤지"),
    detail("gold", "KODEX 골드선물(H)", gold[1], "금 가격 보완 노출", "ETF 과세·선물 롤오버 확인", "삼성자산운용 KODEX"),
  );

  const dollar = splitWeight(weights.dollar, [55, 45]);
  details.push(
    detail("dollar", "달러 MMF", dollar[0], "달러 유동성 대기", "환차익·이자소득 과세 확인", "달러 유동성"),
    detail("dollar", "미국 단기국채 ETF", dollar[1], "단기 달러채 분산", "해외 ETF 과세 확인", "달러 채권"),
  );

  const raw = splitWeight(weights.raw, [60, 40]);
  details.push(
    detail("raw", "KODEX WTI원유선물(H)", raw[0], "원자재 가격 헤지", "선물형 ETF 과세·롤오버 확인", "삼성자산운용 KODEX"),
    detail("raw", "농산물/원자재 분산 ETF", raw[1], "인플레이션 보완", "고변동성·과세 확인", "원자재 보완"),
  );

  return details
    .filter((item): item is PortfolioDetailHolding => Boolean(item))
    .filter((item) => item.weight > 0)
    .map((item) => ({ ...item, weight: Math.round(item.weight * 10) / 10 }));
}

export function preferenceAdjustedMetrics(
  weights: PortfolioOption["weights"],
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
  benchmarkTargetReturn?: number,
  feasibilityReport?: PreferenceFeasibilityReport,
  proxyReturns?: ProxyReturnEstimate[],
) {
  const metrics = calculateSimulatedMetrics(weights, proxyReturns);
  const feasibility =
    feasibilityReport ??
    evaluatePreferenceFeasibility(weights, preference, { riskTilt, benchmarkTargetReturn, proxyReturns });
  const isSuppressed = (key: string) => feasibility.suppressedPreferences.includes(key);

  if (preference.overseasSingleStock && !isSuppressed("overseasSingleStock")) {
    metrics.expectedReturn = Math.max(metrics.expectedReturn, 15 + riskTilt * 2);
    metrics.volatility = Math.max(metrics.volatility, 22 + riskTilt * 4);
    metrics.mdd = Math.min(metrics.mdd, -26 - riskTilt * 5);
    metrics.taxReturn = Math.round(metrics.expectedReturn * 0.846 * 10) / 10;
  }
  if (preference.targetReturn && preference.targetReturn >= 15 && !isSuppressed("targetReturn")) {
    metrics.expectedReturn = Math.max(metrics.expectedReturn, Math.min(24, preference.targetReturn));
    metrics.volatility = Math.max(metrics.volatility, Math.min(36, preference.targetReturn * 1.35));
    metrics.mdd = Math.min(metrics.mdd, -Math.min(42, preference.targetReturn * 1.6));
    metrics.taxReturn = Math.round(metrics.expectedReturn * 0.846 * 10) / 10;
  }
  if (preference.taxPriority) {
    const tier = riskTilt + 1;
    const expectedFloor = [4.8, 5.8, 7.2][tier];
    const expectedCap = [6.5, 8.2, 10.5][tier];
    const volatilityFloor = [6.5, 10, 16][tier];
    const volatilityCap = [10, 16, 28][tier];
    const mddGuide = [-10, -18, -30][tier];
    const taxEfficiency = [0.96, 0.95, 0.93][tier];

    metrics.expectedReturn = Math.min(Math.max(metrics.expectedReturn * 0.62, expectedFloor), expectedCap);
    metrics.volatility = Math.min(Math.max(metrics.volatility * 0.55, volatilityFloor), volatilityCap);
    metrics.mdd = Math.min(metrics.mdd, mddGuide);
    metrics.taxReturn = Math.round(metrics.expectedReturn * taxEfficiency * 10) / 10;
  }
  metrics.expectedReturn = Math.round(metrics.expectedReturn * 10) / 10;
  metrics.volatility = Math.round(metrics.volatility * 10) / 10;
  metrics.mdd = Math.round(Math.max(metrics.mdd, -95) * 10) / 10;
  metrics.taxReturn = Math.round(metrics.taxReturn * 10) / 10;
  return metrics;
}

function optionFromAnalysis(
  meta: (typeof PORTFOLIO_OPTION_META)[number],
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  investableKrw?: number,
  proxyReturns?: ProxyReturnEstimate[],
): PortfolioOption {
  const weights = weightsFromAnalysis(client, cashflow, signals, preference, meta.riskTilt, investableKrw);
  const feasibility = evaluatePreferenceFeasibility(weights, preference, {
    client,
    cashflow,
    riskTilt: meta.riskTilt,
    investableKrw,
    proxyReturns,
  });
  const metrics = preferenceAdjustedMetrics(weights, preference, meta.riskTilt, undefined, feasibility, proxyReturns);
  return {
    id: meta.id,
    name: meta.name,
    weights,
    expectedReturn: metrics.expectedReturn,
    volatility: metrics.volatility,
    mdd: metrics.mdd,
    taxReturn: metrics.taxReturn,
    mainProducts: productsFor(weights, signals, preference, feasibility),
    detailedHoldings: buildDetailedHoldings(weights, preference, meta.id),
  };
}

function buildCalculationSteps(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  recommendedOption: PortfolioOption,
  preferenceFeasibility?: PreferenceFeasibilityReport,
): PortfolioCalculationStep[] {
  const scores = factorScoreSummary(client);
  const factorSummary = FACTOR_META.map((factor) => `${factor.label} ${scores[factor.key]}점`).join(" · ");
  const cashPressurePct = percentOfAssets(
    cashflow.scheduledOutflow + Math.max(0, -cashflow.monthlyNet) * 12,
    client,
  );
  const topSignals = signals
    .slice(0, 3)
    .map((signal) => `${signal.label} ${signal.score > 0 ? "+" : ""}${signal.score}`)
    .join(" · ");
  const requirementText = preference.hasRequirement
    ? `${preference.tags.join(" · ")}${preferenceFeasibility && !preferenceFeasibility.feasible ? " (공격적 수익·위험 KPI 미반영)" : ""}`
    : "별도 강한 요구조건 없음";
  const assetLabels: Record<keyof PortfolioOption["weights"], string> = {
    etf: "주식/ETF",
    bond: "채권",
    els: "채권 인컴",
    mmf: "MMF/RP",
    gold: "금",
    dollar: "달러",
    raw: "원자재",
  };
  const allocationText = (Object.entries(recommendedOption.weights) as Array<[keyof PortfolioOption["weights"], number]>)
    .filter(([, weight]) => weight > 0)
    .map(([asset, weight]) => `${assetLabels[asset]} ${weight}%`)
    .join(" · ");

  return [
    {
      order: 1,
      title: "7요인 분석",
      detail: factorSummary,
      impact: "목표수익률·위험·기간은 성장예산을, 세금·유동성·법적·고유상황은 방어예산과 상품 제약을 결정했습니다.",
    },
    {
      order: 2,
      title: "현금흐름 분석",
      detail: `월 순현금흐름 ${formatKRWShortLocal(cashflow.monthlyNet)}, 세금성 예정 유출 ${formatKRWShortLocal(cashflow.taxOutflow)}, 전체 필요현금 압력 ${Math.round(cashPressurePct)}%`,
      impact: "필요 현금과 세금 납부 재원은 먼저 MMF/RP·달러성 현금 버킷으로 분리했습니다.",
    },
    {
      order: 3,
      title: "리포트 및 리서치 분석",
      detail: topSignals || "리서치 신호 중립",
      impact: "최신 리서치 신호는 주식·채권·달러·금/원자재의 상대 점수에만 반영하고, 현금흐름 제약을 넘지 않게 제한했습니다.",
    },
    {
      order: 4,
      title: "고객 요구조건 반영",
      detail: requirementText,
      impact: preferenceFeasibility && !preferenceFeasibility.feasible
        ? "명시 요구조건이 MMF/RP 선확보와 충돌해 공격적 수익·위험 가정은 KPI에 반영하지 않고 PB 세부 커스텀 조정 알림으로 남겼습니다."
        : "명시 요구조건은 자산군 점수에 가산/차감하고, 현금화 일정과 충돌하는 경우 PB 확인 경고로 남겼습니다.",
    },
    {
      order: 5,
      title: "포트폴리오 산출",
      detail: `${recommendedOption.name}: ${allocationText}`,
      impact: "앞 단계의 점수와 제약을 정규화해 최종 비중을 계산했습니다. 고정 포트폴리오를 먼저 놓고 사후 조정하지 않습니다.",
    },
  ];
}

function clientSummaryFrom(client: Client, cashflow: CashflowPortfolioSummary): ClientSummary {
  const riskScore = factorScore(client, "risk");
  const riskName = riskScore >= 4 ? "적극투자형" : riskScore <= 2 ? "안정추구형" : "균형투자형";
  const liquidityNeed = cashflow.nearestOutflow
    ? `${cashflow.nearestOutflow.date} ${cashflow.nearestOutflow.label}`
    : factorValue(client, "liquidity", "중");
  const taxSensitivity = factorScore(client, "tax") >= 4 || cashflow.taxOutflow > 0 ? "높음" : "보통";
  const segmentRequirements: string[] = [];
  if (client.clientType === "sole_proprietor") {
    segmentRequirements.push(
      client.accountSeparation === "mixed"
        ? "개인사업자 통장 혼용으로 사업비/생활비 분리 확인 전 투자 가능 현금 보수적 반영"
        : client.accountSeparation === "separated"
          ? "개인사업자 사업자금과 개인 생활자금 분리 확인"
          : "개인사업자 통장 분리 여부 미확인으로 PB 추가 확인 필요",
    );
  }
  if (client.linkedClientId) {
    segmentRequirements.push(
      `연동 고객이 있어 배당·법인세·지분율(${client.ownershipPct ?? "미입력"}%)의 개인 현금흐름 영향 중복 반영 점검`,
    );
  }

  return {
    clientType: `${CLIENT_TYPE_LABEL[client.clientType]} 고액자산가`,
    riskPropensity: `${riskName} (${riskScore}점)`,
    investmentPeriod: factorValue(client, "timeHorizon", "투자기간 미입력"),
    liquidityNeed,
    taxSensitivity,
    keyRequirements: [
      cashflow.taxOutflow > 0
        ? `세금성 예정 유출 ${formatKRWShortLocal(cashflow.taxOutflow)}을 별도 유동성으로 분리`
        : "세금성 예정 유출은 입력값 기준 낮음",
      cashflow.monthlyNet >= 0
        ? `월 순현금흐름 ${formatKRWShortLocal(cashflow.monthlyNet)} 흑자 기반 정기 투자 가능`
        : `월 순현금흐름 ${formatKRWShortLocal(cashflow.monthlyNet)}로 방어적 현금관리 필요`,
      factorValue(client, "unique", "고유상황 미입력"),
      ...segmentRequirements,
    ],
  };
}

function macroReportFrom(items: MarketResearchItem[], signals: ReturnType<typeof scoreResearchSignals>): MacroReport {
  const topItems = items.slice(0, 3).map((item) => item.title).join(" / ");
  return {
    title: `최신 리서치 ${items.length}개 자동 반영`,
    date: new Date().toISOString().slice(0, 10),
    factors: {
      interestRate: {
        label: "금리 (Interest Rate)",
        outlook: topSignalScore(signals, "bond") > 0 ? "금리·국채 관련 이슈가 최신 리포트에 반복 등장" : "금리 신호는 중립",
        implication: "세금 납부일 이전까지는 단기채·RP·MMF 중심, 잉여자금은 채권 래더로 분산",
      },
      exchangeRate: {
        label: "환율 (FX)",
        outlook: topSignalScore(signals, "dollar") > 0 ? "환율·달러 관련 리포트 신호 확인" : "환율 신호는 보조 변수",
        implication: "대규모 달러 일괄 매수보다 달러 MMF와 환헤지 ETF로 분할 접근",
      },
      inflation: {
        label: "인플레이션/원자재",
        outlook: topSignalScore(signals, "gold") > 0 ? "유가·금·원자재 키워드가 헤지 필요성을 보강" : "실물자산은 제한 편입",
        implication: "금·원자재는 핵심 수익원이 아니라 변동성 완충용 3~8% 범위로 제한",
      },
      stockMarket: {
        label: "주식시장 (Equity Market)",
        outlook: topSignalScore(signals, "equity") > 0 ? `주식·AI·반도체 신호 확인: ${topItems}` : "주식 신호는 중립",
        implication: "성장 테마는 ETF 바스켓으로 접근하되 세금·현금화 일정 전에는 비중을 과도하게 높이지 않음",
      },
    },
  };
}

function suitabilityFrom(client: Client, cashflow: CashflowPortfolioSummary, signals: ReturnType<typeof scoreResearchSignals>): AssetSuitability[] {
  const highTax = factorScore(client, "tax") >= 4 || cashflow.taxOutflow > 0;
  const highRiskSignal = topSignalScore(signals, "risk") >= 8;
  const mixedBusinessCash = client.clientType === "sole_proprietor" && client.accountSeparation !== "separated";

  return [
    {
      category: "ETF",
      status: highRiskSignal ? "주의" : "적합",
      reason: highRiskSignal
        ? "최신 리포트에 변동성·조정 신호가 있어 테마 ETF는 분산 바스켓과 단계적 진입이 필요"
        : "시장 리포트의 주식·AI·실적 모멘텀을 반영하기 좋은 핵심 성장 자산",
    },
    {
      category: "채권",
      status: "적합",
      reason: highTax
        ? "세금 납부 재원과 법인 유동성 관리를 위해 우량채·단기채 래더가 필요"
        : "금리 변동성 구간에서 포트폴리오의 변동성을 낮추는 방어축",
    },
    {
      category: "채권 인컴 보완",
      status: highRiskSignal || client.clientType === "corporate" || mixedBusinessCash ? "주의" : "적합",
      reason: mixedBusinessCash
        ? "사업자통장 혼용 또는 미확인 상태에서는 조기상환·만기 현금화 일정이 사업 운영자금과 충돌하지 않는지 먼저 확인"
        : "구조와 만기, 조기상환 조건을 PB가 검토한 뒤 제한 비중으로만 편입",
    },
    {
      category: "MMF/RP",
      status: "적합",
      reason: mixedBusinessCash
        ? "사업 운영자금, 생활비, 부가세·종합소득세 예비금을 분리 확인할 때까지 우선 대기자금으로 활용"
        : cashflow.taxOutflow > 0
        ? `세금성 유출 ${formatKRWShortLocal(cashflow.taxOutflow)}의 현금화 목표일을 맞추기 위한 필수 버킷`
        : "상담 후 추가 출자·생활 이벤트를 대비하는 즉시 유동성 버킷",
    },
    {
      category: "금",
      status: topSignalScore(signals, "gold") > 0 ? "적합" : "주의",
      reason: "유가·물가·지정학 리스크 헤지용으로 3~8% 내 제한 편입",
    },
    {
      category: "달러",
      status: "주의",
      reason: "환율 레벨 부담을 고려해 달러 MMF·단기 미국채 중심으로 분할 접근",
    },
    {
      category: "원자재",
      status: "비추천",
      reason: "고액 법인 고객의 세금 납부일 관리에는 직접 원자재보다 금·현금성 헤지가 더 적합",
    },
  ];
}

function holding(product: KodexProduct, weight: number): PensionHolding {
  return { product, weight };
}

function buildTaxPainPoints(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  preference: ClientPreferenceProfile,
): TaxPainPoint[] {
  const fullText = [
    factorValue(client, "unique", ""),
    factorValue(client, "tax", ""),
    client.consultationNotes ?? "",
    preference.rawText,
  ].join(" ");

  const sourceById: Record<TaxPainId, TaxPainPoint["source"]> = {
    "financial-income": TAX_PAIN_SOURCES.financialIncome,
    "inheritance-gift": TAX_PAIN_SOURCES.inheritanceGift,
    "stock-capital-gain": TAX_PAIN_SOURCES.stockGain,
    "real-estate-tax": TAX_PAIN_SOURCES.realEstate,
    "tax-exempt-products": TAX_PAIN_SOURCES.brazilBond,
  };
  const whyById: Record<TaxPainId, string> = {
    "financial-income": "이자·배당소득이 커질수록 종합과세 구간과 건강보험료 영향까지 함께 점검해야 합니다.",
    "inheritance-gift": "상속·증여는 세액과 납부재원 규모가 커져 사전 증여, 평가, 현금화 일정이 포트폴리오 설계에 직접 영향을 줍니다.",
    "stock-capital-gain": "대주주, 해외주식, 비상장주식, IPO 보호예수는 매도시점과 세금 납부월이 투자 의사결정에 직접 연결됩니다.",
    "real-estate-tax": "보유세와 부동산 양도세 납부 규모가 커지면 금융자산 현금화 일정과 단기채/MMF 비중을 먼저 정해야 합니다.",
    "tax-exempt-products": "세금 민감도가 높으면 기대수익률만이 아니라 실제 세후수익률, 계좌 한도, 상품 자격을 함께 비교해야 합니다.",
  };
  const responseById: Record<TaxPainId, string> = {
    "financial-income": "금융소득 과세 구조 점검 필요",
    "inheritance-gift": "삼성헤리티지 컨설팅 검토 필요 (증여·상속 구조 상담)",
    "stock-capital-gain": "주식 양도세 신고·매도시점 전문 상담 권고",
    "real-estate-tax": "부동산 보유·양도 구조 전문 상담 필요",
    "tax-exempt-products": "비과세·분리과세·과세이연 후보 비교 상담 권고",
  };

  return scoreTaxPainPoints({
    client,
    fullText,
    taxPriority: preference.taxPriority,
    taxFactorScore: factorScore(client, "tax"),
    taxOutflowWon: cashflow.taxOutflow,
  })
    .map((point) => ({
      ...point,
      whyItMatters: whyById[point.id],
      portfolioResponse: responseById[point.id],
      source: sourceById[point.id],
    }))
    .slice(0, 6);
}

function riskAssetWeight(holdings: PensionHolding[]) {
  return holdings
    .filter((item) => item.product.assetClass !== "채권/현금성")
    .reduce((sum, item) => sum + item.weight, 0);
}

function pensionPortfolio(
  accountType: PensionPortfolio["accountType"],
  holdings: PensionHolding[],
  note: string,
): PensionPortfolio {
  const riskWeight = riskAssetWeight(holdings);
  return {
    accountType,
    riskAssetWeight: riskWeight,
    safeAssetWeight: 100 - riskWeight,
    holdings,
    note,
  };
}

function buildKodexTaxSavingPlan(
  client: Client,
  cashflow: CashflowPortfolioSummary,
  preference: ClientPreferenceProfile,
): TaxSavingPlan {
  const riskScore = factorScore(client, "risk");
  const aggressive = !preference.taxPriority && (riskScore >= 4 || preference.stockOnly || preference.benchmarkOutperformance || (preference.targetReturn ?? 0) >= 15);
  const stable = preference.taxPriority || riskScore <= 2 || cashflow.taxOutflow > client.assetSize * 0.03;
  const taxText = `${factorValue(client, "tax", "")} ${client.ips.tax.notes} ${preference.rawText}`;
  const lowerIncomeHint = /5500|5,500|4500|4,500|저소득|총급여.*이하|종합소득.*이하/.test(taxText);
  const creditRate = lowerIncomeHint ? 0.165 : 0.132;

  const pensionHoldings = aggressive
    ? [
        holding(KODEX_PRODUCTS.sp500, 45),
        holding(KODEX_PRODUCTS.sp500Active, 20),
        holding(KODEX_PRODUCTS.aiSemi, 15),
        holding(KODEX_PRODUCTS.india, 10),
        holding(KODEX_PRODUCTS.shortBond, 10),
      ]
    : stable
      ? [
          holding(KODEX_PRODUCTS.aggregateBond, 35),
          holding(KODEX_PRODUCTS.shortBond, 25),
          holding(KODEX_PRODUCTS.sp500, 25),
          holding(KODEX_PRODUCTS.msciKorea, 10),
          holding(KODEX_PRODUCTS.kofr, 5),
        ]
      : [
          holding(KODEX_PRODUCTS.sp500, 35),
          holding(KODEX_PRODUCTS.msciKorea, 15),
          holding(KODEX_PRODUCTS.aiSemi, 10),
          holding(KODEX_PRODUCTS.aggregateBond, 25),
          holding(KODEX_PRODUCTS.shortBond, 15),
        ];

  const irpHoldings = aggressive
    ? [
        holding(KODEX_PRODUCTS.sp500, 40),
        holding(KODEX_PRODUCTS.sp500Active, 20),
        holding(KODEX_PRODUCTS.aiSemi, 10),
        holding(KODEX_PRODUCTS.shortBond, 15),
        holding(KODEX_PRODUCTS.aggregateBond, 15),
      ]
    : stable
      ? [
          holding(KODEX_PRODUCTS.aggregateBond, 40),
          holding(KODEX_PRODUCTS.shortBond, 25),
          holding(KODEX_PRODUCTS.financialBond, 10),
          holding(KODEX_PRODUCTS.sp500, 20),
          holding(KODEX_PRODUCTS.msciKorea, 5),
        ]
      : [
          holding(KODEX_PRODUCTS.sp500, 35),
          holding(KODEX_PRODUCTS.msciKorea, 15),
          holding(KODEX_PRODUCTS.aiSemi, 10),
          holding(KODEX_PRODUCTS.aggregateBond, 25),
          holding(KODEX_PRODUCTS.shortBond, 15),
        ];

  const clientFit = client.clientType === "corporate"
    ? "법인 자체 세액공제 계좌가 아니라 대표·임원 개인 소득 기준의 연금저축/IRP 검토안입니다."
    : "개인 고객의 연금저축/IRP 세액공제와 과세이연을 함께 활용하는 검토안입니다.";
  const taxCreditBase = 9_000_000;

  return {
    enabled: true,
    clientFit,
    annualContributionLimit: 18_000_000,
    taxCreditBase,
    pensionSavingContribution: 6_000_000,
    irpContribution: 3_000_000,
    creditRate,
    estimatedCredit: Math.round(taxCreditBase * creditRate),
    portfolios: [
      pensionPortfolio(
        "연금저축펀드",
        pensionHoldings,
        aggressive
          ? "연금저축은 위험자산 한도 제한이 없어 성장형 KODEX 비중을 높인 안입니다."
          : "연금저축에서 주식형과 채권형 KODEX를 함께 담아 장기 과세이연 효과를 노립니다.",
      ),
      pensionPortfolio(
        "IRP",
        irpHoldings,
        "IRP는 위험자산 70% 한도를 넘지 않도록 채권/현금성 KODEX를 30% 이상 배치했습니다.",
      ),
    ],
    solutions: [
      ...(preference.taxPriority
        ? [
            "세금 최우선 요구가 있어 연금저축·IRP는 성장형보다 과세이연·안전자산 비중을 우선한 KODEX 조합으로 제안합니다.",
            "일반 금융자산은 브라질 국채 비과세 요건, 국내 상장주식 소액주주 장내거래 여부, 개별채권 직접투자 매매차익 과세 여부를 세무 검토 체크리스트로 올립니다.",
          ]
        : []),
      "세액공제 한도 활용 순서는 연금저축 600만원을 먼저 채우고 IRP 300만원을 추가해 합산 900만원을 맞추는 방식으로 제안합니다.",
      `예상 세액공제액은 소득구간 확인 전 기본 ${Math.round(creditRate * 1000) / 10}% 가정 기준 ${formatKRWShortLocal(Math.round(taxCreditBase * creditRate))}입니다.`,
      "연금저축+IRP 합산 납입한도는 연 1,800만원이지만 세액공제 대상은 기본 합산 900만원으로 분리해 안내합니다.",
      "ISA 만기자금이 있으면 만기 후 60일 이내 연금계좌 이전 시 이체금액의 10%, 최대 300만원 추가 세액공제 가능성을 별도 확인합니다.",
    ],
    sources: [
      { label: "KODEX 연금투자 가능 ETF 목록", url: "https://www.samsungfund.com/etf/product/pensionlist.do" },
      { label: "삼성 KODEX 연금 세액공제 가이드", url: "https://m.samsungfund.com/upload/kodex/newsroom/20260427141121713.pdf" },
      { label: "국세청 연금계좌 세액공제 안내", url: "https://www.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7875" },
      { label: "국세청 주식 양도소득세 신고대상 안내", url: "https://s.nts.go.kr/asan/na/ntt/selectNttInfo.do?mi=2201&nttSn=1348384" },
      { label: "삼일PwC 브라질채권 비과세 검토", url: "https://www.pwc.com/kr/ko/insights/issue-brief/one-point-tax-10.html" },
    ],
  };
}

function computeAssetLayer(heldAssets?: HeldAssets): AssetLayerSummary | null {
  if (!heldAssets || heldAssets.totalKrw <= 0) return null;
  const { stocksKrw, realEstateKrw, cashKrw, totalKrw } = heldAssets;
  const investableKrw = totalKrw - realEstateKrw;
  const stocksPct = (stocksKrw / totalKrw) * 100;
  const realEstatePct = (realEstateKrw / totalKrw) * 100;
  const cashPct = (cashKrw / totalKrw) * 100;
  const realEstateWarning =
    realEstateKrw / totalKrw >= REAL_ESTATE_WARNING_THRESHOLD
      ? `부동산 비중 ${Math.round(realEstatePct)}% — 과집중. 유동성·분산 검토 및 전문가 상담 권고`
      : null;
  return { totalKrw, investableKrw, stocksPct, realEstatePct, cashPct, realEstateWarning };
}

export function buildPortfolioViewModel(
  client: Client,
  researchItems: MarketResearchItem[] = FALLBACK_MARKET_RESEARCH,
  heldAssets?: HeldAssets,
  proxyReturns?: ProxyReturnEstimate[],
): PortfolioViewModel {
  const items = researchItems.length > 0 ? researchItems : FALLBACK_MARKET_RESEARCH;
  const researchSignals = scoreResearchSignals(items);
  const cashflowSummary = summarizeCashflows(client.cashFlows);
  const preferenceProfile = parsePreferenceProfile(client);
  const investableKrw = heldAssets && heldAssets.totalKrw > 0
    ? heldAssets.totalKrw - heldAssets.realEstateKrw
    : undefined;
  const portfolioOptions = PORTFOLIO_OPTION_META.map((meta) =>
    optionFromAnalysis(meta, client, cashflowSummary, researchSignals, preferenceProfile, investableKrw, proxyReturns),
  );
  const scores = factorScoreSummary(client);
  const taxPressurePct = percentOfAssets(cashflowSummary.taxOutflow, client);
  const cashPressurePct = percentOfAssets(
    cashflowSummary.scheduledOutflow + Math.max(0, -cashflowSummary.monthlyNet) * 12,
    client,
  );
  const recommendedId =
    client.clientType === "sole_proprietor" && client.accountSeparation !== "separated"
      ? "stable"
      : preferenceProfile.taxPriority
      ? "stable"
      : scores.liquidity >= 4 || scores.legal >= 4 || taxPressurePct >= 5 || cashPressurePct >= 25
        ? "stable"
      : preferenceProfile.stockOnly || preferenceProfile.benchmarkOutperformance || (preferenceProfile.targetReturn ?? 0) >= 15
      ? "growth"
      : scores.risk >= 4 && scores.timeHorizon >= 4 && taxPressurePct < 3 && cashPressurePct < 15
      ? "growth"
      : "balanced";
  const recommendedOption = portfolioOptions.find((option) => option.id === recommendedId) ?? portfolioOptions[1];
  const recommendedMeta =
    PORTFOLIO_OPTION_META.find((meta) => meta.id === recommendedOption.id) ?? PORTFOLIO_OPTION_META[1];
  const preferenceFeasibility = evaluatePreferenceFeasibility(recommendedOption.weights, preferenceProfile, {
    client,
    cashflow: cashflowSummary,
    riskTilt: recommendedMeta.riskTilt,
    investableKrw,
    proxyReturns,
  });
  const topResearch = items.slice(0, 4).map((item) => `${item.source} '${item.title}'`).join(", ");
  const highSignal = researchSignals[0] ?? { label: "중립", score: 0, signal: "risk" as ResearchSignal };
  const clientSummary = clientSummaryFrom(client, cashflowSummary);
  const macroReport = macroReportFrom(items, researchSignals);
  const taxSavingPlan = buildKodexTaxSavingPlan(client, cashflowSummary, preferenceProfile);
  const taxPainPoints = buildTaxPainPoints(client, cashflowSummary, preferenceProfile);
  const preferenceText = preferenceProfile.hasRequirement
    ? preferenceFeasibility.feasible
      ? `${preferenceProfile.tags.join(", ")}를 고객 요구조건으로 감지했습니다. ${preferenceProfile.actions.join(" ")} ${preferenceProfile.warnings.join(" ")}`
      : `${preferenceProfile.tags.join(", ")}를 고객 요구조건으로 감지했지만 현재 유동성 제약으로 달성 불가합니다. 공격적 수익·위험 가정은 포트폴리오 KPI에 반영하지 않고 PB 세부 커스텀 조정 필요 알림으로 분리했습니다. ${preferenceFeasibility.conflicts.join(" ")}`
    : "고유상황에 별도 상품 제약이나 목표수익률 요구가 없어 표준 고액자산가 유동성 버킷을 적용했습니다.";

  const rationale: PortfolioRationale = {
    market: `${topResearch} 등 최신 ${items.length}개 리포트/기사에서 ${highSignal.label} 신호가 가장 강하게 관찰되어 해당 자산군을 기준 비중보다 보강했습니다.`,
    client: `${client.name} 고객은 ${clientSummary.clientType}이며 위험성향은 ${clientSummary.riskPropensity}, 투자기간은 ${clientSummary.investmentPeriod}로 반영했습니다.`,
    cashflow: `현금흐름 입력값 기준 월 유입 ${formatKRWShortLocal(cashflowSummary.monthlyIncome)}, 월 유출 ${formatKRWShortLocal(cashflowSummary.monthlyOutflow)}, 월 순현금흐름 ${formatKRWShortLocal(cashflowSummary.monthlyNet)}입니다.`,
    tax: client.clientType === "sole_proprietor" && client.accountSeparation !== "separated"
      ? "개인사업자 통장 혼용/미확인 상태이므로 사업 매출 전체를 투자 가능 현금으로 보지 않고, 사업비·생활비·부가세/종합소득세 예비금을 먼저 분리합니다. 세무·회계 성격은 상담용 추정이며 전문가 확인이 필요합니다."
      : client.linkedClientId && cashflowSummary.linkedDividendFlow !== 0
        ? "법인-대표 연동 고객으로 배당 지급과 개인 배당 유입이 중복 반영되지 않도록 동일 기준월 메모를 확인하고, 법인세 납부 후 실제 배당 가능 재원을 보수적으로 반영합니다."
        : cashflowSummary.taxOutflow > 0
      ? preferenceProfile.taxPriority
        ? `세금성 예정 유출 ${formatKRWShortLocal(cashflowSummary.taxOutflow)}을 커버하는 동시에, 브라질 국채 비과세 검토·국내 상장주식 장내거래·개별채권 직접투자·연금계좌 과세이연처럼 세후 효율이 높은 후보를 우선 배치했습니다.`
        : `법인세·증여세·양도세 등 세금성 예정 유출 ${formatKRWShortLocal(cashflowSummary.taxOutflow)}을 우선 커버하도록 MMF/RP와 채권 비중을 높였습니다.`
      : "명시된 대형 세금 납부 이벤트가 없어 시장 신호와 위험성향 중심으로 배분했습니다.",
    unique: factorValue(client, "unique", "고유상황 입력값이 없어 표준 고액자산가 유동성 버킷을 적용했습니다."),
    preference: preferenceText,
  };

  // 유동성 버킷 금액 기준: 투자가능자산(부동산 제외) 우선, 없으면 총자산 폴백
  const allocationBase = heldAssets && heldAssets.totalKrw > 0
    ? heldAssets.totalKrw - heldAssets.realEstateKrw  // investableKrw
    : (client.assetSize || 0);
  // 단기유동성 표시 상한: 투자가능자산의 60%(MMF cap 60%와 정합). 자산정보 없으면 3억 폴백.
  const liquidityCapManwon = allocationBase > 0
    ? Math.round((allocationBase * 0.60) / 10_000)
    : 30_000;
  const liquidityReserveManwon = Math.max(
    1_000,
    Math.min(
      liquidityCapManwon,
      Math.round((allocationBase * (recommendedOption.weights.mmf + recommendedOption.weights.dollar)) / 100 / 10_000) ||
        Math.round((cashflowSummary.taxOutflow || allocationBase * 0.03) / 10_000),
    ),
  );
  const calculationSteps = buildCalculationSteps(
    client,
    cashflowSummary,
    researchSignals,
    preferenceProfile,
    recommendedOption,
    preferenceFeasibility,
  );

  const assetLayer = computeAssetLayer(heldAssets);

  return {
    clientSummary,
    macroReport,
    portfolioOptions,
    assetSuitability: suitabilityFrom(client, cashflowSummary, researchSignals),
    cashflowSummary,
    researchItems: items,
    researchSignals,
    rationale,
    preferenceProfile,
    preferenceFeasibility,
    taxSavingPlan,
    taxPainPoints,
    executiveConclusion: `${recommendedOption.name}을 기본안으로 제안합니다. 7요인 분석, 현금흐름 분석, 최신 리서치의 ${highSignal.label} 신호를 반영해 비중을 산출했습니다. ${preferenceProfile.hasRequirement && !preferenceFeasibility.feasible ? "고객 고유 요구조건의 공격적 수익·위험 가정은 실제 비중으로 달성 불가해 KPI에서 제외했습니다." : preferenceProfile.hasRequirement ? "고객 고유 요구조건은 달성 가능 범위에서 반영했습니다." : "고객 입력 조건 기준으로 산출했습니다."}`,
    recommendedId,
    liquidityReserveManwon,
    calculationSteps,
    assetLayer,
  };
}
