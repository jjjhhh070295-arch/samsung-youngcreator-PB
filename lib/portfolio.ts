// ★팀원 구현 영역 — 포트폴리오 생성 (현재는 더미 스캐폴드)
//
// 화면·타입·저장·PB 수정 UI는 동작하게 만들어 두고,
// 숫자 산출 로직만 더미로 비워둔다. 팀원이 이 함수 본문만 교체하면 실동작한다.

import type { Client, Portfolio, AssetAllocation, CashFlow, FactorKey } from "./types";
import {
  FALLBACK_MARKET_RESEARCH,
  scoreResearchSignals,
  type MarketResearchItem,
  type ResearchSignal,
} from "./portfolioResearch";

function alloc(assetClass: string, weight: number): AssetAllocation {
  return { assetClass, weight };
}

function uid(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 8);
}

// 위험 허용도 점수(risk.score, 1~5)에 따라 주식 비중만 대충 조정하는 단순 규칙.
// TODO(팀원): RRTTLLU·현금흐름·세금을 반영한 실제 최적화 로직으로 교체.
export function generatePortfolios(client: Client): Portfolio[] {
  const riskScore = client.ips?.risk?.score ?? 3; // 근거 없으면 중립 가정(더미)
  const equityBias = Math.max(0, Math.min(4, riskScore - 1)); // 0~4

  // 3개 후보: 안정형 / 균형형 / 성장형
  const stable: Portfolio = {
    id: uid("pf"),
    label: "안정형",
    allocations: [
      alloc("국내주식", 10),
      alloc("해외주식", 10),
      alloc("채권", 50),
      alloc("대체투자", 10),
      alloc("현금", 20),
    ],
    expectedReturn: 4.0,
    expectedRisk: 5.0,
    taxNote: "TODO(팀원): 세금(금소세·법인세 등) 반영한 메모로 교체. (더미)",
    rationale:
      "TODO(팀원): 실제 최적화 근거로 교체. (더미) 원금 보전 중시, 채권·현금 비중 높음.",
    editedByPb: false,
  };

  const balanced: Portfolio = {
    id: uid("pf"),
    label: "균형형",
    allocations: [
      alloc("국내주식", 20 + equityBias),
      alloc("해외주식", 20 + equityBias),
      alloc("채권", 35 - equityBias),
      alloc("대체투자", 15),
      alloc("현금", 10 - equityBias),
    ],
    expectedReturn: 6.0,
    expectedRisk: 9.0,
    taxNote: "TODO(팀원): 세금 메모. (더미)",
    rationale:
      "TODO(팀원): 실제 근거로 교체. (더미) 위험점수에 따라 주식 비중 가변.",
    editedByPb: false,
  };

  const growth: Portfolio = {
    id: uid("pf"),
    label: "성장형",
    allocations: [
      alloc("국내주식", 30 + equityBias),
      alloc("해외주식", 35 + equityBias),
      alloc("채권", 15 - equityBias),
      alloc("대체투자", 15),
      alloc("현금", 5 - equityBias),
    ],
    expectedReturn: 8.5,
    expectedRisk: 14.0,
    taxNote: "TODO(팀원): 세금 메모. (더미)",
    rationale:
      "TODO(팀원): 실제 근거로 교체. (더미) 장기·고위험 감내 시 후보.",
    editedByPb: false,
  };

  // 비중 합 100 보정 (더미값이 음수/초과되지 않도록)
  return [stable, balanced, growth].map(normalizeWeights);
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

// ==========================================
// MOCK DATA
// ==========================================

export const mockClientSummary: ClientSummary = {
  clientType: '자산가형 Young Creator',
  riskPropensity: '적극투자형 (Risk Chaser)',
  investmentPeriod: '3년 ~ 5년 (중장기)',
  liquidityNeed: '중 (1년 내 스타트업 추가 출자 가능성 존재)',
  taxSensitivity: '높음 (금융소득종합과세 대상자)',
  keyRequirements: [
    '증시 변동성을 방어하면서도 알파 수익 추구',
    '절세 효과를 극대화할 수 있는 채권 및 ISA 활용 희망',
    '향후 사업 자금 활용을 위한 일정 수준의 유동성 버퍼 필요'
  ]
};

export const mockMacroReport: MacroReport = {
  title: '삼성증권 6월 글로벌 자산배부 전략 리포트',
  date: '2026-06-01',
  factors: {
    interestRate: {
      label: '금리 (Interest Rate)',
      outlook: '연준 기준금리 동결 후 하반기 완만한 인하 기조 전망',
      implication: '듀레이션이 긴 채권 자산의 점진적 비중 확대 유효'
    },
    exchangeRate: {
      label: '환율 (FX)',
      outlook: '달러/원 환율 1,320원 ~ 1,360원 박스권 상단 정체',
      implication: '환헤지(H) 상품 중심 접근 및 달러 분할 매수 분리'
    },
    inflation: {
      label: '인플레이션 (Inflation)',
      outlook: '헤드라인 CPI 둔화세 완만하나 근원 물가 하방 경직성 존재',
      implication: '실물 자산(금, 원자재)의 위험 헤지용 일부 편입 권장'
    },
    stockMarket: {
      label: '주식시장 (Equity Market)',
      outlook: 'AI 및 반도체 섹터 주도 차별화 장세, 고밸류 부담 존재',
      implication: '지수 추종보다는 핵심 테마 ETF 및 배당 성장주 위주 대응'
    }
  }
};

export const mockPortfolioOptions: PortfolioOption[] = [
  {
    id: 'stable',
    name: '안정형 포트폴리오 (Stable)',
    expectedReturn: 4.2,
    volatility: 2.1,
    mdd: -1.5,
    taxReturn: 3.9,
    weights: { etf: 10, bond: 50, els: 5, mmf: 25, gold: 5, dollar: 5, raw: 0 },
    mainProducts: ['삼성 국고채 3년 ETF', '대동 Prime 상환사채', '정기예금 연계형 ELB'],
    detailedHoldings: [],
  },
  {
    id: 'balanced',
    name: '균형형 포트폴리오 (Balanced)',
    expectedReturn: 6.8,
    volatility: 5.4,
    mdd: -6.2,
    taxReturn: 6.1,
    weights: { etf: 35, bond: 35, els: 10, mmf: 10, gold: 5, dollar: 5, raw: 0 },
    mainProducts: ['KODEX 200', '삼성 단기채권 우량 펀드', '지수연계 노낙인 ELS'],
    detailedHoldings: [],
  },
  {
    id: 'growth',
    name: '수익추구형 포트폴리오 (Growth)',
    expectedReturn: 10.5,
    volatility: 11.2,
    mdd: -14.8,
    taxReturn: 9.2,
    weights: { etf: 60, bond: 15, els: 10, mmf: 5, gold: 5, dollar: 5, raw: 0 },
    mainProducts: ['KODEX 미국반도체MV', '삼성 미국S&P500동일가중', '글로벌 테크 ELS'],
    detailedHoldings: [],
  }
];

export const mockAssetSuitability: AssetSuitability[] = [
  { category: 'ETF', status: '적합', reason: '시장 트렌드 대응 및 글로벌 분산 투자에 최적화' },
  { category: '채권', status: '적합', reason: '절세 혜택 및 금리 인하 분위기 속 자본차익 기대 가능' },
  { category: 'ELS/ELB', status: '주의', reason: '기초자산 변동성 점검 필요, 조기상환 조건 확인 필수' },
  { category: 'MMF/RP', status: '적합', reason: '창업 및 추가 출자 대기를 위한 단기 유동성 확보에 필수적' },
  { category: '금', status: '주의', reason: '인플레이션 헤지 수단이나 포트폴리오의 5% 내외 제한 편입 권장' },
  { category: '달러', status: '주의', reason: '환율 박스권 상단으로 대량 매수보다는 포지션 유지 관점' },
  { category: '원자재', status: '비추천', reason: '현재 원자재 시장 변동성이 극대화되어 적극투자형에게도 제한적 접근 필요' }
];

// 간단한 시뮬레이션 계산 로직 (PB 편집 시 지표 연동용)
export function calculateSimulatedMetrics(weights: PortfolioOption['weights']) {
  // 실제 정밀 엔진 대신 MVP용 가중치 기반 근사치 계산 로직
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const normalized = total === 0 ? weights : weights; 

  const expReturn = (normalized.etf * 0.12) + (normalized.bond * 0.045) + (normalized.els * 0.07) + (normalized.mmf * 0.035) + (normalized.gold * 0.05) + (normalized.dollar * 0.02);
  const vol = (normalized.etf * 0.15) + (normalized.bond * 0.03) + (normalized.els * 0.08) + (normalized.mmf * 0.005) + (normalized.gold * 0.10) + (normalized.dollar * 0.06);

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
  severity: "상" | "중" | "점검";
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
  taxSavingPlan: TaxSavingPlan;
  taxPainPoints: TaxPainPoint[];
  executiveConclusion: string;
  recommendedId: PortfolioOption["id"];
  liquidityReserveManwon: number;
}

const factorValue = (client: Client, key: FactorKey, fallback = "미입력") =>
  client.ips?.[key]?.value || client.ips?.[key]?.inferenceHint || fallback;

const factorScore = (client: Client, key: FactorKey, fallback = 3) =>
  client.ips?.[key]?.score ?? fallback;

// 7요인 보강 틸팅 — 기존 adjustedWeights가 안 쓰던 목표수익률·투자기간·법적을 비중에 반영.
// (risk/tax/liquidity/unique는 adjustedWeights에서 이미 반영 → 중복 방지 위해 여기선 제외)
// 점수 3=중립이라 미채점/중립이면 변화 0. 최종은 normalizeOptionWeights가 0~100·합100 보정.
function applySevenFactorTilt(
  weights: PortfolioOption["weights"],
  client: Client,
): PortfolioOption["weights"] {
  const ret = factorScore(client, "return"); // 1~5 (중립 3)
  const time = factorScore(client, "timeHorizon"); // 1~5 (중립 3)
  const legal = factorScore(client, "legal", 1); // 1~5 (제약없음 1)

  // 목표수익률↑ → 위험자산↑·채권↓
  weights.etf += (ret - 3) * 4;
  weights.bond -= (ret - 3) * 2;
  // 투자기간↑ → 위험자산↑·단기현금↓ (길수록 변동성 감내 여력↑)
  weights.etf += (time - 3) * 3;
  weights.mmf -= (time - 3) * 2;
  // 법적 제약↑ → 복잡상품(ELS) 축소 → 채권으로 이전
  const legalCut = (legal - 1) * 2;
  weights.els -= legalCut;
  weights.bond += legalCut;

  return weights;
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
    /kospi|코스피|kospi200|코스피200/i.test(lower) ? "KOSPI200" : "",
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
    actions.push("채권·ELS·원자재 비중을 낮추고 성장자산 비중을 우선 배정했습니다.");
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
    bond: clampWeight(weights.bond),
    els: clampWeight(weights.els),
    mmf: clampWeight(weights.mmf),
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

function summarizeCashflows(cashFlows: CashFlow[]): CashflowPortfolioSummary {
  const recurring = cashFlows.filter((flow) => flow.recurring);
  const scheduled = cashFlows.filter((flow) => !flow.recurring && flow.amount < 0);
  const taxFlows = cashFlows.filter((flow) =>
    /세|법인세|증여|상속|양도|재산|종부|tax/i.test(flow.label),
  );
  const nearestOutflow = scheduled.slice().sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"))[0];
  const monthlyIncome = recurring.filter((flow) => flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const monthlyOutflow = recurring.filter((flow) => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);

  return {
    monthlyIncome,
    monthlyOutflow,
    monthlyNet: monthlyIncome - monthlyOutflow,
    scheduledOutflow: scheduled.reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    taxOutflow: taxFlows.filter((flow) => flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0),
    nearestOutflow,
  };
}

function topSignalScore(scores: ReturnType<typeof scoreResearchSignals>, signal: ResearchSignal) {
  return scores.find((score) => score.signal === signal)?.score ?? 0;
}

function adjustedWeights(
  base: PortfolioOption["weights"],
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
): PortfolioOption["weights"] {
  const riskScore = factorScore(client, "risk");
  const taxScore = factorScore(client, "tax");
  const liquidityScore = factorScore(client, "liquidity");
  const uniqueText = factorValue(client, "unique", "");
  const hasLargeTax = cashflow.taxOutflow > client.assetSize * 0.03 || cashflow.taxOutflow >= 500_000_000;
  const hasNearLiquidityNeed = Boolean(cashflow.nearestOutflow) || /증여|상속|ipo|m&a|매각|출자|법인세/i.test(uniqueText);

  const weights = { ...base };

  weights.etf += riskTilt * 6 + (riskScore - 3) * 4 + Math.min(8, topSignalScore(signals, "equity"));
  weights.bond += -riskTilt * 5 + Math.min(8, topSignalScore(signals, "bond")) + (taxScore >= 4 ? 4 : 0);
  weights.mmf += Math.min(10, topSignalScore(signals, "liquidity")) + (hasNearLiquidityNeed ? 6 : 0);
  weights.dollar += Math.min(6, Math.ceil(topSignalScore(signals, "dollar") / 2));
  weights.gold += Math.min(5, Math.ceil(topSignalScore(signals, "gold") / 3));
  weights.raw += topSignalScore(signals, "gold") > 6 ? 2 : 0;

  if (client.clientType === "corporate") {
    weights.bond += 3;
    weights.mmf += 4;
    weights.els -= 2;
  }

  if (taxScore >= 4 || hasLargeTax) {
    weights.mmf += 5;
    weights.bond += 4;
    weights.etf -= 6;
  }

  if (liquidityScore >= 4 || hasNearLiquidityNeed) {
    weights.mmf += 5;
    weights.els -= 2;
  }

  if (topSignalScore(signals, "risk") >= 8) {
    weights.etf -= 5;
    weights.bond += 3;
    weights.mmf += 4;
  }

  if (preference.stockOnly) {
    weights.etf += preference.overseasSingleStock ? 35 : 22;
    weights.bond -= 20;
    weights.els -= 10;
    weights.gold -= 4;
    weights.raw = 0;
    weights.dollar = preference.overseasSingleStock ? Math.max(weights.dollar, 4) : weights.dollar;
  }

  if (preference.rejectsOtherProducts) {
    weights.bond = 0;
    weights.els = 0;
    weights.gold = 0;
    weights.raw = 0;
    weights.dollar = 0;
    weights.mmf = 0;
    weights.etf = 100 - weights.dollar - weights.mmf;
  }

  if (preference.targetReturn && preference.targetReturn >= 15) {
    weights.etf += Math.min(18, Math.round(preference.targetReturn - 10));
    weights.bond -= 8;
    weights.mmf -= preference.rejectsOtherProducts ? 0 : 4;
  }

  if (preference.benchmarkOutperformance) {
    weights.etf += preference.highRiskAccepted ? 28 + riskTilt * 5 : 18 + riskTilt * 4;
    weights.bond -= preference.highRiskAccepted ? 15 : 10;
    weights.mmf -= preference.highRiskAccepted ? 8 : 4;
    weights.els -= 3;
    weights.gold -= 2;
    weights.raw += preference.benchmarkTargets.includes("KOSPI200") ? 2 : 0;
    weights.dollar += preference.benchmarkTargets.includes("S&P500") ? 3 : 0;
  }

  if (preference.taxPriority) {
    weights.bond += 18 - riskTilt * 2;
    weights.mmf += 8;
    weights.etf += riskTilt === 1 ? 4 : -4;
    weights.els -= 8;
    weights.gold -= 2;
    weights.raw = 0;
    weights.dollar = Math.max(3, weights.dollar - 2);
  }

  // 7요인 보강(목표수익률·투자기간·법적) — 정규화 직전 한 줄로 적용
  applySevenFactorTilt(weights, client);

  return normalizeOptionWeights(weights);
}

function productsFor(
  weights: PortfolioOption["weights"],
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
) {
  const products: string[] = [];
  if (preference.taxPriority) {
    products.push("브라질 국채 비과세 검토 바스켓");
    products.push("국내 상장주식 장내거래 절세 바스켓");
    products.push("개별채권 직접투자 매매차익 비과세 검토");
    products.push("연금저축·IRP 과세이연 KODEX");
  }
  if (preference.overseasSingleStock) {
    products.push("해외 단일종목 8~12개 집중 바스켓");
    products.push("미국 대형 성장주·AI 반도체 개별주");
  }
  if (preference.targetReturn && preference.targetReturn >= 15) {
    products.push(`목표수익률 ${preference.targetReturn}% 요구 반영형`);
  }
  if (preference.benchmarkOutperformance) {
    if (preference.benchmarkTargets.includes("KOSPI200")) products.push("KOSPI200 초과수익 추구 국내 성장주·반도체 바스켓");
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
  if (weights.els > 0) products.push("노낙인 지수형 ELS/ELB");
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

  const els = splitWeight(weights.els, [60, 40]);
  details.push(
    detail("els", "S&P500·EuroStoxx50 노낙인 ELS", els[0], "쿠폰형 제한 편입", "파생결합증권 과세·중도상환 위험 확인", "ELS/ELB 검토"),
    detail("els", "원금지급형 ELB", els[1], "현금성 대체 수익 보완", "발행사 신용위험·과세 확인", "ELS/ELB 검토"),
  );

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
) {
  const metrics = calculateSimulatedMetrics(weights);
  if (preference.overseasSingleStock) {
    metrics.expectedReturn = Math.max(metrics.expectedReturn, 15 + riskTilt * 2);
    metrics.volatility = Math.max(metrics.volatility, 22 + riskTilt * 4);
    metrics.mdd = Math.min(metrics.mdd, -26 - riskTilt * 5);
    metrics.taxReturn = Math.round(metrics.expectedReturn * 0.846 * 10) / 10;
  }
  if (preference.targetReturn && preference.targetReturn >= 15) {
    metrics.expectedReturn = Math.max(metrics.expectedReturn, Math.min(24, preference.targetReturn));
    metrics.volatility = Math.max(metrics.volatility, Math.min(36, preference.targetReturn * 1.35));
    metrics.mdd = Math.min(metrics.mdd, -Math.min(42, preference.targetReturn * 1.6));
    metrics.taxReturn = Math.round(metrics.expectedReturn * 0.846 * 10) / 10;
  }
  if (preference.benchmarkOutperformance) {
    const targetCount = Math.max(1, preference.benchmarkTargets.length);
    const tier = riskTilt + 1;
    const internalAggressiveReturn = preference.highRiskAccepted
      ? [35, 55, 80][tier]
      : [18, 28, 42][tier];
    const benchmarkFloor =
      typeof benchmarkTargetReturn === "number" && Number.isFinite(benchmarkTargetReturn)
        ? benchmarkTargetReturn + [4, 8, 14][tier]
        : 0;
    const targetReturn = Math.min(300, Math.max(internalAggressiveReturn, benchmarkFloor));
    metrics.expectedReturn = Math.max(metrics.expectedReturn, targetReturn);
    metrics.volatility = Math.max(
      metrics.volatility,
      preference.highRiskAccepted ? [42, 68, 95][tier] : [24, 38, 56][tier],
      Math.min(180, metrics.expectedReturn * (preference.highRiskAccepted ? 0.75 : 0.5)),
    );
    const tierMdd = preference.highRiskAccepted ? [-55, -75, -95][tier] : [-35, -55, -80][tier];
    const volatilityMddCap = preference.highRiskAccepted ? [60, 82, 95][tier] : [42, 62, 85][tier];
    metrics.mdd = Math.min(
      metrics.mdd,
      tierMdd,
      -Math.min(volatilityMddCap, metrics.volatility * (preference.highRiskAccepted ? 0.9 : 0.75)),
    );
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

function optionFromBase(
  base: PortfolioOption,
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  preference: ClientPreferenceProfile,
  riskTilt: -1 | 0 | 1,
): PortfolioOption {
  const weights = adjustedWeights(base.weights, client, cashflow, signals, preference, riskTilt);
  const metrics = preferenceAdjustedMetrics(weights, preference, riskTilt);
  return {
    ...base,
    weights,
    expectedReturn: metrics.expectedReturn,
    volatility: metrics.volatility,
    mdd: metrics.mdd,
    taxReturn: metrics.taxReturn,
    mainProducts: productsFor(weights, signals, preference),
    detailedHoldings: buildDetailedHoldings(weights, preference, base.id),
  };
}

function clientSummaryFrom(client: Client, cashflow: CashflowPortfolioSummary): ClientSummary {
  const riskScore = factorScore(client, "risk");
  const riskName = riskScore >= 4 ? "적극투자형" : riskScore <= 2 ? "안정추구형" : "균형투자형";
  const liquidityNeed = cashflow.nearestOutflow
    ? `${cashflow.nearestOutflow.date} ${cashflow.nearestOutflow.label}`
    : factorValue(client, "liquidity", "중");
  const taxSensitivity = factorScore(client, "tax") >= 4 || cashflow.taxOutflow > 0 ? "높음" : "보통";

  return {
    clientType: client.clientType === "corporate" ? "법인 고액자산가" : "개인 고액자산가",
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
      category: "ELS/ELB",
      status: highRiskSignal || client.clientType === "corporate" ? "주의" : "적합",
      reason: "구조와 만기, 조기상환 조건을 PB가 검토한 뒤 제한 비중으로만 편입",
    },
    {
      category: "MMF/RP",
      status: "적합",
      reason: cashflow.taxOutflow > 0
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
  const uniqueText = factorValue(client, "unique", "");
  const fullText = `${uniqueText} ${factorValue(client, "tax", "")} ${client.consultationNotes ?? ""} ${preference.rawText}`;
  const financialIncomeAmount = client.cashFlows
    .filter((flow) => /금융소득|이자|배당/i.test(flow.label) && flow.amount > 0)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const points: TaxPainPoint[] = [];

  const add = (point: TaxPainPoint) => {
    if (!points.some((item) => item.id === point.id)) points.push(point);
  };

  if (financialIncomeAmount >= 20_000_000 || preference.taxPriority || client.assetSize >= 5_000_000_000) {
    add({
      id: "financial-income",
      label: "금융소득종합과세와 이자·배당 집중",
      severity: financialIncomeAmount >= 20_000_000 ? "상" : "중",
      whyItMatters: "고액자산가는 예금·채권·배당 소득이 커지면서 종합과세 구간과 건강보험료 영향까지 함께 고민하는 경우가 많습니다.",
      portfolioResponse: "이자·배당 과세가 커지는 상품을 줄이고, 개별채권 직접투자·만기 분산·과세이연 계좌를 우선 검토합니다.",
      source: TAX_PAIN_SOURCES.financialIncome,
    });
  }

  if (/증여|상속|가업승계|승계|오너|2세|자녀/i.test(fullText)) {
    add({
      id: "inheritance-gift",
      label: "상속·증여세와 가업승계 재원",
      severity: "상",
      whyItMatters: "상속·증여는 과세표준이 커질수록 세율 부담이 급격히 커져, 납부재원과 사전 증여 설계가 핵심 고충이 됩니다.",
      portfolioResponse: "증여세 납부월 이전 현금화 버킷을 분리하고, 잔여 운용자금은 세후 효율이 높은 채권·상장주식·연금계좌 검토안으로 나눕니다.",
      source: TAX_PAIN_SOURCES.inheritanceGift,
    });
  }

  if (/ipo|보호예수|상장|대주주|주식|해외주식|양도세|지분/i.test(fullText)) {
    add({
      id: "stock-capital-gain",
      label: "대주주·해외주식 양도소득세",
      severity: "상",
      whyItMatters: "상장주식 대주주, 장외거래, 비상장주식, 해외주식은 양도세 신고·납부 일정과 가족 합산 판단이 포트폴리오 의사결정에 직접 영향을 줍니다.",
      portfolioResponse: "국내 상장주식은 장내거래·대주주 요건을 점검하고, 해외주식은 손익통산·매도시점·세금 납부월을 반영해 리밸런싱합니다.",
      source: TAX_PAIN_SOURCES.stockGain,
    });
  }

  if (/부동산|종부|재산세|양도|상가|토지|주택/i.test(fullText) || cashflow.taxOutflow >= 500_000_000) {
    add({
      id: "real-estate-tax",
      label: "종부세·재산세·부동산 양도세",
      severity: /부동산|종부|재산세|양도/i.test(fullText) ? "상" : "중",
      whyItMatters: "고가 부동산과 법인 보유 부동산은 보유세와 양도세 납부 규모가 커져 금융자산 현금화 일정까지 흔드는 경우가 많습니다.",
      portfolioResponse: "부동산 세금 납부예정액은 MMF/RP·단기채로 먼저 잠그고, 위험자산은 납부 이후 잔여 현금흐름 기준으로 배치합니다.",
      source: TAX_PAIN_SOURCES.realEstate,
    });
  }

  if (preference.taxPriority) {
    add({
      id: "tax-exempt-products",
      label: "비과세·분리과세·과세이연 상품 선별",
      severity: "상",
      whyItMatters: "세금 최소화가 최우선이면 단순 기대수익률보다 실제 세후수익률, 계좌 한도, 조세조약 요건이 더 중요합니다.",
      portfolioResponse: "브라질 국채 비과세 요건, 국내 상장주식 장내거래, 개별채권 매매차익, 연금저축·IRP 과세이연을 우선 검토합니다.",
      source: TAX_PAIN_SOURCES.brazilBond,
    });
    add({
      id: "pension-accounts",
      label: "연금저축·IRP 세액공제와 과세이연 한도",
      severity: "점검",
      whyItMatters: "개인 고액자산가나 법인 오너·임원은 세액공제 한도와 과세이연 계좌 활용 여부가 매년 반복되는 절세 의사결정입니다.",
      portfolioResponse: "대표·임원 개인 기준으로 연금저축 600만원, IRP 포함 900만원 세액공제 대상 여부를 확인하고 KODEX 안전자산형 조합을 제안합니다.",
      source: TAX_PAIN_SOURCES.pension,
    });
  }

  return points.slice(0, 6);
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

export function buildPortfolioViewModel(
  client: Client,
  researchItems: MarketResearchItem[] = FALLBACK_MARKET_RESEARCH,
): PortfolioViewModel {
  const items = researchItems.length > 0 ? researchItems.slice(0, 30) : FALLBACK_MARKET_RESEARCH;
  const researchSignals = scoreResearchSignals(items);
  const cashflowSummary = summarizeCashflows(client.cashFlows);
  const preferenceProfile = parsePreferenceProfile(client);
  const portfolioOptions = [
    optionFromBase(mockPortfolioOptions[0], client, cashflowSummary, researchSignals, preferenceProfile, -1),
    optionFromBase(mockPortfolioOptions[1], client, cashflowSummary, researchSignals, preferenceProfile, 0),
    optionFromBase(mockPortfolioOptions[2], client, cashflowSummary, researchSignals, preferenceProfile, 1),
  ];
  const recommendedId =
    preferenceProfile.taxPriority
      ? "stable"
      : preferenceProfile.stockOnly || preferenceProfile.benchmarkOutperformance || (preferenceProfile.targetReturn ?? 0) >= 15
      ? "growth"
      : factorScore(client, "risk") >= 4 && cashflowSummary.taxOutflow < client.assetSize * 0.03
      ? "growth"
      : cashflowSummary.taxOutflow > client.assetSize * 0.05 || factorScore(client, "liquidity") >= 4
        ? "stable"
        : "balanced";
  const topResearch = items.slice(0, 4).map((item) => `${item.source} '${item.title}'`).join(", ");
  const highSignal = researchSignals[0];
  const clientSummary = clientSummaryFrom(client, cashflowSummary);
  const macroReport = macroReportFrom(items, researchSignals);
  const taxSavingPlan = buildKodexTaxSavingPlan(client, cashflowSummary, preferenceProfile);
  const taxPainPoints = buildTaxPainPoints(client, cashflowSummary, preferenceProfile);
  const preferenceText = preferenceProfile.hasRequirement
    ? `${preferenceProfile.tags.join(", ")}를 고객 요구조건으로 감지했습니다. ${preferenceProfile.actions.join(" ")} ${preferenceProfile.warnings.join(" ")}`
    : "고유상황에 별도 상품 제약이나 목표수익률 요구가 없어 표준 고액자산가 유동성 버킷을 적용했습니다.";

  const rationale: PortfolioRationale = {
    market: `${topResearch} 등 최신 ${items.length}개 리포트/기사에서 ${highSignal.label} 신호가 가장 강하게 관찰되어 해당 자산군을 기준 비중보다 보강했습니다.`,
    client: `${client.name} 고객은 ${clientSummary.clientType}이며 위험성향은 ${clientSummary.riskPropensity}, 투자기간은 ${clientSummary.investmentPeriod}로 반영했습니다.`,
    cashflow: `현금흐름 입력값 기준 월 유입 ${formatKRWShortLocal(cashflowSummary.monthlyIncome)}, 월 유출 ${formatKRWShortLocal(cashflowSummary.monthlyOutflow)}, 월 순현금흐름 ${formatKRWShortLocal(cashflowSummary.monthlyNet)}입니다.`,
    tax: cashflowSummary.taxOutflow > 0
      ? preferenceProfile.taxPriority
        ? `세금성 예정 유출 ${formatKRWShortLocal(cashflowSummary.taxOutflow)}을 커버하는 동시에, 브라질 국채 비과세 검토·국내 상장주식 장내거래·개별채권 직접투자·연금계좌 과세이연처럼 세후 효율이 높은 후보를 우선 배치했습니다.`
        : `법인세·증여세·양도세 등 세금성 예정 유출 ${formatKRWShortLocal(cashflowSummary.taxOutflow)}을 우선 커버하도록 MMF/RP와 채권 비중을 높였습니다.`
      : "명시된 대형 세금 납부 이벤트가 없어 시장 신호와 위험성향 중심으로 배분했습니다.",
    unique: factorValue(client, "unique", "고유상황 입력값이 없어 표준 고액자산가 유동성 버킷을 적용했습니다."),
    preference: preferenceText,
  };

  const recommendedOption = portfolioOptions.find((option) => option.id === recommendedId) ?? portfolioOptions[1];
  const liquidityReserveManwon = Math.max(
    5_000,
    Math.min(30_000, Math.round((cashflowSummary.taxOutflow || client.assetSize * 0.03) / 10_000)),
  );

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
    taxSavingPlan,
    taxPainPoints,
    executiveConclusion: `${recommendedOption.name}을 기본안으로 제안합니다. 최신 리서치의 ${highSignal.label} 신호와 ${preferenceProfile.hasRequirement ? "고객 고유 요구조건" : "고객 7요인"}을 함께 반영하되, ${preferenceProfile.taxPriority ? "세후 효율과 절세 가능성" : `${client.name} 고객의 세금·현금화 일정`}을 우선 점검했습니다.`,
    recommendedId,
    liquidityReserveManwon,
  };
}
