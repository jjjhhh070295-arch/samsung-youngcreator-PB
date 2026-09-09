// 데이터 접근 계층 (CRUD)
// - Supabase가 설정돼 있으면 Postgres에 읽고 쓴다 (팀원 공유).
// - 키가 비어 있으면 브라우저 로컬(인메모리+localStorage) 폴백으로 동작해
//   키 없이도 앱 전체를 시연할 수 있다.
// DB는 snake_case, 코드 타입은 camelCase → 여기서 변환.

import { supabase, isSupabaseConfigured } from "./supabase";
import type {
  PB,
  Client,
  Consultation,
  IPS,
  CashFlow,
  Portfolio,
  PartyRelationship,
  RelationType,
  EffectiveAssets,
  EffectiveAssetItem,
  Household,
  HouseholdMember,
  HouseholdMemberAsset,
  HouseholdAssets,
  TransferEvent,
  TransferEventType,
  AssetKind,
  GiftPairSummary,
  HeritageMeetingRequest,
} from "./types";
import { emptyIPS } from "./types";
import { SAMPLE_BOOK_CLIENTS } from "./advisory/sampleBook";
import { mergeStagesPayload, splitStagesPayload } from "./advisory/approvalSnapshots";
import type { PbScheduleItem, PbScheduleStatus } from "./advisory/pbScheduleStorage";
import {
  addConsultationSchedule,
  addExtraEventSchedule,
  deleteSchedule,
  loadActivePbSchedules,
  setScheduleStatus,
} from "./advisory/pbScheduleStorage";
import type { InvestmentSurveyResult } from "./investmentSurvey";
import {
  saveInvestmentSurvey as saveLocalInvestmentSurvey,
  loadInvestmentSurvey as loadLocalInvestmentSurvey,
} from "./investmentSurveyStorage";
import type { ManualPortfolioDraft } from "./manualPortfolioDraft";
import { patchConsultationNotesOnly } from "./consultationNotePatch";
import {
  loadManualPortfolioDraft,
  saveManualPortfolioDraft as saveManualPortfolioDraftLocal,
  deleteManualPortfolioDraft as deleteManualPortfolioDraftLocal,
} from "./manualPortfolioDraft";

export const usingLocalFallback = !isSupabaseConfigured;

// ───────────────────────── 변환기 (row ↔ 모델) ─────────────────────────

function rowToPb(r: any): PB {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    employeeId: r.employee_id ?? "",
    // password 는 의도적으로 옮기지 않는다 — 애초에 select 하지 않으므로 r 에 없다.
    createdAt: r.created_at,
    // 모닝 브리핑 1단계 컬럼 — 마이그레이션 전이면 r.email 등이 아예 없어 undefined로 빠진다.
    email: r.email ?? undefined,
    title: r.title ?? undefined,
    phone: r.phone ?? undefined,
  };
}

// parties join 결과(individuals/corporates 포함) → Client
// export 인 이유: 고객 공유 링크의 서버 라우트(lib/clientView/server.ts)가 service_role 로
// 같은 parties 행을 읽어 같은 Client 를 만들어야 한다. 매핑을 복사하면 승인 해시 계산이
// 두 경로에서 어긋난다 — 한 곳에서만 만든다.
export function rowToClient(r: any): Client {
  const ind = Array.isArray(r.individuals) ? r.individuals[0] : r.individuals;
  const corp = Array.isArray(r.corporates) ? r.corporates[0] : r.corporates;

  let clientType: Client["clientType"];
  if (r.party_type === "corporate") {
    clientType = "corporate";
  } else if (ind?.sub_type === "sole_proprietor") {
    clientType = "sole_proprietor";
  } else {
    clientType = "individual";
  }

  return {
    id: r.id,
    code: r.code ?? "",
    clientType,
    name: r.display_name ?? r.name ?? "",
    birthDate: (ind?.birth_date ?? corp?.established_at) ?? "",
    assignedPbId: r.pb_id ?? r.assigned_pb_id ?? "",
    assetSize: Number(r.asset_size ?? 0),
    linkedClientId: corp?.rep_party_id ?? null,
    ownershipPct: corp?.ownership_pct == null ? null : Number(corp.ownership_pct),
    isMajorityShareholder: corp?.is_majority_shareholder ?? null,
    accountSeparation: corp?.account_separation ?? null,
    consultationNotes: r.consultation_notes ?? "",
    ips: (r.ips && Object.keys(r.ips).length ? r.ips : emptyIPS()) as IPS,
    cashFlows: (r.cash_flows ?? []) as CashFlow[],
    portfolios: (r.portfolios ?? []) as Portfolio[],
    ...(() => {
      const split = splitStagesPayload(r.stages);
      return {
        stages: split.stages,
        approvalHashes: split.approvalHashes,
        ipsPurchaseApps: split.ipsPurchaseApps,
      };
    })(),
    createdAt: r.created_at,
    // 모닝 브리핑 1단계 컬럼 — 마이그레이션 전이면 r.email 등이 아예 없어 undefined/false로 빠진다.
    email: r.email ?? undefined,
    emailOptIn: r.email_opt_in ?? false,
    emailOptOutAt: r.email_opt_out_at ?? null,
    financialIncomeComprehensiveTax: r.financial_income_comprehensive_tax ?? false,
    financialIncomeProfile: r.financial_income_profile ?? null,
    cashflowPeriodType: r.cashflow_period_type ?? null,
  };
}

// parties 테이블용 row (공통 필드)
function clientToPartyRow(c: Partial<Client>): any {
  const row: any = {};
  if (c.name !== undefined) row.display_name = c.name;
  if (c.clientType !== undefined) row.party_type = c.clientType === "corporate" ? "corporate" : "individual";
  if (c.assignedPbId !== undefined) row.pb_id = c.assignedPbId || null;
  if (c.assetSize !== undefined) row.asset_size = c.assetSize;
  if (c.consultationNotes !== undefined) row.consultation_notes = c.consultationNotes;
  if (c.ips !== undefined) row.ips = c.ips;
  if (c.cashFlows !== undefined) row.cash_flows = c.cashFlows;
  if (c.portfolios !== undefined) row.portfolios = c.portfolios;
  if (c.stages !== undefined || c.approvalHashes !== undefined || c.ipsPurchaseApps !== undefined) {
    // stages jsonb에 플래그+해시+IPS매수이력을 함께 저장.
    row.stages = mergeStagesPayload(c.stages, c.approvalHashes, c.ipsPurchaseApps);
  }
  // 모닝 브리핑 1단계 — 마이그레이션 미실행 시 withMissingColumnFallback이 이 키들을 뺀다.
  if (c.email !== undefined) row.email = c.email || null;
  if (c.emailOptIn !== undefined) row.email_opt_in = c.emailOptIn;
  if (c.emailOptOutAt !== undefined) row.email_opt_out_at = c.emailOptOutAt || null;
  if (c.financialIncomeComprehensiveTax !== undefined) {
    row.financial_income_comprehensive_tax = Boolean(c.financialIncomeComprehensiveTax);
  }
  if (c.financialIncomeProfile !== undefined) {
    row.financial_income_profile = c.financialIncomeProfile ?? null;
  }
  if (c.cashflowPeriodType !== undefined) {
    row.cashflow_period_type = c.cashflowPeriodType ?? null;
  }
  return row;
}

// clients 테이블용 row (backward compat — consultations FK 유지용)
function clientToRow(c: Partial<Client>): any {
  const row: any = {};
  if (c.code !== undefined) row.code = c.code;
  if (c.clientType !== undefined) row.client_type = c.clientType;
  if (c.name !== undefined) row.name = c.name;
  if (c.birthDate !== undefined) row.birth_date = c.birthDate || null;
  if (c.assignedPbId !== undefined) row.assigned_pb_id = c.assignedPbId || null;
  if (c.assetSize !== undefined) row.asset_size = c.assetSize;
  if (c.consultationNotes !== undefined) row.consultation_notes = c.consultationNotes;
  if (c.ips !== undefined) row.ips = c.ips;
  if (c.cashFlows !== undefined) row.cash_flows = c.cashFlows;
  if (c.portfolios !== undefined) row.portfolios = c.portfolios;
  if (c.stages !== undefined) row.stages = c.stages;
  return row;
}

// individuals 서브테이블용 row
function clientToIndividualRow(c: Partial<Client>): any {
  const row: any = {};
  if (c.birthDate !== undefined) row.birth_date = c.birthDate || null;
  return row;
}

// corporates 서브테이블용 row
function clientToCorporateRow(c: Partial<Client>): any {
  const row: any = {};
  if (c.birthDate !== undefined) row.established_at = c.birthDate || null;
  if (c.linkedClientId !== undefined) row.rep_party_id = c.linkedClientId || null;
  if (c.ownershipPct !== undefined) row.ownership_pct = c.ownershipPct ?? null;
  if (c.isMajorityShareholder !== undefined) row.is_majority_shareholder = c.isMajorityShareholder ?? null;
  if (c.accountSeparation !== undefined) row.account_separation = c.accountSeparation ?? null;
  return row;
}

function rowToConsultation(r: any): Consultation {
  return {
    id: r.id,
    clientId: r.client_id,
    pbId: r.pb_id ?? "",
    startedAt: r.started_at ?? "",
    endedAt: r.ended_at ?? "",
    durationSeconds: Number(r.duration_seconds ?? 0),
    notes: r.notes ?? "",
    ipsSnapshot: (r.ips_snapshot && Object.keys(r.ips_snapshot).length
      ? r.ips_snapshot
      : emptyIPS()) as IPS,
    createdAt: r.created_at,
  };
}

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

// 모닝 브리핑 1단계(parties.email/email_opt_in/email_opt_out_at, pbs.email/title/phone)
// 마이그레이션이 아직 실행되지 않은 환경에서도 고객/PB 추가·수정이 깨지지 않게 하는 헬퍼.
// optionalKeys를 포함해 낙관적으로 insert/update를 시도하고, "컬럼 없음" 오류가 나면 그
// 키들만 빼고 한 번 더 시도한다. 마이그레이션을 실행하고 나면 재시도 없이 첫 시도에서 바로
// 성공하므로, 코드를 다시 배포하지 않아도 새 필드가 저장되기 시작한다.
//
// 에러 코드가 두 갈래로 갈린다 — 실제로 겪어보고 알았다: SELECT에서 없는 컬럼을 필터
// 조건으로 쓰면 PostgREST가 Postgres 원본 코드(42703)를 그대로 넘기지만, INSERT/UPDATE의
// payload에 없는 컬럼이 섞여 있으면 PostgREST가 Postgres에 보내기도 전에 자체 스키마
// 캐시에서 걸러내 PGRST204("Could not find the 'x' column ... in the schema cache")를
// 낸다. 하나만 체크하면 절반의 케이스에서 이 함수가 무력해지므로 둘 다 잡는다.
const MISSING_COLUMN_ERROR_CODES = new Set(["42703", "PGRST204"]);

// authenticate_pb 함수가 아직 없는 환경(= supabase-migration-pbs-rls.sql 미실행)을
// 알아보는 코드. PGRST202 는 PostgREST 스키마 캐시에 함수가 없을 때, 42883 은
// Postgres 의 undefined_function 이다.
const MISSING_FUNCTION_ERROR_CODES = new Set(["PGRST202", "42883"]);

// 테이블 자체가 없는 환경(= 해당 마이그레이션 미실행)을 알아보는 코드. 42P01 은
// Postgres 의 undefined_table, PGRST205 는 PostgREST 스키마 캐시에 테이블이 없을 때다.
const MISSING_TABLE_ERROR_CODES = new Set(["42P01", "PGRST205"]);

async function withMissingColumnFallback<T = any>(
  attempt: (row: Record<string, any>) => PromiseLike<{ data: T; error: any }>,
  row: Record<string, any>,
  optionalKeys: string[],
): Promise<{ data: T; error: any }> {
  const first = await attempt(row);
  if (!first.error || !MISSING_COLUMN_ERROR_CODES.has(first.error.code) || optionalKeys.length === 0) return first;

  const stripped = { ...row };
  let removedAny = false;
  for (const key of optionalKeys) {
    if (key in stripped) {
      delete stripped[key];
      removedAny = true;
    }
  }
  if (!removedAny) return first;

  console.warn(
    `[store] "${first.error.message}" — 마이그레이션 미실행으로 보고 [${optionalKeys.join(", ")}] 없이 재시도`,
  );
  return attempt(stripped);
}

