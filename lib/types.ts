// ── 데이터 모델 (BLUEPRINT §4) ──

export interface PB {
  id: string;
  code: string; // "PB-001"
  name: string;
  createdAt: string;
}

export type ClientType = "individual" | "corporate";

// RRTTLLU 7요인 키
export type FactorKey =
  | "return"
  | "risk"
  | "timeHorizon"
  | "tax"
  | "liquidity"
  | "legal"
  | "unique";

// 근거 상태 3단계
//  explicit = 상담에 직접 근거 있음 → 점수 부여 + evidence 인용
//  inferred = 직접 언급 없으나 추론 단서 있음 → 점수 비움, inferenceHint만 참고 제시
//  empty    = 근거·단서 모두 없음 → 완전 공백
export type FactorStatus = "explicit" | "inferred" | "empty";

export interface IPSFactor {
  value: string; // 핵심 값/설명 (예: "연 6~8%"). 공백 허용("").
  score: number | null; // 1~5 점수. 명시적 근거(explicit)일 때만. 아니면 null.
  notes: string; // 상세 메모
  source: "manual" | "ai"; // 직접 입력 / AI 분석
  status: FactorStatus;
  evidence: string; // explicit일 때 점수 근거가 된 상담 원문 구절 인용
  inferenceHint: string; // inferred일 때 추론 단서 설명(점수 미반영, PB 참고용)
  reviewed: boolean; // PB가 검토·확정했는지. AI 결과는 false(draft)로 시작.
}

export interface IPS {
  return: IPSFactor;
  risk: IPSFactor;
  timeHorizon: IPSFactor;
  tax: IPSFactor;
  liquidity: IPSFactor;
  legal: IPSFactor;
  unique: IPSFactor;
}

export interface Client {
  id: string;
  code: string; // "C-2026-0001"
  clientType: ClientType;
  name: string;
  birthDate: string; // YYYY-MM-DD (개인=생년월일, 법인=설립일)
  assignedPbId: string;
  assetSize: number; // 원
  consultationNotes: string; // 최신 전문 텍스트
  ips: IPS; // 최신 RRTTLLU
  cashFlows: CashFlow[]; // 현금흐름 (포트폴리오 입력)
  portfolios: Portfolio[]; // 포트폴리오 후보 (팀원 더미 → 실구현)
  stages: Stages; // 단계별 PB 확정 상태
  createdAt: string;
}

// ── 상담 단계 (PB가 단계별로 확정) ──
export type StageKey = "basic" | "factors" | "cashflow" | "portfolio" | "stress" | "ips";

export type Stages = Partial<Record<StageKey, boolean>>;

export const STAGE_META: {
  key: StageKey;
  label: string;
  desc: string;
  auto: boolean; // true=데이터로 자동 판정 / false=수동 확정(더미)
}[] = [
  { key: "basic", label: "기본 정보", desc: "고객 기본사항 입력", auto: true },
  { key: "factors", label: "7요인 분석", desc: "RRTTLLU 7요인 검토 확정", auto: true },
  { key: "cashflow", label: "현금흐름", desc: "예상 유입/유출 입력", auto: true },
  { key: "portfolio", label: "포트폴리오", desc: "후보 구성 (더미)", auto: true },
  { key: "stress", label: "스트레스 테스트", desc: "시나리오 검정 (더미)", auto: false },
  { key: "ips", label: "IPS 문서", desc: "투자정책서 출력 (더미)", auto: false },
];

// 단계별 완료 여부 — 6단계 모두 PB가 직접 확정(수동). client.stages 플래그 기반.
export function computeStages(client: Client): Record<StageKey, boolean> {
  const s = client.stages ?? {};
  return {
    basic: !!s.basic,
    factors: !!s.factors,
    cashflow: !!s.cashflow,
    portfolio: !!s.portfolio,
    stress: !!s.stress,
    ips: !!s.ips,
  };
}

// ── 현금흐름 (포트폴리오 입력 데이터) ──
export interface CashFlow {
  id: string;
  label: string; // 예: "급여", "주택 구입", "자녀 학자금"
  amount: number; // 원. 양수=유입, 음수=유출
  date: string; // 예상 시점 YYYY-MM
  recurring: boolean; // 정기 반복 여부
}

// ── 포트폴리오 (★팀원 구현 영역 — 더미 스캐폴드) ──
export interface AssetAllocation {
  assetClass: string; // 예: "국내주식","해외주식","채권","대체투자","현금"
  weight: number; // 비중 %, 합계 100
}
// 포트폴리오가 참고한 리포트 스냅샷 (확정 시점에 박제)
export interface ReferencedReport {
  title: string;
  source: string;
  url: string;
  date: string | null;
  summary: string;
  signals: { signal: string; direction: -1 | 0 | 1; strength: number; evidence: string }[];
}

export interface Portfolio {
  id: string;
  label: string; // "안정형" | "균형형" | "성장형"
  allocations: AssetAllocation[];
  expectedReturn: number; // 예상 연수익률 % (더미값)
  expectedRisk: number; // 예상 변동성 % (더미값)
  taxNote: string; // 세금 고려 메모 (더미)
  rationale: string; // 산출 근거 설명 (더미)
  editedByPb: boolean; // PB가 수정했는지
  referencedReports?: ReferencedReport[]; // 확정 시점 참고 리포트(영향 큰 상위 N개)
}

