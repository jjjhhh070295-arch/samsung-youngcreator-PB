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

export const STAGE_META: { key: StageKey; label: string; desc: string }[] = [
  { key: "basic", label: "기본 정보", desc: "고객 기본사항 입력" },
  { key: "factors", label: "7요인 분석", desc: "RRTTLLU 7요인 정리·검토" },
  { key: "cashflow", label: "현금흐름", desc: "예상 유입/유출 입력" },
  { key: "portfolio", label: "포트폴리오", desc: "후보 구성 (더미)" },
  { key: "stress", label: "스트레스 테스트", desc: "시나리오 검정 (더미)" },
  { key: "ips", label: "IPS 문서", desc: "투자정책서 출력 (더미)" },
];

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
export interface Portfolio {
  id: string;
  label: string; // "안정형" | "균형형" | "성장형"
  allocations: AssetAllocation[];
  expectedReturn: number; // 예상 연수익률 % (더미값)
  expectedRisk: number; // 예상 변동성 % (더미값)
  taxNote: string; // 세금 고려 메모 (더미)
  rationale: string; // 산출 근거 설명 (더미)
  editedByPb: boolean; // PB가 수정했는지
}

// ── 스트레스 테스트 (★팀원 구현 영역 — 더미) ──
export interface StressScenario {
  id: string;
  name: string; // 예: "금리 +2%p", "주식 -30%", "인플레 급등"
  params: Record<string, number>;
}
export interface StressTestResult {
  portfolioId: string;
  scenarioId: string;
  projectedReturn: number; // 더미
  projectedDrawdown: number; // 더미 (최대 낙폭 %)
  note: string; // 더미 코멘트
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
export const FACTOR_META: { key: FactorKey; letter: string; label: string; desc: string }[] = [
  { key: "return", letter: "R", label: "목표 수익률", desc: "Return — 기대/목표 수익률" },
  { key: "risk", letter: "R", label: "위험 허용도", desc: "Risk — 감내 가능한 위험 수준" },
  { key: "timeHorizon", letter: "T", label: "투자 기간", desc: "Time horizon — 투자 시계" },
  { key: "tax", letter: "T", label: "세금 요인", desc: "Tax — 세금 관련 고려사항" },
  { key: "liquidity", letter: "L", label: "유동성", desc: "Liquidity — 자금 필요 시기" },
  { key: "legal", letter: "L", label: "법적/규제", desc: "Legal — 법적·규제 제약" },
  { key: "unique", letter: "U", label: "고유 상황", desc: "Unique circumstances — 고객 고유 상황" },
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