// ── pbs 읽기 컬럼 화이트리스트 ──────────────────────────────────────────────
// select("*") 를 쓰면 password 컬럼이 그대로 브라우저로 내려온다. 로그인 화면만 열어도
// 전체 PB 의 평문 비밀번호가 네트워크 응답에 실렸다 — 그래서 읽을 컬럼을 명시한다.
// password 는 authenticatePb() 에서 "필터 조건"으로만 쓰고 절대 select 하지 않는다.
const PB_BASE_COLUMNS = ["id", "code", "name", "employee_id", "created_at"] as const;
const PB_OPTIONAL_COLUMNS = ["email", "title", "phone"] as const; // 모닝 브리핑 1단계 마이그레이션

// insert 재시도로 row 에서 빠진 옵션 컬럼은 select 목록에서도 빼야 42703 이 안 난다.
function pbSelectColumnsFor(row: Record<string, any>): string {
  return [...PB_BASE_COLUMNS, ...PB_OPTIONAL_COLUMNS.filter((c) => c in row)].join(", ");
}

// 순수 SELECT 판 withMissingColumnFallback — 옵션 컬럼이 없는 환경이면 기본 컬럼만으로 재시도.
async function selectPbColumnsWithFallback<T = any>(
  attempt: (columns: string) => PromiseLike<{ data: T; error: any }>,
): Promise<{ data: T; error: any }> {
  const full = await attempt([...PB_BASE_COLUMNS, ...PB_OPTIONAL_COLUMNS].join(", "));
  if (!full.error || !MISSING_COLUMN_ERROR_CODES.has(full.error.code)) return full;
  return attempt(PB_BASE_COLUMNS.join(", "));
}

// 로컬 폴백 DB 의 PB 에는 로그인 대조용 password 가 들어 있다. 목록·화면으로 나갈 때는 뺀다.
function publicPb(pb: PB): PB {
  const { password: _password, ...rest } = pb;
  return rest;
}

// PostgREST 의 like/ilike 는 * 와 % 를 와일드카드로 해석한다. 사원번호를 그대로 넣으면
// "*" 한 글자로 아무 계정이나 매칭되므로 패턴 문자를 이스케이프한다.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_*]/g, (ch) => "\\" + ch);
}

// ───────────────────────── 로컬 폴백 저장소 ─────────────────────────

interface LocalDB {
  pbs: PB[];
  clients: Client[];
  consultations: Consultation[];
}

const LS_KEY = "pb-app-local-db";
const SAMPLE_PB_ID = "pb-demo-youngcreator";
const SAMPLE_CLIENT_ID = "client-hanbit-cashflow-sample";
export const DEMO_PB_ID = SAMPLE_PB_ID;
export const DEMO_PB_CREDENTIALS = {
  employeeId: "PB-001",
  password: "1234",
} as const;

function factor(
  value: string,
  score: number,
  evidence: string,
  notes = "CSV 현금흐름표와 샘플 상담을 바탕으로 검증용 확정",
): IPS["return"] {
  return {
    value,
    score,
    notes,
    source: "manual",
    status: "explicit",
    evidence,
    inferenceHint: "",
    reviewed: true,
  };
}

function sampleCashFlows(): CashFlow[] {
  const monthly = [
    ["사업소득", 820_000_000],
    ["금융소득(이자/배당)", 45_000_000],
    ["부수입", 15_000_000],
    ["월임대수입", 12_000_000],
    ["월고정지출", -240_000_000],
    ["월세/전세이자", -18_000_000],
    ["관리비", -3_500_000],
    ["공과금", -2_200_000],
    ["보험료지출", -5_000_000],
    ["차량비", -3_000_000],
    ["통신비", -1_200_000],
    ["기타지출", -23_000_000],
    ["월원금상환", -45_000_000],
    ["재산세", -26_000_000],
    ["종부세", -18_000_000],
    ["자동차세", -6_000_000],
    ["기타세금", -7_000_000],
    ["정기적금", -150_000_000],
    ["법인 MMF/RP", -250_000_000],
    ["CMA 유동성 버킷", -300_000_000],
    ["국내채권 ETF", -120_000_000],
    ["국내주식 ETF", -80_000_000],
    ["해외주식 ETF", -60_000_000],
    ["장기 단기채 래더", -100_000_000],
    ["임원 보장성보험", -5_000_000],
    ["비상금", -50_000_000],
  ];

  const scheduled = [
    ["M&A 지분매각 및 IPO 해제 유동성 버킷", -300_000_000, "2026-10"],
    ["상속세 예상액", -1_200_000_000, "2026-08"],
    ["부동산 양도세 예상액", -420_000_000, "2026-11"],
    ["증여세 예상액", -150_000_000, "2026-09"],
    ["법인세 예상액", -1_180_000_000, "2027-03"],
    ["IPO 보호예수 해제 대응자금", -300_000_000, "2027-03"],
    ["해외주식 양도세 예상액", -85_000_000, "2027-05"],
    ["운영자금 6개월치 안정 운용", -1_800_000_000, "2026-12"],
  ];

  return [
    ...monthly.map(([label, amount]) => ({
      id: `sample-recurring-${String(label).replace(/[^a-zA-Z0-9가-힣]/g, "")}`,
      label: String(label),
      amount: Number(amount),
      date: "2026-06",
      recurring: true,
      entity: "corporate" as const,
      accountType: "법인 운영계좌",
      category: Number(amount) >= 0 ? "매출/수입" : "운영비/투자",
    })),
    ...scheduled.map(([label, amount, date]) => ({
      id: `sample-scheduled-${String(label).replace(/[^a-zA-Z0-9가-힣]/g, "")}`,
      label: String(label),
      amount: Number(amount),
      date: String(date),
      recurring: false,
      entity: "corporate" as const,
      accountType: "법인 MMF/RP",
      category: /세/.test(String(label)) ? "법인세/세금" : "목적자금",
      taxAccountingNote: "상담용 추정치이며 세무 전문가 확인 필요",
    })),
  ];
}

function sampleIps(): IPS {
  return {
    return: factor(
      "연 8~12% 목표, 법인 유동성 버킷은 원금 변동성 최소화",
      4,
      "IPO 보호예수 해제 및 M&A 지분매각 검토와 법인세 납부재원 마련이 동시에 필요",
    ),
    risk: factor(
      "중위험 이상 가능하나 세금 납부재원은 안정형으로 분리",
      3,
      "법인세·양도세·증여세 납부 재원 분리 필요",
    ),
    timeHorizon: factor(
      "2026년 8월~2027년 5월 주요 현금화 일정, 잔여 운용자금은 3년 이상",
      3,
      "상속세 2026-08, 증여세 2026-09, M&A 클로징 2026-10-31, IPO 보호예수 해제일 2027-03-31",
    ),
    tax: factor(
      "법인세·부동산 양도세·증여세·해외주식 양도세 납부일 우선 반영",
      5,
      "상속세 예상액 12억원, 법인세 예상액 11.8억원, 부동산 양도세 4.2억원, 증여세 1.5억원, 해외주식 양도세 0.85억원",
    ),
    liquidity: factor(
      "세금성 유출과 운영자금 6개월치를 MMF/RP·CMA·단기채로 별도 확보",
      5,
      "운영자금 6개월치 18억원, CMA 유동성 버킷 214억원, 법인 MMF/RP 78억원",
    ),
    legal: factor(
      "법인 운용자금, 가업승계 증여, IPO 보호예수 해제 관련 내부 승인·세무 검토 필요",
      4,
      "오너 2세 대표, IPO 보호예수 해제 및 M&A 지분매각 검토",
    ),
    unique: factor(
      "고액 법인고객으로 IPO 보호예수 해제, M&A 지분매각, 가업승계 증여 재원이 동시에 필요. 수익률보다 세금을 최대한 적게 내는 것이 최우선이며, 비과세·분리과세·과세이연 가능 자산을 먼저 활용하고 싶음",
      5,
      "2026년 상속세·양도세·가업승계 증여세 납부 재원 분리 필요. 잔여 운용자금도 세후 효율과 절세 가능성을 우선 검토",
    ),
  };
}

function ensureLocalSample(db: LocalDB): { db: LocalDB; changed: boolean } {
  let changed = false;
  const nowIso = "2026-06-10T00:00:00.000Z";
  const demoPb: PB = {
    id: SAMPLE_PB_ID,
    code: "PB-001",
    name: "데모 PB",
    employeeId: DEMO_PB_CREDENTIALS.employeeId,
    password: DEMO_PB_CREDENTIALS.password,
    createdAt: nowIso,
  };

  const demoIndex = db.pbs.findIndex((p) => p.id === SAMPLE_PB_ID);
  if (demoIndex < 0) {
    // 기존에 다른 PB만 있어도 시연 계정(PB-001)은 항상 존재해야 로그인·대시보드가 깨지지 않음
    db.pbs.unshift(demoPb);
    changed = true;
  } else {
    // 사원번호/비밀번호가 바뀌어 있어도 데모 자격증명은 유지
    const existing = db.pbs[demoIndex];
    if (
      existing.employeeId !== DEMO_PB_CREDENTIALS.employeeId ||
      existing.password !== DEMO_PB_CREDENTIALS.password ||
      existing.code !== "PB-001"
    ) {
      db.pbs[demoIndex] = {
        ...existing,
        code: "PB-001",
        employeeId: DEMO_PB_CREDENTIALS.employeeId,
        password: DEMO_PB_CREDENTIALS.password,
        name: existing.name || demoPb.name,
      };
      changed = true;
    }
  }

  const pb = db.pbs.find((p) => p.id === SAMPLE_PB_ID) ?? db.pbs[0] ?? demoPb;

  const sample: Client = {
    id: SAMPLE_CLIENT_ID,
    code: "C-2026-0214",
    clientType: "corporate",
    name: "한빛에너지홀딩스(주) 샘플",
    birthDate: "2012-04-18",
    assignedPbId: pb.id,
    assetSize: 21_400_000_000,
    linkedClientId: null,
    ownershipPct: 60,
    isMajorityShareholder: true,
    accountSeparation: null,
    consultationNotes:
      "CSV 현금흐름표 기반 샘플. 서울 강남구 소재 법인 고객이며 IPO 보호예수 해제, M&A 지분매각, 가업승계 증여, 2027년 법인세 납부재원 마련을 동시에 검토한다.",
    ips: sampleIps(),
    cashFlows: sampleCashFlows(),
    portfolios: [],
    stages: { basic: true, factors: true, cashflow: true },
    createdAt: nowIso,
  };

  const index = db.clients.findIndex((client) => client.id === SAMPLE_CLIENT_ID);
  if (index >= 0) {
    db.clients[index] = { ...db.clients[index], ...sample };
    changed = true;
  } else if (!db.clients.some((client) => client.name === sample.name)) {
    db.clients.push(sample);
    changed = true;
  }

  const consultationExists = db.consultations.some(
    (consultation) => consultation.clientId === SAMPLE_CLIENT_ID,
  );
  if (!consultationExists) {
    db.consultations.push({
      id: "consultation-hanbit-cashflow-sample",
      clientId: SAMPLE_CLIENT_ID,
      pbId: pb.id,
      startedAt: nowIso,
      endedAt: nowIso,
      durationSeconds: 0,
      notes: sample.consultationNotes,
      ipsSnapshot: sample.ips,
      createdAt: nowIso,
    });
    changed = true;
  }

  for (const seed of SAMPLE_BOOK_CLIENTS) {
    if (!db.clients.some((c) => c.id === seed.client.id)) {
      db.clients.push({ ...seed.client, assignedPbId: pb.id });
      changed = true;
    }
    for (const cons of seed.consultations) {
      if (!db.consultations.some((c) => c.id === cons.id)) {
        db.consultations.push({ ...cons, pbId: pb.id });
        changed = true;
      }
    }
  }

  return { db, changed };
}

function sampleDb(): LocalDB {
  return ensureLocalSample({ pbs: [], clients: [], consultations: [] }).db;
}

/**
 * 서버 검증용 읽기 전용 데모 원본. 브라우저 localStorage를 절대 읽지 않으며,
 * 고정 seed를 매번 새 객체로 만들어 요청에서 받은 고객 객체와 신뢰 경계를 분리한다.
 */
export function getServerDemoClient(id: string): Client | null {
  const client = sampleDb().clients.find((item) => item.id === id);
  return client ? structuredClone(client) : null;
}

export function getServerDemoPb(id: string): Pick<PB, "id" | "name"> | null {
  const pb = sampleDb().pbs.find((item) => item.id === id);
  return pb ? { id: pb.id, name: pb.name } : null;
}

function localOrSampleDb(): LocalDB {
  return typeof window === "undefined" ? sampleDb() : loadLocal();
}

function mergeById<T extends { id: string }>(primary: T[], fallback: T[]): T[] {
  const seen = new Set(primary.map((item) => item.id));
  return [...primary, ...fallback.filter((item) => !seen.has(item.id))];
}

function isDemoPbId(id: string | null | undefined): boolean {
  return id === SAMPLE_PB_ID;
}

function localClientExists(id: string): boolean {
  if (typeof window === "undefined") return false;
  return loadLocal().clients.some((client) => client.id === id);
}

