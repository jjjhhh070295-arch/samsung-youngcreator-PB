// ★팀원 구현 영역 — 포트폴리오 생성 (현재는 더미 스캐폴드)
//
// 화면·타입·저장·PB 수정 UI는 동작하게 만들어 두고,
// 숫자 산출 로직만 더미로 비워둔다. 팀원이 이 함수 본문만 교체하면 실동작한다.

import type { Client, Portfolio, AssetAllocation } from "./types";

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