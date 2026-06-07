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
    mainProducts: ['삼성 국고채 3년 ETF', '대동 Prime 상환사채', '정기예금 연계형 ELB']
  },
  {
    id: 'balanced',
    name: '균형형 포트폴리오 (Balanced)',
    expectedReturn: 6.8,
    volatility: 5.4,
    mdd: -6.2,
    taxReturn: 6.1,
    weights: { etf: 35, bond: 35, els: 10, mmf: 10, gold: 5, dollar: 5, raw: 0 },
    mainProducts: ['KODEX 200', '삼성 단기채권 우량 펀드', '지수연계 노낙인 ELS']
  },
  {
    id: 'growth',
    name: '수익추구형 포트폴리오 (Growth)',
    expectedReturn: 10.5,
    volatility: 11.2,
    mdd: -14.8,
    taxReturn: 9.2,
    weights: { etf: 60, bond: 15, els: 10, mmf: 5, gold: 5, dollar: 5, raw: 0 },
    mainProducts: ['KODEX 미국반도체MV', '삼성 미국S&P500동일가중', '글로벌 테크 ELS']
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
  executiveConclusion: string;
  recommendedId: PortfolioOption["id"];
  liquidityReserveManwon: number;
}

const factorValue = (client: Client, key: FactorKey, fallback = "미입력") =>
  client.ips?.[key]?.value || client.ips?.[key]?.inferenceHint || fallback;

const factorScore = (client: Client, key: FactorKey, fallback = 3) =>
  client.ips?.[key]?.score ?? fallback;

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

  return normalizeOptionWeights(weights);
}

function productsFor(weights: PortfolioOption["weights"], signals: ReturnType<typeof scoreResearchSignals>) {
  const products: string[] = [];
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

function optionFromBase(
  base: PortfolioOption,
  client: Client,
  cashflow: CashflowPortfolioSummary,
  signals: ReturnType<typeof scoreResearchSignals>,
  riskTilt: -1 | 0 | 1,
): PortfolioOption {
  const weights = adjustedWeights(base.weights, client, cashflow, signals, riskTilt);
  const metrics = calculateSimulatedMetrics(weights);
  return {
    ...base,
    weights,
    expectedReturn: metrics.expectedReturn,
    volatility: metrics.volatility,
    mdd: metrics.mdd,
    taxReturn: metrics.taxReturn,
    mainProducts: productsFor(weights, signals),
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

export function buildPortfolioViewModel(
  client: Client,
  researchItems: MarketResearchItem[] = FALLBACK_MARKET_RESEARCH,
): PortfolioViewModel {
  const items = researchItems.length > 0 ? researchItems.slice(0, 20) : FALLBACK_MARKET_RESEARCH;
  const researchSignals = scoreResearchSignals(items);
  const cashflowSummary = summarizeCashflows(client.cashFlows);
  const portfolioOptions = [
    optionFromBase(mockPortfolioOptions[0], client, cashflowSummary, researchSignals, -1),
    optionFromBase(mockPortfolioOptions[1], client, cashflowSummary, researchSignals, 0),
    optionFromBase(mockPortfolioOptions[2], client, cashflowSummary, researchSignals, 1),
  ];
  const recommendedId =
    factorScore(client, "risk") >= 4 && cashflowSummary.taxOutflow < client.assetSize * 0.03
      ? "growth"
      : cashflowSummary.taxOutflow > client.assetSize * 0.05 || factorScore(client, "liquidity") >= 4
        ? "stable"
        : "balanced";
  const topResearch = items.slice(0, 4).map((item) => `${item.source} '${item.title}'`).join(", ");
  const highSignal = researchSignals[0];
  const clientSummary = clientSummaryFrom(client, cashflowSummary);
  const macroReport = macroReportFrom(items, researchSignals);

  const rationale: PortfolioRationale = {
    market: `${topResearch} 등 최신 ${items.length}개 리포트/기사에서 ${highSignal.label} 신호가 가장 강하게 관찰되어 해당 자산군을 기준 비중보다 보강했습니다.`,
    client: `${client.name} 고객은 ${clientSummary.clientType}이며 위험성향은 ${clientSummary.riskPropensity}, 투자기간은 ${clientSummary.investmentPeriod}로 반영했습니다.`,
    cashflow: `현금흐름 입력값 기준 월 유입 ${formatKRWShortLocal(cashflowSummary.monthlyIncome)}, 월 유출 ${formatKRWShortLocal(cashflowSummary.monthlyOutflow)}, 월 순현금흐름 ${formatKRWShortLocal(cashflowSummary.monthlyNet)}입니다.`,
    tax: cashflowSummary.taxOutflow > 0
      ? `법인세·증여세·양도세 등 세금성 예정 유출 ${formatKRWShortLocal(cashflowSummary.taxOutflow)}을 우선 커버하도록 MMF/RP와 채권 비중을 높였습니다.`
      : "명시된 대형 세금 납부 이벤트가 없어 시장 신호와 위험성향 중심으로 배분했습니다.",
    unique: factorValue(client, "unique", "고유상황 입력값이 없어 표준 고액자산가 유동성 버킷을 적용했습니다."),
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
    executiveConclusion: `${recommendedOption.name}을 기본안으로 제안합니다. 최신 리서치의 ${highSignal.label} 신호를 반영하되, ${client.name} 고객의 세금·현금화 일정을 우선 커버하도록 MMF/RP와 채권 버킷을 별도 확보했습니다.`,
    recommendedId,
    liquidityReserveManwon,
  };
}