function localConsultationExists(id: string): boolean {
  if (typeof window === "undefined") return false;
  return loadLocal().consultations.some((consultation) => consultation.id === id);
}

function loadLocal(): LocalDB {
  if (typeof window === "undefined") return { pbs: [], clients: [], consultations: [] };
  let db: LocalDB = { pbs: [], clients: [], consultations: [] };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) db = JSON.parse(raw) as LocalDB;
  } catch {
    /* ignore */
  }
  const ensured = ensureLocalSample(db);
  if (ensured.changed) saveLocal(ensured.db);
  return ensured.db;
}

function saveLocal(db: LocalDB) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}

// ───────────────────────── PB CRUD ─────────────────────────

function nextPbCode(existing: PB[]): string {
  let max = 0;
  for (const p of existing) {
    const m = /^PB-(\d+)$/.exec(p.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `PB-${String(max + 1).padStart(3, "0")}`;
}

// 화면용 PB 목록 — password 는 어느 경로로도 포함되지 않는다(로그인 검증은 authenticatePb).
export async function listPbs(): Promise<PB[]> {
  if (usingLocalFallback) {
    return loadLocal().pbs.map(publicPb).sort((a, b) => a.code.localeCompare(b.code));
  }
  const { data, error } = await selectPbColumnsWithFallback((columns) =>
    supabase!.from("pbs").select(columns).order("code", { ascending: true }),
  );
  if (error) {
    console.warn("[store] Supabase PB 조회 실패 — 데모 계정으로 폴백:", error.message);
    return localOrSampleDb().pbs.map(publicPb).sort((a, b) => a.code.localeCompare(b.code));
  }
  const remote = (data ?? []).map(rowToPb);
  return mergeById(remote, localOrSampleDb().pbs.map(publicPb)).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

/**
 * 로그인 검증 전용 — 사원번호로 단건만 조회한다.
 *
 * 예전에는 app/page.tsx 가 listPbs() 로 전체 PB 를 password 까지 받아온 뒤 브라우저에서
 * === 로 대조했다. 로그인 화면을 열기만 해도 전원 비밀번호가 노출되는 구조였다.
 *
 * 대조는 DB 의 SECURITY DEFINER 함수 authenticate_pb 에 맡긴다
 * (supabase-migration-pbs-rls.sql). anon 은 password 컬럼을 읽지도 필터하지도 못하고,
 * 비밀번호는 쿼리스트링(?password=eq.…)이 아니라 POST 바디로 나가 액세스 로그에
 * 남지 않는다. 함수가 아직 없는 환경에서는 예전 컬럼 필터 방식으로 폴백한다 —
 * 코드 배포와 마이그레이션 실행 순서가 뒤바뀌어도 로그인이 죽지 않게.
 *
 * 여전히 평문 비교이고 anon 키로 도는 클라이언트 호출이다. 서버 세션
 * (app/api/auth/session) 으로 옮기기 전까지의 중간 단계로 본다.
 */
export async function authenticatePb(employeeId: string, password: string): Promise<PB | null> {
  const normalizedId = employeeId.trim().toUpperCase();
  const normalizedPassword = password.trim();
  if (!normalizedId || !normalizedPassword) return null;

  const isDemoCredential =
    normalizedId === DEMO_PB_CREDENTIALS.employeeId &&
    normalizedPassword === DEMO_PB_CREDENTIALS.password;

  // 데모 계정은 로컬 시드에만 존재할 수 있다(ensureLocalSample 이 항상 되살린다).
  const demoPb = () => {
    const found = localOrSampleDb().pbs.find((pb) => pb.id === DEMO_PB_ID);
    return found ? publicPb(found) : null;
  };

  if (usingLocalFallback) {
    const found = loadLocal().pbs.find(
      (pb) =>
        (pb.employeeId ?? "").trim().toUpperCase() === normalizedId &&
        pb.password === normalizedPassword,
    );
    if (found) return publicPb(found);
    return isDemoCredential ? demoPb() : null;
  }

  // Supabase 에 없거나 조회가 실패해도 데모 자격증명은 통과시킨다(기존 동작 유지).
  const fallbackToDemo = () => (isDemoCredential ? demoPb() : null);

  const viaRpc = await supabase!.rpc("authenticate_pb", {
    p_employee_id: normalizedId,
    p_password: normalizedPassword,
  });
  if (!viaRpc.error) {
    // 함수가 null 을 주면 자격증명 불일치다.
    return viaRpc.data ? rowToPb(viaRpc.data) : fallbackToDemo();
  }
  if (!MISSING_FUNCTION_ERROR_CODES.has(viaRpc.error.code)) {
    console.warn("[store] PB 로그인 조회 실패 — 데모 계정만 허용:", viaRpc.error.message);
    return fallbackToDemo();
  }

  // ── 폴백: authenticate_pb 미배포 환경 ──
  // password 를 select 하지 않고 필터 조건으로만 쓴다(PostgREST 는 select 목록에 없는
  // 컬럼으로도 필터링한다). 마이그레이션을 적용하고 나면 이 경로는 타지 않는다.
  console.warn(
    "[store] authenticate_pb 함수 없음 — supabase-migration-pbs-rls.sql 미실행으로 보고 컬럼 필터로 폴백",
  );
  const viaColumnFilter = await selectPbColumnsWithFallback((columns) =>
    supabase!
      .from("pbs")
      .select(columns)
      .ilike("employee_id", escapeLikePattern(normalizedId))
      .eq("password", normalizedPassword)
      .limit(1)
      .maybeSingle(),
  );
  if (!viaColumnFilter.error && viaColumnFilter.data) return rowToPb(viaColumnFilter.data);
  if (viaColumnFilter.error) {
    console.warn("[store] PB 로그인 조회 실패 — 데모 계정만 허용:", viaColumnFilter.error.message);
  }
  return fallbackToDemo();
}

export async function createPb(data: { name: string; employeeId: string; password: string; email?: string; title?: string; phone?: string }): Promise<PB> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb: PB = {
      id: uid(),
      code: nextPbCode(db.pbs),
      name: data.name,
      employeeId: data.employeeId,
      password: data.password,
      createdAt: new Date().toISOString(),
      email: data.email || undefined,
      title: data.title || undefined,
      phone: data.phone || undefined,
    };
    db.pbs.push(pb);
    saveLocal(db);
    return pb;
  }
  const existing = await listPbs();
  const code = nextPbCode(existing);
  // email/title/phone은 마이그레이션 미실행 시 withMissingColumnFallback이 자동으로 빼고 재시도한다.
  const { data: row, error } = await withMissingColumnFallback(
    (row) => supabase!.from("pbs").insert(row).select(pbSelectColumnsFor(row)).single(),
    {
      code,
      name: data.name,
      employee_id: data.employeeId,
      password: data.password,
      email: data.email || null,
      title: data.title || null,
      phone: data.phone || null,
    },
    ["email", "title", "phone"],
  );
  if (error) throw error;
  return rowToPb(row);
}

export async function updatePb(id: string, data: { name?: string; employeeId?: string; password?: string; email?: string; title?: string; phone?: string }): Promise<void> {
  if (isDemoPbId(id)) {
    const db = loadLocal();
    const pb = db.pbs.find((p) => p.id === id);
    if (pb) {
      if (data.name !== undefined) pb.name = data.name;
      if (data.employeeId !== undefined) pb.employeeId = data.employeeId;
      if (data.password !== undefined) pb.password = data.password;
      if (data.email !== undefined) pb.email = data.email || undefined;
      if (data.title !== undefined) pb.title = data.title || undefined;
      if (data.phone !== undefined) pb.phone = data.phone || undefined;
      saveLocal(db);
    }
    return;
  }
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb = db.pbs.find((p) => p.id === id);
    if (pb) {
      if (data.name !== undefined) pb.name = data.name;
      if (data.employeeId !== undefined) pb.employeeId = data.employeeId;
      if (data.password !== undefined) pb.password = data.password;
      if (data.email !== undefined) pb.email = data.email || undefined;
      if (data.title !== undefined) pb.title = data.title || undefined;
      if (data.phone !== undefined) pb.phone = data.phone || undefined;
    }
    saveLocal(db);
    return;
  }
  const row: any = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.employeeId !== undefined) row.employee_id = data.employeeId;
  if (data.password !== undefined) row.password = data.password;
  if (data.email !== undefined) row.email = data.email || null;
  if (data.title !== undefined) row.title = data.title || null;
  if (data.phone !== undefined) row.phone = data.phone || null;
  const { error } = await withMissingColumnFallback(
    (r) => supabase!.from("pbs").update(r).eq("id", id).then((res) => ({ data: null, error: res.error })),
    row,
    ["email", "title", "phone"],
  );
  if (error) throw error;
}

export async function deletePb(id: string): Promise<void> {
  if (isDemoPbId(id)) return;
  if (usingLocalFallback) {
    const db = loadLocal();
    db.pbs = db.pbs.filter((p) => p.id !== id);
    // 담당 해제 (on delete set null 모사)
    db.clients = db.clients.map((c) =>
      c.assignedPbId === id ? { ...c, assignedPbId: "" } : c,
    );
    saveLocal(db);
    return;
  }
  const { error } = await supabase!.from("pbs").delete().eq("id", id);
  if (error) throw error;
}

// ───────────────────────── Client CRUD ─────────────────────────

