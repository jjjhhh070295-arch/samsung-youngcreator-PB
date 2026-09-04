// ── 데이터 모델 (BLUEPRINT §4) ──

// ── Party 데이터 모델 ──
export type PartyType = "individual" | "corporate";

export interface Party {
  id: string;
  partyType: PartyType;
  displayName: string;
  isClient: boolean;
  pbId: string | null;
  code: string | null;
  assetSize: number;
  consultationNotes: string;
  createdAt: string;
}

export interface Individual {
  partyId: string;
  birthDate: string | null;
  subType: "individual" | "sole_proprietor";
  notes: string | null;
}

export interface Corporate {
  partyId: string;
  bizRegNo: string | null;
  corpRegNo: string | null;
  establishedAt: string | null;
  repPartyId: string | null;
  ownershipPct: number | null;
  isMajorityShareholder: boolean | null;
  accountSeparation: string | null;
  notes: string | null;
}

// ── Party Relationships (명세서 §3) ──
export type RelationType = "owns" | "spouse" | "child" | "parent" | "sibling" | "heir";

export const RELATION_TYPE_LABEL: Record<RelationType, string> = {
  owns: "소유 법인",
  spouse: "배우자",
  child: "자녀",
  parent: "부모",
  sibling: "형제/자매",
  heir: "상속인",
};

export interface PartyRelationship {
  id: string;
  fromPartyId: string;
  toPartyId: string;
  relationType: RelationType;
  ownershipPct: number | null;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
}

// ── 실질 지배자산 (명세서 §7-1) ──
export interface EffectiveAssetItem {
  corporatePartyId: string;
  corporateName: string;
  ownershipPct: number;
  totalAssets: number;
  effectiveAssets: number;  // totalAssets × ownershipPct / 100
}

export interface EffectiveAssets {
  directStocks: number;
  directRealEstate: number;
  directTotal: number;
  indirect: EffectiveAssetItem[];
  indirectTotal: number;
  grandTotal: number;
}


// ── 증여·상속 이벤트 (명세서 §5) ──
export type TransferEventType = "gift" | "inheritance";
export type AssetKind = "cash" | "stock" | "real_estate" | "corp_share" | "other";

export const TRANSFER_EVENT_LABEL: Record<TransferEventType, string> = {
  gift: "증여",
  inheritance: "상속",
};

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  cash: "현금",
  stock: "주식",
  real_estate: "부동산",
  corp_share: "법인 지분",
  other: "기타",
};

export interface TransferEvent {
  id: string;
  eventType: TransferEventType;
  fromPartyId: string | null;
  toPartyId: string;
  assetKind: AssetKind | null;
  assetRef: string | null;
  amount: number | null;
  eventDate: string;
  note: string | null;
  createdAt: string;
  // 조회 시 join 추가
  fromPartyName?: string;
  toPartyName?: string;
}

// §7-3 증여 10년 합산 — (증여자, 수증자) 쌍 단위
export interface GiftPairSummary {
  fromPartyId: string;
  toPartyId: string;
  fromPartyName: string;
  toPartyName: string;
  totalAmount: number;
  eventCount: number;
  latestEventDate: string;
}

// ── 가문 (명세서 §4) ──
export interface Household {
  id: string;
  name: string;
  headPartyId: string | null;
  pbId: string | null;
  createdAt: string;
}

export interface HouseholdMember {
  householdId: string;
  partyId: string;
  role: string | null;
  joinedAt: string;
}

// §7-2 가문 총자산 — 구성원별 기여분
export interface HouseholdMemberAsset {
  partyId: string;
  partyName: string;
  partyType: string;
  role: string | null;
  directStocks: number;
  directRealEstate: number;
  directTotal: number;
  /** 가문 밖 법인 간접보유분 (이중계상 제외됨) */
  indirectViaExternalCorps: number;
  /** 이 구성원이 가문 총자산에 기여하는 금액 */
  contribution: number;
}

export interface HouseholdAssets {
  householdId: string;
  householdName: string;
  members: HouseholdMemberAsset[];
  grandTotal: number;
}

export interface PB {
  id: string;
  code: string; // "PB-001"
  name: string;
  employeeId: string; // 사원번호
  /**
   * 비밀번호 (프로토타입: plaintext).
   * Supabase에서 읽어온 PB에는 절대 들어 있지 않다 — listPbs()/authenticatePb()는
   * password를 select하지 않는다. 값이 채워지는 곳은 로컬 폴백 DB(pb-app-local-db)와
   * createPb/updatePb로 보내는 쓰기 입력뿐이다.
   */
  password?: string;
  createdAt: string;
  // 모닝 브리핑 1단계 — pbs.email/title/phone 마이그레이션 실행 전에는 항상 undefined.
  email?: string; // 고객 브리핑 메일의 Reply-To로 쓰인다
  title?: string; // 직함(메일 서명용)
  phone?: string; // 연락처(메일 서명용)
}

export type ClientType = "individual" | "corporate" | "sole_proprietor";

export type AccountSeparation = "separated" | "mixed" | "unknown";