// ── 스트레스 테스트 (데이터 기반 요인 민감도 모델) ──
//
// 5개 매크로 요인을 강도 슬라이더로 조정 → 자산군별 민감도(베타)로
// 충격을 전이 → 포트폴리오 예상수익·낙폭·기여도·비중변화·조정제안 산출.
// 민감도 계수는 최근 ~10년(2015~2024) 월간 데이터 다중회귀로 추정. (lib/sensitivities.ts)

// 5개 매크로 요인 키
export type MacroFactorId =
  | "d_fed" // 미국 기준금리 변화 (%p)
  | "d_ust" // 미국 10년물 시장금리 변화 (%p)
  | "infl" // 인플레이션(월간 CPI 변화율, %)
  | "ret_krw" // 원달러 환율 변동 (%, +는 원화 약세)
  | "ret_cmd"; // 원자재 물가 변동 (%)

// 요인 메타 (라벨·단위·슬라이더 범위·기본 충격)
export interface MacroFactorMeta {
  id: MacroFactorId;
  label: string; // 한글 라벨
  labelEn: string;
  unit: string; // 표시 단위 ("%p", "%")
  min: number; // 슬라이더 최소
  max: number; // 슬라이더 최대
  step: number;
  hint: string; // PB 설명
}

// 사용자가 슬라이더로 설정한 요인별 충격 (단위는 MacroFactorMeta.unit 기준)
export type ScenarioShock = Record<MacroFactorId, number>;

// 자산군 단위 충격 기여도
export interface AssetContribution {
  assetClass: string; // "국내주식" 등
  weight: number; // 현재 비중 %
  assetReturn: number; // 이 자산군의 시나리오 예상수익률 % (충격 적용 후)
  contribution: number; // 포트폴리오 수익률 기여 = weight/100 * assetReturn
  byFactor: Record<MacroFactorId, number>; // 요인별 자산군 수익 영향 %
}

// 충격 후 비중 변화 (가격 변동에 따른 드리프트)
export interface WeightShift {
  assetClass: string;
  before: number; // 충격 전 비중 %
  after: number; // 충격 후(가치 변동 반영) 비중 %
  delta: number; // after - before
}

export interface StressTestResult {
  portfolioId: string;
  label: string; // 포트폴리오 라벨
  baseReturn: number; // 충격 전 기대수익률 %
  projectedReturn: number; // 충격 후 예상수익률 %
  projectedDrawdown: number; // 시나리오 예상 낙폭 % (양수 = 손실폭)
  shockImpact: number; // projectedReturn - baseReturn (요인 충격분 %)
  contributions: AssetContribution[]; // 자산군별 기여도 분해
  weightShifts: WeightShift[]; // 충격 후 비중 변화
  confidence: number; // 0~1, 모델 신뢰도 (가중평균 R²)
  note: string;
}

// 스트레스 후 조정 포트폴리오 제안
export interface RebalanceProposal {
  basePortfolioId: string;
  label: string; // "스트레스 대응 조정안"
  allocations: AssetAllocation[]; // 조정된 비중
  rationale: string; // 조정 근거
  projectedReturn: number; // 조정안의 시나리오 예상수익 %
  projectedDrawdown: number; // 조정안의 예상 낙폭 %
  improvementDrawdown: number; // 원안 대비 낙폭 개선폭 %p (양수=개선)
}

export interface Consultation {
  id: string;
  clientId: string;
  pbId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  notes: string;
  ipsSnapshot: IPS; // 종료 시점 7요인(점수 포함) → 성향 변화 그래프 소스
  createdAt: string;
}

// ── 7요인 메타 (라벨·설명·순서) ──
export const FACTOR_META: {
  key: FactorKey;
  letter: string;
  label: string;
  labelEn: string;
  desc: string;
}[] = [
  { key: "return", letter: "R", label: "목표 수익률", labelEn: "Target Return", desc: "Return — 기대/목표 수익률" },
  { key: "risk", letter: "R", label: "위험 허용도", labelEn: "Risk Tolerance", desc: "Risk — 감내 가능한 위험 수준" },
  { key: "timeHorizon", letter: "T", label: "투자 기간", labelEn: "Time Horizon", desc: "Time horizon — 투자 시계" },
  { key: "tax", letter: "T", label: "세금 요인", labelEn: "Tax", desc: "Tax — 세금 관련 고려사항" },
  { key: "liquidity", letter: "L", label: "유동성", labelEn: "Liquidity", desc: "Liquidity — 자금 필요 시기" },
  { key: "legal", letter: "L", label: "법적/규제", labelEn: "Legal / Regulatory", desc: "Legal — 법적·규제 제약" },
  { key: "unique", letter: "U", label: "고유 상황", labelEn: "Unique Circumstances", desc: "Unique circumstances — 고객 고유 상황" },
];

export const FACTOR_KEYS = FACTOR_META.map((f) => f.key);

// 빈 요인 (초기값)
export function emptyFactor(source: "manual" | "ai" = "manual"): IPSFactor {
  return {
    value: "",
    score: null,
    notes: "",
    source,
    status: "empty",
    evidence: "",
    inferenceHint: "",
    reviewed: false,
  };
}

export function emptyIPS(source: "manual" | "ai" = "manual"): IPS {
  return {
    return: emptyFactor(source),
    risk: emptyFactor(source),
    timeHorizon: emptyFactor(source),
    tax: emptyFactor(source),
    liquidity: emptyFactor(source),
    legal: emptyFactor(source),
    unique: emptyFactor(source),
  };
}