export function nextClientCode(existing: Client[], year = new Date().getFullYear()): string {
  let max = 0;
  const prefix = `C-${year}-`;
  for (const c of existing) {
    if (c.code.startsWith(prefix)) {
      const n = parseInt(c.code.slice(prefix.length), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export async function listClients(): Promise<Client[]> {
  if (usingLocalFallback) {
    return loadLocal().clients.slice();
  }
  const { data, error } = await supabase!
    .from("parties")
    .select("*, individuals(*), corporates!party_id(*)")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[store] Supabase 고객 조회 실패 — 데모 고객으로 폴백:", error.message);
    return localOrSampleDb().clients.slice();
  }
  const remote = (data ?? []).map(rowToClient);
  return mergeById(remote, localOrSampleDb().clients);
}

export async function listClientsByPb(pbId: string): Promise<Client[]> {
  const all = await listClients();
  return all.filter((c) => c.assignedPbId === pbId);
}

// ───────────────────────── 모닝 브리핑 1단계 — 발송 대상 조회 ─────────────────────────
// 발송 코드는 아직 없다(2단계). 이건 "누구에게 보내도 되는지"만 고정 쿼리 1번으로 낸다 —
// 고객 수가 몇 명이든 쿼리 횟수는 늘지 않는다. PB별로 묶는 건 assignedPbId로 호출부에서
// reduce/groupBy 하면 된다(별도 PB별 쿼리 불필요 — listClientsByPb와 같은 이유).

export interface EmailBriefingTarget {
  clientId: string;
  email: string;
  assignedPbId: string;
}

/** listEmailBriefingTargets 가 쓰는 컬럼 중 모닝 브리핑 마이그레이션으로 생기는 것들.
 *  42703 이 났을 때 "마이그레이션 미실행"인지 "쿼리가 잘못된 컬럼을 참조"인지 가른다. */
const BRIEFING_TARGET_COLUMNS = new Set(["email", "email_opt_in", "email_opt_out_at"]);

/** is_client=true 이고, email이 있고, email_opt_in=true이고, email_opt_out_at이 null인
 *  고객만 — 조건 전부 DB에서 거른다.
 *
 *  is_client 를 거르는 이유: parties 에는 고객뿐 아니라 가족 party 도 들어 있다. 상속·가족
 *  구성을 입력하면서 그쪽 행에 이메일과 수신 동의가 켜지면, 고객이 아닌 사람에게 브리핑이
 *  나간다. 실제로 2026-09-09 실측에서 is_client 가 아닌 party 한 건이 동의 켜진 상태로
 *  대상에 잡혔다.
 *
 *  select 에 parties 에 없는 컬럼을 넣으면 안 된다. 예전에는 assigned_pb_id 가 있었는데
 *  그 컬럼은 clients 테이블에만 있어서 쿼리 전체가 42703 으로 죽었고, 아래 폴백이 그것을
 *  "브리핑 마이그레이션 미실행"으로 오인해 발송 대상을 조용히 0명으로 만들었다.
 *  HTTP 는 200 ok:true 라 화면에서는 성공처럼 보였다.
 *
 *  브리핑 컬럼이 아직 없는 환경(마이그레이션 미실행)에서는 발송 대상이 하나도 없는 게
 *  안전하므로 빈 배열을 반환한다(에러를 던지지 않는다). 단, 어느 컬럼 때문인지 반드시
 *  로그에 남긴다 — 아래 참고. */
export async function listEmailBriefingTargets(): Promise<EmailBriefingTarget[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("parties")
    .select("id, email, pb_id")
    .eq("is_client", true)
    .eq("email_opt_in", true)
    .is("email_opt_out_at", null)
    .not("email", "is", null)
    // 정렬을 고정한다. 순서를 안 주면 DB가 돌려주는 순서가 보장되지 않아, limit 을 걸었을
    // 때 누가 뽑힐지 불확정이다. 발송은 되돌릴 수 없으므로 "몇 명"뿐 아니라 "누구"까지
    // dryRun 과 실발송이 같아야 한다. code 는 고객마다 유일해서 동률이 없다.
    .order("code", { ascending: true });

  if (error) {
    if (MISSING_COLUMN_ERROR_CODES.has(error.code)) {
      // 42703 은 "브리핑 마이그레이션 미실행"만의 신호가 아니다. 이 쿼리가 참조하는 어떤
      // 컬럼이든 없으면 같은 코드가 나온다. 단정하지 말고 원문을 그대로 남긴다 —
      // 메시지에 "column parties.<이름> does not exist" 로 범인이 찍혀 있다.
      const missing = /column [\w.]*\.?(\w+) does not exist/i.exec(error.message ?? "")?.[1];
      const expected = BRIEFING_TARGET_COLUMNS.has(missing ?? "");
      console.warn(
        `[store] listEmailBriefingTargets: 컬럼 없음(${error.code}) — 발송 대상 0명으로 처리. ` +
          `없는 컬럼: ${missing ?? "확인 불가"} / ` +
          (expected
            ? "모닝 브리핑 마이그레이션(supabase-migration-morning-briefing.sql) 미실행으로 보인다."
            : "브리핑 마이그레이션과 무관한 컬럼이다 — 이 쿼리의 select·필터를 확인하라.") +
          ` 원문: ${error.message}`,
      );
      return [];
    }
    throw error;
  }

  return (data ?? [])
    .filter((r: any) => typeof r.email === "string" && r.email.trim() !== "")
    .map((r: any) => ({
      clientId: r.id,
      email: r.email,
      // parties 의 담당 PB 는 pb_id 하나뿐이다. assigned_pb_id 폴백이 있었으나 그 컬럼은
      // clients 테이블에만 있어 여기서는 항상 undefined 였고, select 에 넣는 순간 위의
      // 42703 을 일으켰다.
      assignedPbId: r.pb_id ?? "",
    }));
}

// ───────────────────────── 모닝 브리핑 3단계 — 발송 ─────────────────────────
// 아래 함수들은 전부 서버(발송 라우트·수신거부 라우트)에서만 호출된다. 로컬 폴백을
// 두지 않는 이유: 폴백이 있으면 Supabase 가 없는 환경에서 "보낸 것처럼" 성공을 돌려주게
// 되는데, 발송은 되돌릴 수 없어서 조용한 성공이 가장 위험하다. supabase 가 없으면
// 호출부가 아예 발송을 시작하지 않도록 명시적으로 실패시킨다.

/** 발송 메일의 From 표시 이름·Reply-To·서명에 쓸 PB 정보. */
export interface PbBriefingProfile {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * 담당 PB 프로필을 id 배열 하나로 한 번에 가져온다(고객 수만큼 쿼리하지 않는다).
 * pbs.title/phone 마이그레이션 전이면 42703 이 나므로, 그때는 name 만 채워 돌려준다 —
 * 서명이 빈약해질 뿐 발송 자체는 막지 않는다.
 */
export async function listPbBriefingProfiles(
  pbIds: string[],
): Promise<Map<string, PbBriefingProfile>> {
  const map = new Map<string, PbBriefingProfile>();
  const ids = Array.from(new Set(pbIds.filter(Boolean)));
  if (!supabase || ids.length === 0) return map;

  const full = await supabase.from("pbs").select("id, name, title, email, phone").in("id", ids);
  const res = MISSING_COLUMN_ERROR_CODES.has(full.error?.code ?? "")
    ? await supabase.from("pbs").select("id, name").in("id", ids)
    : full;

  if (res.error) {
    console.warn("[store] listPbBriefingProfiles 실패 — 서명 없이 진행:", res.error.message);
    return map;
  }
  for (const r of (res.data ?? []) as any[]) {
    map.set(r.id, {
      id: r.id,
      name: r.name ?? "",
      title: r.title ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
    });
  }
  return map;
}

export class BriefingSendsTableMissingError extends Error {
  constructor() {
    super(
      "briefing_sends 테이블이 아직 없습니다. supabase-migration-briefing-sends.sql 을 Supabase SQL Editor에서 먼저 실행하세요.",
    );
    this.name = "BriefingSendsTableMissingError";
  }
}

/** 이 리포트로 이미 행이 잡힌 고객 id — 재실행 시 중복 발송을 건너뛰는 데 쓴다. */
export async function listBriefingSendClientIds(reportId: string): Promise<Set<string>> {
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
  const { data, error } = await supabase
    .from("briefing_sends")
    .select("client_id")
    .eq("report_id", reportId);
  if (error) {
    if (MISSING_TABLE_ERROR_CODES.has(error.code)) throw new BriefingSendsTableMissingError();
    throw error;
  }
  return new Set((data ?? []).map((r: any) => r.client_id as string));
}

/**
 * 발송 "전에" queued 행을 선점한다. unique(report_id, client_id) 덕분에 두 번째 시도는
 * 23505 로 튕기고 false 가 돌아온다 — 이게 중복 발송을 막는 실제 장치다(위 목록 조회는
 * 헛수고를 줄이는 용도일 뿐, 동시 실행까지 막지는 못한다).
 * 성공하면 갱신에 쓸 행 id 를 돌려준다.
 */
export async function claimBriefingSend(input: {
  reportId: string;
  clientId: string;
  pbId: string | null;
  email: string;
}): Promise<{ claimed: boolean; id?: string }> {
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
  const { data, error } = await supabase
    .from("briefing_sends")
    .insert({
      report_id: input.reportId,
      client_id: input.clientId,
      pb_id: input.pbId,
      email: input.email,
      status: "queued",
    })
    .select("id")
    .single();

  if (error) {
    if (MISSING_TABLE_ERROR_CODES.has(error.code)) throw new BriefingSendsTableMissingError();
    if (error.code === "23505") return { claimed: false }; // 이미 나갔거나 다른 실행이 선점
    throw error;
  }
  return { claimed: true, id: data?.id };
}

/** 선점한 행을 발송 결과로 마감한다. 여기서 실패해도 메일은 이미 나간 뒤라 throw 하지 않는다. */
export async function finishBriefingSend(
  id: string,
  result: { ok: boolean; messageId?: string; error?: string },
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("briefing_sends")
    .update({
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.messageId ?? null,
      error: result.error ? result.error.slice(0, 500) : null,
      sent_at: result.ok ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) console.warn("[store] finishBriefingSend 실패(메일은 이미 발송됨):", error.message);
}

/**
 * 수신거부 기록. 이미 거부한 고객을 다시 눌러도 최초 시각을 덮어쓰지 않는다 —
 * "언제 거부했는지"가 감사 기록이라 나중 값으로 밀리면 안 된다.
 * 반환값은 이번 호출로 실제 상태가 바뀌었는지(false 면 이미 거부 상태).
 */
export async function optOutFromBriefing(clientId: string): Promise<{ ok: boolean; alreadyOptedOut: boolean }> {
  if (!supabase) throw new Error("Supabase가 설정되지 않았습니다.");
  const { data: rows, error } = await supabase
    .from("parties")
    .update({ email_opt_out_at: new Date().toISOString(), email_opt_in: false })
    .eq("id", clientId)
    .is("email_opt_out_at", null)
    .select("id");
  if (error) {
    if (MISSING_COLUMN_ERROR_CODES.has(error.code)) {
      throw new Error(
        "email_opt_out_at 컬럼이 없습니다. supabase-migration-morning-briefing.sql 을 먼저 실행하세요.",
      );
    }
    throw error;
  }
  return { ok: true, alreadyOptedOut: (rows ?? []).length === 0 };
}

export async function getClient(id: string): Promise<Client | null> {
  if (usingLocalFallback) {
    return loadLocal().clients.find((c) => c.id === id) ?? null;
  }
  const localClient = loadLocal().clients.find((c) => c.id === id);
  if (localClient) return localClient;
  const { data, error } = await supabase!
    .from("parties")
    .select("*, individuals(*), corporates!party_id(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[store] Supabase 고객 단건 조회 실패 — 로컬/데모 고객으로 폴백:", error.message);
    return localClient ?? null;
  }
  return data ? rowToClient(data) : null;
}

export interface NewClientInput {
  code?: string;
  clientType: Client["clientType"];
  name: string;
  birthDate: string;
  assignedPbId: string;
  assetSize: number;
  linkedClientId?: string | null;
  ownershipPct?: number | null;
  isMajorityShareholder?: boolean | null;
  accountSeparation?: Client["accountSeparation"];
  email?: string;
  emailOptIn?: boolean;
}

export async function createClient(input: NewClientInput): Promise<Client> {
  if (usingLocalFallback || isDemoPbId(input.assignedPbId)) {
    const db = loadLocal();
    const client: Client = {
      id: uid(),
      code: input.code || nextClientCode(db.clients),
      clientType: input.clientType,
      name: input.name,
      birthDate: input.birthDate,
      assignedPbId: input.assignedPbId,
      assetSize: input.assetSize,
      linkedClientId: input.linkedClientId ?? null,
      ownershipPct: input.ownershipPct ?? null,
      isMajorityShareholder: input.isMajorityShareholder ?? null,
      accountSeparation: input.accountSeparation ?? null,
      consultationNotes: "",
      ips: emptyIPS(),
      cashFlows: [],
      portfolios: [],
      stages: {},
      createdAt: new Date().toISOString(),
      email: input.email || undefined,
      emailOptIn: input.emailOptIn ?? false,
    };
    db.clients.push(client);
    saveLocal(db);
    return client;
  }
  const existing = await listClients();
  const code = input.code || nextClientCode(existing);

  // 1. parties 테이블 INSERT — email/email_opt_in은 마이그레이션 미실행 시
  // withMissingColumnFallback이 자동으로 빼고 재시도한다.
  const { data: partyData, error: pe } = await withMissingColumnFallback(
    (row) => supabase!.from("parties").insert(row).select().single(),
    {
      party_type: input.clientType === "corporate" ? "corporate" : "individual",
      display_name: input.name,
      pb_id: input.assignedPbId || null,
      code,
      asset_size: input.assetSize,
      consultation_notes: "",
      ips: emptyIPS(),
      cash_flows: [],
      portfolios: [],
      stages: {},
      email: input.email || null,
      email_opt_in: input.emailOptIn ?? false,
    },
    ["email", "email_opt_in", "financial_income_comprehensive_tax", "financial_income_profile", "cashflow_period_type"],
  );
  if (pe) throw pe;

  // 2. 서브테이블 INSERT
  if (input.clientType === "corporate") {
    await supabase!.from("corporates").insert({
      party_id: partyData.id,
      established_at: input.birthDate || null,
      rep_party_id: input.linkedClientId || null,
      ownership_pct: input.ownershipPct ?? null,
      is_majority_shareholder: input.isMajorityShareholder ?? null,
      account_separation: input.accountSeparation ?? null,
    });
  } else {
    await supabase!.from("individuals").insert({
      party_id: partyData.id,
      birth_date: input.birthDate || null,
      sub_type: input.clientType,
    });
  }

  // 3. clients 테이블 동기 INSERT (consultations.client_id FK 유지용)
  await supabase!.from("clients").insert({
    id: partyData.id,
    code,
    client_type: input.clientType,
    name: input.name,
    birth_date: input.birthDate || null,
    assigned_pb_id: input.assignedPbId || null,
    asset_size: input.assetSize,
    ips: emptyIPS(),
    cash_flows: [],
    portfolios: [],
  });

  return getClient(partyData.id) as Promise<Client>;
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  if (usingLocalFallback || localClientExists(id)) {
    const db = loadLocal();
    const idx = db.clients.findIndex((c) => c.id === id);
    if (idx >= 0) {
      const prev = db.clients[idx];
      const next: Client = { ...prev, ...patch };
      if (patch.stages !== undefined && patch.approvalHashes === undefined) {
        next.approvalHashes = prev.approvalHashes;
      }
      if (patch.approvalHashes !== undefined && patch.stages === undefined) {
        next.stages = prev.stages;
      }
      if (patch.ipsPurchaseApps === undefined) {
        next.ipsPurchaseApps = prev.ipsPurchaseApps;
      } else {
        next.ipsPurchaseApps = { ...(prev.ipsPurchaseApps ?? {}), ...patch.ipsPurchaseApps };
      }
      db.clients[idx] = next;
      saveLocal(db);
    }
    return;
  }

  let partyPatch = patch;
  if (
    patch.stages !== undefined ||
    patch.approvalHashes !== undefined ||
    patch.ipsPurchaseApps !== undefined
  ) {
    const prev = await getClient(id);
    partyPatch = {
      ...patch,
      stages: { ...(prev?.stages ?? {}), ...(patch.stages ?? {}) },
      approvalHashes:
        patch.approvalHashes !== undefined ? patch.approvalHashes : prev?.approvalHashes ?? {},
      ipsPurchaseApps: {
        ...(prev?.ipsPurchaseApps ?? {}),
        ...(patch.ipsPurchaseApps ?? {}),
      },
    };
  }

  // parties 업데이트 — email/email_opt_in/email_opt_out_at은 마이그레이션 미실행 시
  // withMissingColumnFallback이 자동으로 빼고 재시도한다.
  const partyRow = clientToPartyRow(partyPatch);
  if (Object.keys(partyRow).length > 0) {
    const { error } = await withMissingColumnFallback(
      (row) => supabase!.from("parties").update(row).eq("id", id).then((res) => ({ data: null, error: res.error })),
      partyRow,
      ["email", "email_opt_in", "email_opt_out_at", "financial_income_comprehensive_tax", "financial_income_profile", "cashflow_period_type"],
    );
    if (error) throw error;
  }

  // clients 동기 업데이트 (backward compat)
  const clientRow = clientToRow(partyPatch);
  if (Object.keys(clientRow).length > 0) {
    await supabase!.from("clients").update(clientRow).eq("id", id);
  }

  // 서브테이블 업데이트
  const indRow = clientToIndividualRow(partyPatch);
  if (Object.keys(indRow).length > 0) {
    await supabase!.from("individuals").update(indRow).eq("party_id", id);
  }
  const corpRow = clientToCorporateRow(partyPatch);
  if (Object.keys(corpRow).length > 0) {
    await supabase!.from("corporates").update(corpRow).eq("party_id", id);
  }
}

export async function deleteClient(id: string): Promise<void> {
  if (usingLocalFallback || localClientExists(id)) {
    const db = loadLocal();
    db.clients = db.clients.filter((c) => c.id !== id);
    db.consultations = db.consultations.filter((cs) => cs.clientId !== id);
    saveLocal(db);
    return;
  }
  // clients 삭제 → consultations cascade 삭제
  await supabase!.from("clients").delete().eq("id", id);
  // parties 삭제 → individuals/corporates cascade 삭제
  const { error } = await supabase!.from("parties").delete().eq("id", id);
  if (error) throw error;
}

// ───────────────────────── Consultation ─────────────────────────

export async function listConsultations(clientId: string): Promise<Consultation[]> {
  if (usingLocalFallback) {
    return loadLocal()
      .consultations.filter((c) => c.clientId === clientId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  const { data, error } = await supabase!
    .from("consultations")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[store] Supabase 상담 조회 실패 — 로컬/데모 상담으로 폴백:", error.message);
    return loadLocal()
      .consultations.filter((c) => c.clientId === clientId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }
  const remote = (data ?? []).map(rowToConsultation);
  const local = loadLocal().consultations.filter((c) => c.clientId === clientId);
  return mergeById(remote, local).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function listAllConsultations(): Promise<Consultation[]> {
  if (usingLocalFallback) {
    return loadLocal().consultations.slice();
  }
  const { data, error } = await supabase!.from("consultations").select("*");
  if (error) {
    console.warn("[store] Supabase 전체 상담 조회 실패 — 로컬/데모 상담으로 폴백:", error.message);
    return localOrSampleDb().consultations.slice();
  }
  return mergeById((data ?? []).map(rowToConsultation), localOrSampleDb().consultations);
}

export interface NewConsultationInput {
  clientId: string;
  pbId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  notes: string;
  ipsSnapshot: IPS;
}

export async function createConsultation(input: NewConsultationInput): Promise<Consultation> {
  if (usingLocalFallback || isDemoPbId(input.pbId) || localClientExists(input.clientId)) {
    const db = loadLocal();
    const cs: Consultation = {
      id: uid(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    db.consultations.push(cs);
    saveLocal(db);
    return cs;
  }
  const { data, error } = await supabase!
    .from("consultations")
    .insert({
      client_id: input.clientId,
      pb_id: input.pbId || null,
      started_at: input.startedAt || null,
      ended_at: input.endedAt || null,
      duration_seconds: input.durationSeconds,
      notes: input.notes,
      ips_snapshot: input.ipsSnapshot,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToConsultation(data);
}

export async function updateConsultation(
  id: string,
  patch: { notes?: string; ipsSnapshot?: IPS },
): Promise<void> {
  if (usingLocalFallback || localConsultationExists(id)) {
    const db = loadLocal();
    const cs = db.consultations.find((c) => c.id === id);
    if (cs) {
      if (patch.notes !== undefined) cs.notes = patch.notes;
      if (patch.ipsSnapshot !== undefined) cs.ipsSnapshot = patch.ipsSnapshot;
    }
    saveLocal(db);
    return;
  }
  const row: any = {};
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.ipsSnapshot !== undefined) row.ips_snapshot = patch.ipsSnapshot;
  const { error } = await supabase!.from("consultations").update(row).eq("id", id);
  if (error) throw error;
}

/**
 * PB Home 빠른 메모 — notes 만 갱신. ipsSnapshot 은 절대 건드리지 않는다.
 * 소유권: consultation id + pbId + clientId 가 모두 일치해야 한다.
 */
export async function updateConsultationNote(opts: {
  id: string;
  pbId: string;
  clientId: string;
  notes: string;
}): Promise<Consultation> {
  const { id, pbId, clientId } = opts;

  if (usingLocalFallback || localConsultationExists(id)) {
    const db = loadLocal();
    const found = db.consultations.find((c) => c.id === id);
    if (!found) throw new Error("상담 기록을 찾을 수 없습니다.");
    const patched = patchConsultationNotesOnly(found, { pbId, clientId, notes: opts.notes });
    found.notes = patched.notes;
    saveLocal(db);
    return { ...found };
  }

  const notes = opts.notes.replace(/^\s+|\s+$/g, "");
  // DB: id + pb + client 로 제약. notes 만 갱신해 ips_snapshot 을 덮어쓰지 않는다.
  const { data, error } = await supabase!
    .from("consultations")
    .update({ notes })
    .eq("id", id)
    .eq("pb_id", pbId)
    .eq("client_id", clientId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const db = loadLocal();
    const local = db.consultations.find((c) => c.id === id);
    if (local) {
      const patched = patchConsultationNotesOnly(local, { pbId, clientId, notes: opts.notes });
      local.notes = patched.notes;
      saveLocal(db);
      return { ...local };
    }
    throw new Error("상담 기록을 찾을 수 없거나 권한이 없습니다.");
  }
  return rowToConsultation(data);
}

// ───────────────────────── PB 일정 (pb_schedules) ─────────────────────────
//
// 일정은 원래 브라우저 localStorage 에만 있었다(pb-schedules:{pbId}). 같은 PB 라도 다른
// 기기에서는 아무것도 안 보이고 브라우저 데이터를 지우면 사라졌다. DB 를 우선 쓰고,
// supabase-migration-pb-schedules.sql 미실행 환경에서는 예전대로 localStorage 로 폴백한다
// — investment_surveys 와 같은 방식이다.
//
// 폴백은 "테이블이 없을 때"의 임시 경로지 병행 저장소가 아니다. 테이블이 있으면 DB 만
// 읽는다(로컬 잔여분을 합치지 않는다) — 기기마다 목록이 달라 보이는 상태를 없애는 게
// 이 작업의 목적이기 때문이다. 기존 로컬 일정은 이관하지 않기로 했다.

const PB_SCHEDULE_TABLE = "pb_schedules";

/** Market Home 오늘 일정 요약 등이 같은 탭에서 갱신되도록 알린다. */
function emitPbSchedulesUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("pb-schedules-updated"));
  }
}

/** Postgres time 은 "14:00:00" 으로 온다. 앱은 "HH:MM" 만 쓴다. */
function toHhMm(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 5) : "";
}

function rowToPbSchedule(r: any): PbScheduleItem {
  const base = {
    id: String(r.id),
    pbId: String(r.pb_id ?? ""),
    date: String(r.scheduled_on ?? ""),
    time: toHhMm(r.scheduled_at),
    memo: r.memo ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
    status: (r.status ?? "planned") as PbScheduleStatus,
    updatedAt: r.updated_at ?? undefined,
  };
  if (r.kind === "event") {
    return { ...base, type: "event", title: r.title ?? "" };
  }
  return {
    ...base,
    type: "consultation",
    clientId: r.party_id ?? "",
    clientName: r.client_name ?? "",
    consultationId: r.consultation_id ?? undefined,
  };
}

// 데모 PB·로컬 전용 고객은 id 가 uuid 가 아니라 FK insert 가 실패한다. createConsultation /
// saveInvestmentSurvey 과 같은 판단을 쓴다.
function schedulesUseLocal(pbId: string, clientId?: string): boolean {
  if (usingLocalFallback || isDemoPbId(pbId)) return true;
  return clientId ? localClientExists(clientId) : false;
}

function warnScheduleFallback(action: string, error: { code?: string; message?: string }): void {
  if (MISSING_TABLE_ERROR_CODES.has(error.code ?? "")) {
    console.warn(
      `[store] pb_schedules 테이블 없음 — supabase-migration-pb-schedules.sql 미실행으로 보고 localStorage 로 ${action}`,
    );
  } else {
    console.warn(`[store] pb_schedules ${action} 실패 — localStorage 로 폴백:`, error.message);
  }
}

/** 해당 PB 의 일정 전체(취소분 제외). 본인 것만 본다 — eq('pb_id', pbId). */
export async function listPbSchedules(pbId: string): Promise<PbScheduleItem[]> {
  if (!pbId) return [];
  if (schedulesUseLocal(pbId)) return loadActivePbSchedules(pbId);

  const { data, error } = await supabase!
    .from(PB_SCHEDULE_TABLE)
    .select("*")
    .eq("pb_id", pbId)
    .neq("status", "canceled")
    .order("scheduled_on", { ascending: true })
    .order("scheduled_at", { ascending: true });
  if (error) {
    warnScheduleFallback("조회", error);
    return loadActivePbSchedules(pbId);
  }
  return (data ?? []).map(rowToPbSchedule);
}

export async function createConsultationSchedule(
  pbId: string,
  input: { clientId: string; clientName: string; date: string; time: string; memo?: string },
): Promise<PbScheduleItem> {
  if (schedulesUseLocal(pbId, input.clientId)) {
    const item = addConsultationSchedule(pbId, input);
    emitPbSchedulesUpdated();
    return item;
  }
  const { data, error } = await supabase!
    .from(PB_SCHEDULE_TABLE)
    .insert({
      pb_id: pbId,
      kind: "consultation",
      party_id: input.clientId || null,
      client_name: input.clientName || null,
      scheduled_on: input.date,
      scheduled_at: input.time,
      memo: input.memo || null,
    })
    .select("*")
    .single();
  if (error) {
    warnScheduleFallback("저장", error);
    const item = addConsultationSchedule(pbId, input);
    emitPbSchedulesUpdated();
    return item;
  }
  emitPbSchedulesUpdated();
  return rowToPbSchedule(data);
}

export async function createExtraEventSchedule(
  pbId: string,
  input: { title: string; date: string; time: string; memo?: string },
): Promise<PbScheduleItem> {
  if (schedulesUseLocal(pbId)) {
    const item = addExtraEventSchedule(pbId, input);
    emitPbSchedulesUpdated();
    return item;
  }
  const { data, error } = await supabase!
    .from(PB_SCHEDULE_TABLE)
    .insert({
      pb_id: pbId,
      kind: "event",
      title: input.title,
      scheduled_on: input.date,
      scheduled_at: input.time,
      memo: input.memo || null,
    })
    .select("*")
    .single();
  if (error) {
    warnScheduleFallback("저장", error);
    const item = addExtraEventSchedule(pbId, input);
    emitPbSchedulesUpdated();
    return item;
  }
  emitPbSchedulesUpdated();
  return rowToPbSchedule(data);
}

async function updatePbScheduleStatus(
  pbId: string,
  id: string,
  status: PbScheduleStatus,
  consultationId?: string,
): Promise<void> {
  if (schedulesUseLocal(pbId)) {
    setScheduleStatus(pbId, id, status);
    emitPbSchedulesUpdated();
    return;
  }
  const row: Record<string, any> = { status, updated_at: new Date().toISOString() };
  if (consultationId !== undefined) row.consultation_id = consultationId || null;

  const { error } = await supabase!
    .from(PB_SCHEDULE_TABLE)
    .update(row)
    .eq("id", id)
    .eq("pb_id", pbId); // 남의 일정을 건드리지 않는다
  if (error) {
    warnScheduleFallback("상태 변경", error);
    // 테이블이 없어 로컬에만 있는 일정이면 여기서 처리된다. 로컬에도 없다면 아무 일도
    // 일어나지 않은 것이므로 조용히 성공한 척하지 않고 호출부에 알린다.
    if (!setScheduleStatus(pbId, id, status)) {
      throw new Error(`일정 상태를 바꾸지 못했습니다: ${error.message}`);
    }
  }
  emitPbSchedulesUpdated();
}

/** 일정 취소. 행을 지우지 않고 status='canceled' 로 남긴다(기본 취소 수단). */
export async function cancelPbSchedule(pbId: string, id: string): Promise<void> {
  await updatePbScheduleStatus(pbId, id, "canceled");
}

/** 상담을 실제로 진행했을 때. consultationId 를 주면 그 이력과 잇는다. */
export async function completePbSchedule(
  pbId: string,
  id: string,
  consultationId?: string,
): Promise<void> {
  await updatePbScheduleStatus(pbId, id, "done", consultationId);
}

/** 완전 삭제 — 되돌릴 수 없다. 화면에서 감추는 것이 목적이면 cancelPbSchedule 을 쓴다. */
export async function deletePbSchedule(pbId: string, id: string): Promise<void> {
  if (schedulesUseLocal(pbId)) {
    deleteSchedule(pbId, id);
    emitPbSchedulesUpdated();
    return;
  }
  const { error } = await supabase!
    .from(PB_SCHEDULE_TABLE)
    .delete()
    .eq("id", id)
    .eq("pb_id", pbId);
  if (error) {
    warnScheduleFallback("삭제", error);
    if (!deleteSchedule(pbId, id)) {
      throw new Error(`일정을 삭제하지 못했습니다: ${error.message}`);
    }
  }
  emitPbSchedulesUpdated();
}

// ───────────────────────── Seed / Reset ─────────────────────────

export async function clearAllData(): Promise<void> {
  if (usingLocalFallback) {
    saveLocal({ pbs: [], clients: [], consultations: [] });
    return;
  }
  // 자식부터 삭제
  await supabase!.from("consultations").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase!.from("clients").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase!.from("pbs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
}

// ───────────────────────── Party Relationships (§3) ─────────────────────────

function rowToRelationship(r: any): PartyRelationship {
  return {
    id: r.id,
    fromPartyId: r.from_party_id,
    toPartyId: r.to_party_id,
    relationType: r.relation_type as RelationType,
    ownershipPct: r.ownership_pct == null ? null : Number(r.ownership_pct),
    validFrom: r.valid_from,
    validTo: r.valid_to ?? null,
    createdAt: r.created_at,
  };
}

// partyId가 from 또는 to인 관계 조회
export async function listRelationships(
  partyId: string,
  activeOnly = true,
): Promise<PartyRelationship[]> {
  if (!supabase) return [];
  let q = supabase
    .from("party_relationships")
    .select("*")
    .or(`from_party_id.eq.${partyId},to_party_id.eq.${partyId}`)
    .order("valid_from", { ascending: false });
  if (activeOnly) q = q.is("valid_to", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToRelationship);
}

export async function createRelationship(input: {
  fromPartyId: string;
  toPartyId: string;
  relationType: RelationType;
  ownershipPct?: number | null;
  validFrom?: string;
}): Promise<PartyRelationship> {
  const { data, error } = await supabase!
    .from("party_relationships")
    .insert({
      from_party_id: input.fromPartyId,
      to_party_id: input.toPartyId,
      relation_type: input.relationType,
      ownership_pct: input.ownershipPct ?? null,
      valid_from: input.validFrom ?? new Date().toISOString().slice(0, 10),
    })
    .select()
    .single();
  if (error) throw error;
  return rowToRelationship(data);
}

// 관계 종료 — valid_to 채우기 (기존 행 삭제 안 함, 이력 보존)
export async function closeRelationship(id: string, validTo?: string): Promise<void> {
  const { error } = await supabase!
    .from("party_relationships")
    .update({ valid_to: validTo ?? new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) throw error;
}

// party 이름 검색 (관계 추가 시 상대방 선택용)
export async function searchParties(
  query: string,
  excludeId?: string,
): Promise<{ id: string; displayName: string; partyType: string }[]> {
  if (!supabase || !query.trim()) return [];
  let q = supabase
    .from("parties")
    .select("id, display_name, party_type")
    .ilike("display_name", `%${query}%`)
    .limit(8);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    displayName: r.display_name,
    partyType: r.party_type,
  }));
}

// ───────────────────────── 실질 지배자산 §7-1 ─────────────────────────

export async function computeEffectiveAssets(partyId: string): Promise<EffectiveAssets> {
  if (!supabase) {
    return { directStocks: 0, directRealEstate: 0, directTotal: 0, indirect: [], indirectTotal: 0, grandTotal: 0 };
  }

  // 직접 보유 주식 (avg_price × quantity = 취득원가 기준)
  const { data: holdings } = await supabase
    .from("client_holdings")
    .select("quantity, avg_price")
    .eq("owner_party_id", partyId);
  const directStocks = (holdings ?? []).reduce(
    (s, h) => s + Number(h.quantity ?? 0) * Number(h.avg_price ?? 0), 0,
  );

  // 직접 보유 부동산 (market_value × ownership_share)
  const { data: realty } = await supabase
    .from("client_real_estate")
    .select("market_value, ownership_share")
    .eq("owner_party_id", partyId);
  const directRealEstate = (realty ?? []).reduce(
    (s, r) => s + Number(r.market_value ?? 0) * Number(r.ownership_share ?? 1), 0,
  );

  // 소유 법인 조회 (valid_to is null = 현재 유효)
  const { data: ownRels } = await supabase
    .from("party_relationships")
    .select("to_party_id, ownership_pct")
    .eq("from_party_id", partyId)
    .eq("relation_type", "owns")
    .is("valid_to", null);

  const indirect: EffectiveAssetItem[] = [];
  for (const rel of ownRels ?? []) {
    const corpId = rel.to_party_id;
    const pct = Number(rel.ownership_pct ?? 0);
    if (pct <= 0) continue;

    const [{ data: corpParty }, { data: corpHoldings }, { data: corpRealty }] = await Promise.all([
      supabase.from("parties").select("display_name").eq("id", corpId).maybeSingle(),
      supabase.from("client_holdings").select("quantity, avg_price").eq("owner_party_id", corpId),
      supabase.from("client_real_estate").select("market_value, ownership_share").eq("owner_party_id", corpId),
    ]);

    const corpStocks = (corpHoldings ?? []).reduce(
      (s, h) => s + Number(h.quantity ?? 0) * Number(h.avg_price ?? 0), 0,
    );
    const corpRealty2 = (corpRealty ?? []).reduce(
      (s, r) => s + Number(r.market_value ?? 0) * Number(r.ownership_share ?? 1), 0,
    );
    const totalAssets = corpStocks + corpRealty2;

    indirect.push({
      corporatePartyId: corpId,
      corporateName: (corpParty as any)?.display_name ?? "알 수 없음",
      ownershipPct: pct,
      totalAssets,
      effectiveAssets: Math.round(totalAssets * pct / 100),
    });
  }

  const directTotal = directStocks + directRealEstate;
  const indirectTotal = indirect.reduce((s, i) => s + i.effectiveAssets, 0);
  return {
    directStocks: Math.round(directStocks),
    directRealEstate: Math.round(directRealEstate),
    directTotal: Math.round(directTotal),
    indirect,
    indirectTotal: Math.round(indirectTotal),
    grandTotal: Math.round(directTotal + indirectTotal),
  };
}

// ───────────────────────── 헤리티지 벌크 조회 (N+1 방지) ─────────────────────────
// BookDashboard처럼 담당 고객 전체를 훑는 화면에서 고객 수만큼 쿼리가 늘어나지 않도록,
// 아래 함수들은 모두 partyId 배열 하나를 받아 쿼리 1번으로 전체를 가져온다(listRelationships/
// listTransferEvents처럼 단건 partyId만 받는 기존 함수와 달리 .in(...)을 쓴다). 호출부(예:
// lib/heritage/resolveBulk.ts)가 결과를 partyId별 Map으로 재구성해 재사용한다.

// 최대주주 신호(B) — party_relationships 'owns' 관계를 fromPartyId 배열로 한 번에 조회.
export async function listOwnershipRelationshipsBulk(fromPartyIds: string[]): Promise<PartyRelationship[]> {
  if (!supabase || fromPartyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("party_relationships")
    .select("*")
    .in("from_party_id", fromPartyIds)
    .eq("relation_type", "owns")
    .is("valid_to", null);
  if (error) throw error;
  return (data ?? []).map(rowToRelationship);
}

// 배우자 유무 / 자녀 수 — party_relationships 'spouse'·'child' 관계를 한 번에 조회.
export async function listFamilyRelationshipsBulk(fromPartyIds: string[]): Promise<PartyRelationship[]> {
  if (!supabase || fromPartyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("party_relationships")
    .select("*")
    .in("from_party_id", fromPartyIds)
    .in("relation_type", ["spouse", "child"])
    .is("valid_to", null);
  if (error) throw error;
  return (data ?? []).map(rowToRelationship);
}

export interface RealEstatePropertyBulkItem {
  id: string;
  ownerPartyId: string;
  marketValue: number;
  ownershipShare: number;
}

export interface RealEstateWithDebtBulkResult {
  properties: RealEstatePropertyBulkItem[];
  /** property_id → 채무 합계. */
  debtByPropertyId: Map<string, number>;
}

// 부동산 시가 + 채무 — owner_party_id 배열로 client_real_estate 1번, 거기서 나온
// property_id들로 client_real_estate_debt 1번. 고객 수와 무관하게 항상 쿼리 2번.
export async function listRealEstateWithDebtBulk(ownerPartyIds: string[]): Promise<RealEstateWithDebtBulkResult> {
  if (!supabase || ownerPartyIds.length === 0) return { properties: [], debtByPropertyId: new Map() };

  const { data: propRows, error: e1 } = await supabase
    .from("client_real_estate")
    .select("id, owner_party_id, market_value, ownership_share")
    .in("owner_party_id", ownerPartyIds);
  if (e1) throw e1;

  const properties: RealEstatePropertyBulkItem[] = (propRows ?? []).map((r: any) => ({
    id: r.id,
    ownerPartyId: r.owner_party_id,
    marketValue: Number(r.market_value ?? 0),
    ownershipShare: Number(r.ownership_share ?? 1),
  }));

  const debtByPropertyId = new Map<string, number>();
  const propertyIds = properties.map((p) => p.id);
  if (propertyIds.length > 0) {
    const { data: debtRows, error: e2 } = await supabase
      .from("client_real_estate_debt")
      .select("property_id, balance")
      .in("property_id", propertyIds);
    if (e2) throw e2;
    for (const d of debtRows ?? []) {
      const pid = (d as any).property_id as string;
      debtByPropertyId.set(pid, (debtByPropertyId.get(pid) ?? 0) + Number((d as any).balance ?? 0));
    }
  }

  return { properties, debtByPropertyId };
}

// 10년 합산용 증여 이력 — from_party_id 배열로 한 번에 조회(join 없이, 이름 표시가
// 필요없는 헤리티지 계산 전용 경량 버전).
export async function listGiftEventsBulk(fromPartyIds: string[]): Promise<TransferEvent[]> {
  if (!supabase || fromPartyIds.length === 0) return [];
  const { data, error } = await supabase
    .from("transfer_events")
    .select("*")
    .eq("event_type", "gift")
    .in("from_party_id", fromPartyIds);
  if (error) throw error;
  return (data ?? []).map(rowToTransferEvent);
}

// ───────────────────────── 헤리티지 상담 예약 ─────────────────────────
// MeetingBookingModal이 확정한 예약 요청을 저장한다. heritage_meeting_requests 테이블이
// Supabase에 아직 없으면(마이그레이션 미실행) insert가 실패하고 localStorage로 조용히
// 폴백한다 — 그 세션에서는 정상 동작하지만 다른 기기·다른 PB에게는 안 보인다는 뜻이므로,
// 실제 배포 전에 supabase-migration-heritage-meetings.sql을 한 번 실행해야 한다.

const HERITAGE_MEETING_LS_KEY = "pb-heritage-meeting-requests";

function loadLocalHeritageMeetings(): HeritageMeetingRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HERITAGE_MEETING_LS_KEY);
    return raw ? (JSON.parse(raw) as HeritageMeetingRequest[]) : [];
  } catch {
    return [];
  }
}

function saveLocalHeritageMeetings(list: HeritageMeetingRequest[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HERITAGE_MEETING_LS_KEY, JSON.stringify(list));
  } catch {
    // 저장 공간 초과 등 — 조용히 무시(예약 요청 자체는 화면에 이미 반영됨).
  }
}

function rowToHeritageMeetingRequest(r: any): HeritageMeetingRequest {
  return {
    id: r.id,
    clientId: r.client_id,
    pbId: r.pb_id ?? "",
    expertId: r.expert_id,
    expertName: r.expert_name,
    requestedLabel: r.requested_label,
    requestedDate: r.requested_date ?? null,
    requestedTime: r.requested_time ?? null,
    status: "requested",
    createdAt: r.created_at,
  };
}

export async function createHeritageMeetingRequest(input: {
  clientId: string;
  pbId: string;
  expertId: string;
  expertName: string;
  /** MeetingBookingModal의 onConfirm(value) 문자열 그대로. */
  requestedLabel: string;
}): Promise<HeritageMeetingRequest> {
  const parsed = input.requestedLabel.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  const record: HeritageMeetingRequest = {
    id: uid(),
    clientId: input.clientId,
    pbId: input.pbId,
    expertId: input.expertId,
    expertName: input.expertName,
    requestedLabel: input.requestedLabel,
    requestedDate: parsed?.[1] ?? null,
    requestedTime: parsed?.[2] ?? null,
    status: "requested",
    createdAt: new Date().toISOString(),
  };

  if (usingLocalFallback) {
    const list = loadLocalHeritageMeetings();
    list.push(record);
    saveLocalHeritageMeetings(list);
    return record;
  }

  const { data, error } = await supabase!
    .from("heritage_meeting_requests")
    .insert({
      client_id: record.clientId,
      pb_id: record.pbId || null,
      expert_id: record.expertId,
      expert_name: record.expertName,
      requested_label: record.requestedLabel,
      requested_date: record.requestedDate,
      requested_time: record.requestedTime,
      status: record.status,
    })
    .select()
    .single();

  if (error) {
    console.warn("[store] heritage_meeting_requests 저장 실패(마이그레이션 미실행일 수 있음) — 로컬에 저장:", error.message);
    const list = loadLocalHeritageMeetings();
    list.push(record);
    saveLocalHeritageMeetings(list);
    return record;
  }
  return rowToHeritageMeetingRequest(data);
}

export async function listHeritageMeetingRequests(clientId: string): Promise<HeritageMeetingRequest[]> {
  const local = loadLocalHeritageMeetings().filter((r) => r.clientId === clientId);
  if (usingLocalFallback) {
    return local.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  const { data, error } = await supabase!
    .from("heritage_meeting_requests")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[store] heritage_meeting_requests 조회 실패(마이그레이션 미실행일 수 있음) — 로컬만 표시:", error.message);
    return local;
  }
  const remote = (data ?? []).map(rowToHeritageMeetingRequest);
  const remoteIds = new Set(remote.map((r) => r.id));
  return [...remote, ...local.filter((r) => !remoteIds.has(r.id))].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ───────────────────────── 투자성향 설문 원본 이력 ─────────────────────────
// mapSurveyToIPS는 설문 응답을 7요인으로 가공해 돌려주고, 지금까지는 그 가공 결과만
// parties.ips 로 저장됐다. 설문 원본(답변·점수·최종 성향)은 브라우저 localStorage
// (pb-investment-survey:{pbId}:{clientId})에만 있어, localStorage 키가 (pbId, clientId)
// 복합이라 담당 PB가 바뀌면 이전 설문이 안 보였다. investment_surveys 테이블은
// party_id만으로 조회해 그 문제를 없앤다.
//
// 이 테이블이 없어도 앱은 정상 동작한다 — insert/select 실패 시(마이그레이션 미실행)
// lib/investmentSurveyStorage.ts의 기존 localStorage 경로로 조용히 폴백한다. 다만 그
// 상태에서는 여전히 (pbId, clientId) 키 제약이 남으므로, 실사용 전에
// supabase-migration-investment-surveys.sql을 반드시 실행할 것.
//
// 이력을 누적한다 — 제출할 때마다 새 행을 insert하고 UPDATE하지 않는다. 조회는
// party_id만으로 한다(pb_id는 "누가 진행했는지" 기록용일 뿐 조회 조건이 아니다).

function rowToInvestmentSurveyResult(r: any): InvestmentSurveyResult {
  return {
    answers: r.answers,
    rawScore: r.raw_score,
    convertedScore: Number(r.converted_score),
    tendencyBeforeCap: r.tendency_before_cap ?? "",
    finalTendency: r.final_tendency,
    capReason: r.cap_reason ?? null,
    submittedAt: r.submitted_at,
  };
}

export async function saveInvestmentSurvey(
  partyId: string,
  pbId: string,
  result: InvestmentSurveyResult,
): Promise<void> {
  if (usingLocalFallback || localClientExists(partyId)) {
    saveLocalInvestmentSurvey(pbId, partyId, result);
    return;
  }
  const { error } = await supabase!.from("investment_surveys").insert({
    party_id: partyId,
    pb_id: pbId || null,
    answers: result.answers,
    raw_score: result.rawScore,
    converted_score: result.convertedScore,
    tendency_before_cap: result.tendencyBeforeCap || null,
    final_tendency: result.finalTendency,
    cap_reason: result.capReason,
    submitted_at: result.submittedAt,
  });
  if (error) {
    if (MISSING_TABLE_ERROR_CODES.has(error.code)) {
      console.warn(
        "[store] investment_surveys 테이블 없음 — supabase-migration-investment-surveys.sql 미실행으로 보고 localStorage에 저장",
      );
    } else {
      console.warn("[store] investment_surveys 저장 실패 — localStorage에 저장:", error.message);
    }
    saveLocalInvestmentSurvey(pbId, partyId, result);
  }
}

export async function getLatestInvestmentSurvey(
  partyId: string,
  pbId: string,
): Promise<InvestmentSurveyResult | null> {
  if (usingLocalFallback || localClientExists(partyId)) {
    return loadLocalInvestmentSurvey(pbId, partyId);
  }
  const { data, error } = await supabase!
    .from("investment_surveys")
    .select("*")
    .eq("party_id", partyId)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (MISSING_TABLE_ERROR_CODES.has(error.code)) {
      console.warn(
        "[store] investment_surveys 테이블 없음 — supabase-migration-investment-surveys.sql 미실행으로 보고 localStorage만 조회",
      );
    } else {
      console.warn("[store] investment_surveys 조회 실패 — localStorage만 조회:", error.message);
    }
    return loadLocalInvestmentSurvey(pbId, partyId);
  }
  return data ? rowToInvestmentSurveyResult(data) : loadLocalInvestmentSurvey(pbId, partyId);
}

// ───────────────────────── 포트폴리오 초안 (portfolio_drafts) ─────────────────────────
//
// ManualPortfolioBuilder·KoreanStockTrendFilter의 "선택 종목·자산군 비중·추세 필터
// 체크/확정" 작업 중 초안은 지금까지 브라우저 localStorage에만 있었다
// (pb-manual-portfolio-v1-{clientId}, pb-kr-trend-checked-{clientId},
// pb-kr-trend-confirmed-{clientId}). 다른 기기·브라우저에서 열면 통째로 사라졌다.
// DB를 우선 쓰고, supabase-migration-portfolio-drafts.sql 미실행 환경에서는 예전대로
// localStorage로 폴백한다 — investment_surveys/pb_schedules와 같은 방식이다.
//
// 승인된 확정본(parties.portfolios, approvePortfolioWorkflow)과는 다른 테이블이다.
// 이 테이블은 "지금 작업 중인 초안" 하나만 고객당 1행으로 덮어쓴다(UNIQUE client_id,
// upsert) — 이력이 아니다. 승인 로직은 이 변경의 범위 밖이며 손대지 않았다.

const PORTFOLIO_DRAFT_TABLE = "portfolio_drafts";

export type PortfolioDraftSource = "db" | "local";

function portfolioDraftUseLocal(clientId: string): boolean {
  return usingLocalFallback || localClientExists(clientId);
}

function warnPortfolioDraftFallback(action: string, error: { code?: string; message?: string }): void {
  if (MISSING_TABLE_ERROR_CODES.has(error.code ?? "")) {
    console.warn(
      `[store] portfolio_drafts 테이블 없음 — supabase-migration-portfolio-drafts.sql 미실행으로 보고 localStorage 로 ${action}`,
    );
  } else {
    console.warn(`[store] portfolio_drafts ${action} 실패 — localStorage 로 폴백:`, error.message);
  }
}

/**
 * DB 우선 조회. DB에 행이 있으면 그 값으로 로컬 캐시를 덮어쓴다(다른 기기에서 작업한
 * 게 최신이라는 전제). 테이블 없음(마이그레이션 미실행)·행 없음·에러 시 로컬로 폴백한다.
 *
 * dbReadFailed 는 "DB를 못 읽었다"와 "DB에 초안이 없다"를 구분하려고 둔다. 둘 다
 * source 가 "local" 로 같아서 반환값만으로는 갈라낼 수 없는데, 승인 무효화 판정처럼
 * 없다는 사실 자체가 파괴적 동작(승인 해제)을 부르는 곳에서는 이 둘을 반드시 구분해야
 * 한다 — 네트워크 실패를 "초안 없음"으로 읽으면 멀쩡한 승인을 지운다.
 * 로컬 전용 모드(portfolioDraftUseLocal)는 애초에 DB를 보지 않으므로 실패가 아니다.
 */
export async function getPortfolioDraft(
  pbId: string,
  clientId: string,
): Promise<{
  draft: ManualPortfolioDraft | null;
  source: PortfolioDraftSource;
  dbReadFailed: boolean;
}> {
  if (!clientId) return { draft: null, source: "local", dbReadFailed: false };
  if (portfolioDraftUseLocal(clientId)) {
    return { draft: loadManualPortfolioDraft(clientId), source: "local", dbReadFailed: false };
  }

  const { data, error } = await supabase!
    .from(PORTFOLIO_DRAFT_TABLE)
    .select("draft")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    warnPortfolioDraftFallback("조회", error);
    return { draft: loadManualPortfolioDraft(clientId), source: "local", dbReadFailed: true };
  }
  if (data?.draft) {
    const draft = data.draft as ManualPortfolioDraft;
    saveManualPortfolioDraftLocal(clientId, draft);
    return { draft, source: "db", dbReadFailed: false };
  }
  return { draft: loadManualPortfolioDraft(clientId), source: "local", dbReadFailed: false };
}

/**
 * localStorage에는 항상 먼저 쓴다(오프라인·폴백용 사본). 테이블이 있으면 DB에도 upsert하고,
 * 실패하면(마이그레이션 미실행 포함) 조용히 로컬 저장만 인정한다 — 호출자는 반환된
 * source로 실제 어디에 반영됐는지 표시할 수 있다.
 */
export async function savePortfolioDraft(
  pbId: string,
  clientId: string,
  draft: ManualPortfolioDraft,
): Promise<{ source: PortfolioDraftSource }> {
  if (!clientId) return { source: "local" };
  saveManualPortfolioDraftLocal(clientId, draft);
  if (portfolioDraftUseLocal(clientId)) return { source: "local" };

  const { error } = await supabase!
    .from(PORTFOLIO_DRAFT_TABLE)
    .upsert(
      {
        client_id: clientId,
        pb_id: pbId || null,
        draft,
        saved_at: draft.savedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) {
    warnPortfolioDraftFallback("저장", error);
    return { source: "local" };
  }
  return { source: "db" };
}

export async function deletePortfolioDraft(clientId: string): Promise<void> {
  if (!clientId) return;
  deleteManualPortfolioDraftLocal(clientId);
  if (portfolioDraftUseLocal(clientId)) return;
  const { error } = await supabase!.from(PORTFOLIO_DRAFT_TABLE).delete().eq("client_id", clientId);
  if (error) warnPortfolioDraftFallback("삭제", error);
}

// ───────────────────────── 가문 §4 CRUD ─────────────────────────

function rowToHousehold(r: any): Household {
  return {
    id: r.id,
    name: r.name,
    headPartyId: r.head_party_id ?? null,
    pbId: r.pb_id ?? null,
    createdAt: r.created_at,
  };
}

export async function listHouseholds(pbId?: string): Promise<Household[]> {
  if (!supabase) return [];
  let q = supabase.from("households").select("*").order("created_at", { ascending: false });
  if (pbId) q = q.eq("pb_id", pbId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToHousehold);
}

export async function getHousehold(id: string): Promise<Household | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("households").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToHousehold(data) : null;
}

export async function createHousehold(input: {
  name: string;
  headPartyId?: string | null;
  pbId?: string | null;
}): Promise<Household> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("households")
    .insert({ name: input.name, head_party_id: input.headPartyId ?? null, pb_id: input.pbId ?? null })
    .select()
    .single();
  if (error) throw error;
  return rowToHousehold(data);
}

export async function updateHousehold(
  id: string,
  patch: { name?: string; headPartyId?: string | null },
): Promise<void> {
  if (!supabase) return;
  const row: any = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.headPartyId !== undefined) row.head_party_id = patch.headPartyId;
  const { error } = await supabase.from("households").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteHousehold(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("households").delete().eq("id", id);
  if (error) throw error;
}

// ───────────────────────── 가문 구성원 ─────────────────────────

export async function listHouseholdMembers(
  householdId: string,
): Promise<(HouseholdMember & { partyName: string; partyType: string })[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("household_members")
    .select("*, parties(id, display_name, party_type)")
    .eq("household_id", householdId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    householdId: r.household_id,
    partyId: r.party_id,
    role: r.role ?? null,
    joinedAt: r.joined_at,
    partyName: r.parties?.display_name ?? "",
    partyType: r.parties?.party_type ?? "individual",
  }));
}