export type CashFlowEntity = "personal" | "corporate" | "sole_business" | "mixed";

export const CLIENT_TYPE_LABEL: Record<ClientType, string> = {
  individual: "개인",
  corporate: "법인",
  sole_proprietor: "개인사업자",
};

export const ACCOUNT_SEPARATION_LABEL: Record<AccountSeparation, string> = {
  separated: "분리",
  mixed: "혼용",
  unknown: "미확인",
};

export const CASH_FLOW_ENTITY_LABEL: Record<CashFlowEntity, string> = {
  personal: "개인",
  corporate: "법인",
  sole_business: "개인사업자",
  mixed: "혼용",
};

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
  linkedClientId?: string | null; // 법인↔대표 개인 연결
  ownershipPct?: number | null; // 대표/주주의 지분율
  isMajorityShareholder?: boolean | null; // 최대주주 여부
  accountSeparation?: AccountSeparation | null; // 개인사업자 통장 분리 상태
  consultationNotes: string; // 최신 전문 텍스트
  ips: IPS; // 최신 RRTTLLU
  cashFlows: CashFlow[]; // 현금흐름 (포트폴리오 입력)
  portfolios: Portfolio[]; // 7요인·현금흐름·리서치 기반 포트폴리오 후보
  stages: Stages; // 단계별 PB 확정 상태
  createdAt: string;
  // 모닝 브리핑 1단계 — parties.email/email_opt_in/email_opt_out_at 마이그레이션
  // 실행 전에는 email은 항상 undefined, emailOptIn은 항상 false로 읽힌다.
  email?: string;
  emailOptIn?: boolean; // 모닝 브리핑 수신 동의 — 기본 false, 명시적으로 켜야 발송 대상
  emailOptOutAt?: string | null; // 수신거부 시각. null/undefined면 거부한 적 없음
  /** 금융소득 종합과세 대상 여부 — 기본 false(아니오) */
  financialIncomeComprehensiveTax?: boolean;
  /** 원천징수영수증 등에서 확보한 금융소득(이자·배당) 프로파일 */
  financialIncomeProfile?: FinancialIncomeProfile | null;
}

/** 원천징수영수증 PDF 파싱/수동입력 상태 */
export type WithholdingSlipParseStatus = "none" | "parsed" | "parse_failed" | "manual";

export interface FinancialIncomeProfile {
  interestIncomeWon: number | null;
  dividendIncomeWon: number | null;
  parseStatus: WithholdingSlipParseStatus;
  fileName?: string | null;
  extractedAt?: string | null;
  /** PDF에서 읽힌 원본(추출값) — PB 수정 전 대비 */
  extractedInterestIncomeWon?: number | null;
  extractedDividendIncomeWon?: number | null;
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
  { key: "portfolio", label: "포트폴리오", desc: "분석 기반 후보 구성", auto: true },
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
  entity?: CashFlowEntity; // 자금주체
  accountType?: string; // 예: 개인통장, 법인 MMF, 사업자통장
  category?: string; // 급여/배당/법인세/생활비/사업비용 등
  taxAccountingNote?: string; // 상담용 세무·회계 메모
}

// ── 포트폴리오 (7요인·현금흐름·리서치 기반 추천) ──
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
  expectedReturn: number; // 예상 연수익률 %
  expectedRisk: number; // 예상 변동성 %
  taxNote: string; // 세금 고려 메모
  rationale: string; // 산출 근거 설명
  editedByPb: boolean; // PB가 수정했는지
  referencedReports?: ReferencedReport[]; // 확정 시점 참고 리포트(영향 큰 상위 N개)
  confirmedAt?: string; // 확정 시각(ISO) — 이 시점 리서치 기준으로 구조·근거를 박제
}
// Macro stress types. Betas are estimated by the 1990+ long-history engine.
// Six factors: Fed Funds, US 10Y, CPI YoY, USD/KRW, commodity, and VIX.
export type MacroFactorId =
  | "d_fed" // 미국 기준금리 변화 (%p)
  | "d_ust" // 미국 10년물 시장금리 변화 (%p)
  | "infl" // 인플레이션(월간 CPI 변화율, %)
  | "ret_krw" // 원달러 환율 변동 (%, +는 원화 약세)
  | "ret_cmd" // commodity return (%)
  | "d_vix"; // VIX change (point)

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

// 헤리티지 탭에서 MeetingBookingModal로 잡은 전문가 상담 예약 요청.
export interface HeritageMeetingRequest {
  id: string;
  clientId: string;
  pbId: string;
  expertId: string;
  expertName: string;
  /** MeetingBookingModal의 onConfirm이 넘기는 문자열 그대로("김세무 전문가 / 2026-09-01 10:00 예약 요청"). */
  requestedLabel: string;
  /** requestedLabel에서 파싱한 날짜(YYYY-MM-DD). 파싱 실패 시 null. */
  requestedDate: string | null;
  /** requestedLabel에서 파싱한 시간(HH:MM). 파싱 실패 시 null. */
  requestedTime: string | null;
  status: "requested";
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