export async function addHouseholdMember(
  householdId: string,
  partyId: string,
  role?: string | null,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("household_members")
    .upsert({ household_id: householdId, party_id: partyId, role: role ?? null }, { onConflict: "household_id,party_id" });
  if (error) throw error;
}

export async function removeHouseholdMember(householdId: string, partyId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("party_id", partyId);
  if (error) throw error;
}

// 기존 구성원의 party_relationships에서 아직 가문에 없는 가족 추천
export async function suggestFamilyMembers(
  existingMemberIds: string[],
  householdMemberIds: string[],
): Promise<{ id: string; displayName: string; partyType: string; relatedVia: string }[]> {
  if (!supabase || existingMemberIds.length === 0) return [];

  const FAMILY_TYPES = ["spouse", "child", "parent", "sibling"];
  const householdSet = new Set(householdMemberIds);
  const resultMap: Record<string, { id: string; displayName: string; partyType: string; relatedVia: string }> = {};

  for (const pid of existingMemberIds) {
    const [{ data: fromRels }, { data: toRels }] = await Promise.all([
      supabase.from("party_relationships")
        .select("to_party_id, relation_type, parties!party_relationships_to_party_id_fkey(id, display_name, party_type)")
        .eq("from_party_id", pid)
        .in("relation_type", FAMILY_TYPES)
        .is("valid_to", null),
      supabase.from("party_relationships")
        .select("from_party_id, relation_type, parties!party_relationships_from_party_id_fkey(id, display_name, party_type)")
        .eq("to_party_id", pid)
        .in("relation_type", FAMILY_TYPES)
        .is("valid_to", null),
    ]);

    for (const r of fromRels ?? []) {
      const relatedId = r.to_party_id;
      if (householdSet.has(relatedId) || resultMap[relatedId]) continue;
      const p = Array.isArray(r.parties) ? r.parties[0] : r.parties;
      resultMap[relatedId] = {
        id: relatedId,
        displayName: (p as any)?.display_name ?? "",
        partyType: (p as any)?.party_type ?? "individual",
        relatedVia: r.relation_type,
      };
    }
    for (const r of toRels ?? []) {
      const relatedId = r.from_party_id;
      if (householdSet.has(relatedId) || resultMap[relatedId]) continue;
      const p = Array.isArray(r.parties) ? r.parties[0] : r.parties;
      resultMap[relatedId] = {
        id: relatedId,
        displayName: (p as any)?.display_name ?? "",
        partyType: (p as any)?.party_type ?? "individual",
        relatedVia: r.relation_type,
      };
    }
  }

  return Object.values(resultMap).filter((v) => v.displayName);
}

// ───────────────────────── 가문 총자산 §7-2 ─────────────────────────

export async function computeHouseholdAssets(householdId: string): Promise<HouseholdAssets> {
  if (!supabase) {
    return { householdId, householdName: "", members: [], grandTotal: 0 };
  }

  const [{ data: hhData }, { data: membersData }] = await Promise.all([
    supabase.from("households").select("name").eq("id", householdId).maybeSingle(),
    supabase.from("household_members")
      .select("party_id, role, parties(id, display_name, party_type)")
      .eq("household_id", householdId),
  ]);

  const members = membersData ?? [];
  const memberPartyIds = new Set(members.map((m: any) => m.party_id as string));

  const memberAssets: HouseholdMemberAsset[] = [];
  let grandTotal = 0;

  for (const m of members) {
    const pid: string = (m as any).party_id;
    const party = Array.isArray((m as any).parties) ? (m as any).parties[0] : (m as any).parties;

    // 직접 자산
    const [{ data: holdings }, { data: realty }, { data: ownRels }] = await Promise.all([
      supabase.from("client_holdings").select("quantity, avg_price").eq("owner_party_id", pid),
      supabase.from("client_real_estate").select("market_value, ownership_share").eq("owner_party_id", pid),
      supabase.from("party_relationships")
        .select("to_party_id, ownership_pct")
        .eq("from_party_id", pid)
        .eq("relation_type", "owns")
        .is("valid_to", null),
    ]);

    const directStocks = (holdings ?? []).reduce(
      (s: number, h: any) => s + Number(h.quantity ?? 0) * Number(h.avg_price ?? 0), 0,
    );
    const directRealEstate = (realty ?? []).reduce(
      (s: number, r: any) => s + Number(r.market_value ?? 0) * Number(r.ownership_share ?? 1), 0,
    );

    // 가문 밖 법인 간접보유 (가문 구성원인 법인은 제외 → 이중계상 방지)
    let indirectViaExternalCorps = 0;
    for (const rel of ownRels ?? []) {
      const corpId = (rel as any).to_party_id as string;
      if (memberPartyIds.has(corpId)) continue; // 이미 가문 구성원으로 집계됨

      const pct = Number((rel as any).ownership_pct ?? 0);
      if (pct <= 0) continue;

      const [{ data: corpH }, { data: corpR }] = await Promise.all([
        supabase.from("client_holdings").select("quantity, avg_price").eq("owner_party_id", corpId),
        supabase.from("client_real_estate").select("market_value, ownership_share").eq("owner_party_id", corpId),
      ]);
      const corpStocks = (corpH ?? []).reduce(
        (s: number, h: any) => s + Number(h.quantity ?? 0) * Number(h.avg_price ?? 0), 0,
      );
      const corpRealty = (corpR ?? []).reduce(
        (s: number, r: any) => s + Number(r.market_value ?? 0) * Number(r.ownership_share ?? 1), 0,
      );
      indirectViaExternalCorps += Math.round((corpStocks + corpRealty) * pct / 100);
    }

    const directTotal = Math.round(directStocks + directRealEstate);
    const contribution = directTotal + indirectViaExternalCorps;
    grandTotal += contribution;

    memberAssets.push({
      partyId: pid,
      partyName: (party as any)?.display_name ?? "",
      partyType: (party as any)?.party_type ?? "individual",
      role: (m as any).role ?? null,
      directStocks: Math.round(directStocks),
      directRealEstate: Math.round(directRealEstate),
      directTotal,
      indirectViaExternalCorps,
      contribution,
    });
  }

  return {
    householdId,
    householdName: (hhData as any)?.name ?? "",
    members: memberAssets,
    grandTotal,
  };
}

// ───────────────────────── 증여·상속 이벤트 §5 ─────────────────────────

function rowToTransferEvent(r: any): TransferEvent {
  const fromParty = Array.isArray(r.from_party) ? r.from_party[0] : r.from_party;
  const toParty   = Array.isArray(r.to_party)   ? r.to_party[0]   : r.to_party;
  return {
    id:            r.id,
    eventType:     r.event_type as TransferEventType,
    fromPartyId:   r.from_party_id ?? null,
    toPartyId:     r.to_party_id,
    assetKind:     (r.asset_kind as AssetKind) ?? null,
    assetRef:      r.asset_ref ?? null,
    amount:        r.amount != null ? Number(r.amount) : null,
    eventDate:     r.event_date,
    note:          r.note ?? null,
    createdAt:     r.created_at,
    fromPartyName: fromParty?.display_name ?? undefined,
    toPartyName:   toParty?.display_name   ?? undefined,
  };
}

// 특정 party가 관여한 이벤트 목록 (from 또는 to)
export async function listTransferEvents(
  partyId: string,
  direction: "from" | "to" | "both" = "both",
): Promise<TransferEvent[]> {
  if (!supabase) return [];

  const joinQ = `
    *,
    from_party:parties!transfer_events_from_party_id_fkey(id, display_name),
    to_party:parties!transfer_events_to_party_id_fkey(id, display_name)
  `;

  if (direction === "from") {
    const { data, error } = await supabase
      .from("transfer_events")
      .select(joinQ)
      .eq("from_party_id", partyId)
      .order("event_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToTransferEvent);
  }
  if (direction === "to") {
    const { data, error } = await supabase
      .from("transfer_events")
      .select(joinQ)
      .eq("to_party_id", partyId)
      .order("event_date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(rowToTransferEvent);
  }
  // both
  const [{ data: fromData, error: e1 }, { data: toData, error: e2 }] = await Promise.all([
    supabase.from("transfer_events").select(joinQ).eq("from_party_id", partyId).order("event_date", { ascending: false }),
    supabase.from("transfer_events").select(joinQ).eq("to_party_id",   partyId).order("event_date", { ascending: false }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const seen = new Set<string>();
  return [...(fromData ?? []), ...(toData ?? [])]
    .map(rowToTransferEvent)
    .filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; })
    .sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
}

export async function createTransferEvent(input: {
  eventType: TransferEventType;
  fromPartyId?: string | null;
  toPartyId: string;
  assetKind?: AssetKind | null;
  assetRef?: string | null;
  amount?: number | null;
  eventDate: string;
  note?: string | null;
}): Promise<TransferEvent> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase
    .from("transfer_events")
    .insert({
      event_type:    input.eventType,
      from_party_id: input.fromPartyId ?? null,
      to_party_id:   input.toPartyId,
      asset_kind:    input.assetKind   ?? null,
      asset_ref:     input.assetRef    ?? null,
      amount:        input.amount      ?? null,
      event_date:    input.eventDate,
      note:          input.note        ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToTransferEvent(data);
}

export async function deleteTransferEvent(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("transfer_events").delete().eq("id", id);
  if (error) throw error;
}

// ───────────────────────── §7-3 증여 10년 합산 ─────────────────────────

// 특정 (증여자→수증자) 쌍의 최근 10년 증여 합계
export async function computeGiftSum10y(
  fromPartyId: string,
  toPartyId: string,
): Promise<number> {
  if (!supabase) return 0;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 10);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("transfer_events")
    .select("amount")
    .eq("event_type", "gift")
    .eq("from_party_id", fromPartyId)
    .eq("to_party_id", toPartyId)
    .gte("event_date", cutoffStr);
  if (error) throw error;
  return (data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

// 특정 party 기준 모든 증여 쌍 × 10년 합산 요약
export async function listGiftSummaries10y(partyId: string): Promise<GiftPairSummary[]> {
  if (!supabase) return [];
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 10);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const joinQ = `
    from_party_id, to_party_id, amount, event_date,
    from_party:parties!transfer_events_from_party_id_fkey(id, display_name),
    to_party:parties!transfer_events_to_party_id_fkey(id, display_name)
  `;

  const [{ data: given, error: e1 }, { data: received, error: e2 }] = await Promise.all([
    supabase.from("transfer_events")
      .select(joinQ).eq("event_type", "gift").eq("from_party_id", partyId).gte("event_date", cutoffStr),
    supabase.from("transfer_events")
      .select(joinQ).eq("event_type", "gift").eq("to_party_id", partyId).gte("event_date", cutoffStr),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const pairMap: Record<string, GiftPairSummary> = {};

  const addRow = (r: any) => {
    const fromP  = Array.isArray(r.from_party) ? r.from_party[0] : r.from_party;
    const toP    = Array.isArray(r.to_party)   ? r.to_party[0]   : r.to_party;
    const key    = `${r.from_party_id}|${r.to_party_id}`;
    const amount = Number(r.amount ?? 0);
    if (!pairMap[key]) {
      pairMap[key] = {
        fromPartyId:     r.from_party_id,
        toPartyId:       r.to_party_id,
        fromPartyName:   fromP?.display_name ?? "(미상)",
        toPartyName:     toP?.display_name   ?? "(미상)",
        totalAmount:     0,
        eventCount:      0,
        latestEventDate: r.event_date,
      };
    }
    pairMap[key].totalAmount += amount;
    pairMap[key].eventCount  += 1;
    if (r.event_date > pairMap[key].latestEventDate) {
      pairMap[key].latestEventDate = r.event_date;
    }
  };

  for (const r of [...(given ?? []), ...(received ?? [])]) addRow(r);

  return Object.values(pairMap).sort((a, b) => b.totalAmount - a.totalAmount);
}
