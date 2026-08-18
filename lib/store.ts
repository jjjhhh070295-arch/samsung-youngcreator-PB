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
} from "./types";
import { emptyIPS } from "./types";
import { SAMPLE_BOOK_CLIENTS } from "./advisory/sampleBook";

export const usingLocalFallback = !isSupabaseConfigured;

// ───────────────────────── 변환기 (row ↔ 모델) ─────────────────────────

function rowToPb(r: any): PB {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    employeeId: r.employee_id ?? "",
    password: r.password ?? "",
    createdAt: r.created_at,
  };
}

// parties join 결과(individuals/corporates 포함) → Client
function rowToClient(r: any): Client {
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
    stages: (r.stages ?? {}) as Client["stages"],
    createdAt: r.created_at,
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
  if (c.stages !== undefined) row.stages = c.stages;
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

// ───────────────────────── 로컬 폴백 저장소 ─────────────────────────

interface LocalDB {
  pbs: PB[];
  clients: Client[];
  consultations: Consultation[];
}

const LS_KEY = "pb-app-local-db";
const SAMPLE_PB_ID = "pb-demo-youngcreator";
const SAMPLE_CLIENT_ID = "client-hanbit-cashflow-sample";

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
  const pb =
    db.pbs[0] ??
    ({
      id: SAMPLE_PB_ID,
      code: "PB-001",
      name: "데모 PB",
      employeeId: "PB-001",
      password: "1234",
      createdAt: nowIso,
    } satisfies PB);

  if (db.pbs.length === 0) {
    db.pbs.push(pb);
    changed = true;
  }

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

export async function listPbs(): Promise<PB[]> {
  if (usingLocalFallback) {
    return loadLocal().pbs.slice().sort((a, b) => a.code.localeCompare(b.code));
  }
  const { data, error } = await supabase!
    .from("pbs")
    .select("*")
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToPb);
}

export async function createPb(data: { name: string; employeeId: string; password: string }): Promise<PB> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb: PB = {
      id: uid(),
      code: nextPbCode(db.pbs),
      name: data.name,
      employeeId: data.employeeId,
      password: data.password,
      createdAt: new Date().toISOString(),
    };
    db.pbs.push(pb);
    saveLocal(db);
    return pb;
  }
  const existing = await listPbs();
  const code = nextPbCode(existing);
  const { data: row, error } = await supabase!
    .from("pbs")
    .insert({ code, name: data.name, employee_id: data.employeeId, password: data.password })
    .select()
    .single();
  if (error) throw error;
  return rowToPb(row);
}

export async function updatePb(id: string, data: { name?: string; employeeId?: string; password?: string }): Promise<void> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb = db.pbs.find((p) => p.id === id);
    if (pb) {
      if (data.name !== undefined) pb.name = data.name;
      if (data.employeeId !== undefined) pb.employeeId = data.employeeId;
      if (data.password !== undefined) pb.password = data.password;
    }
    saveLocal(db);
    return;
  }
  const row: any = {};
  if (data.name !== undefined) row.name = data.name;
  if (data.employeeId !== undefined) row.employee_id = data.employeeId;
  if (data.password !== undefined) row.password = data.password;
  const { error } = await supabase!.from("pbs").update(row).eq("id", id);
  if (error) throw error;
}

export async function deletePb(id: string): Promise<void> {
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
  if (error) throw error;
  return (data ?? []).map(rowToClient);
}

export async function listClientsByPb(pbId: string): Promise<Client[]> {
  const all = await listClients();
  return all.filter((c) => c.assignedPbId === pbId);
}

export async function getClient(id: string): Promise<Client | null> {
  if (usingLocalFallback) {
    return loadLocal().clients.find((c) => c.id === id) ?? null;
  }
  const { data, error } = await supabase!
    .from("parties")
    .select("*, individuals(*), corporates!party_id(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
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
}

export async function createClient(input: NewClientInput): Promise<Client> {
  if (usingLocalFallback) {
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
    };
    db.clients.push(client);
    saveLocal(db);
    return client;
  }
  const existing = await listClients();
  const code = input.code || nextClientCode(existing);

  // 1. parties 테이블 INSERT
  const { data: partyData, error: pe } = await supabase!
    .from("parties")
    .insert({
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
    })
    .select()
    .single();
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
  if (usingLocalFallback) {
    const db = loadLocal();
    const idx = db.clients.findIndex((c) => c.id === id);
    if (idx >= 0) db.clients[idx] = { ...db.clients[idx], ...patch };
    saveLocal(db);
    return;
  }

  // parties 업데이트
  const partyRow = clientToPartyRow(patch);
  if (Object.keys(partyRow).length > 0) {
    const { error } = await supabase!.from("parties").update(partyRow).eq("id", id);
    if (error) throw error;
  }

  // clients 동기 업데이트 (backward compat)
  const clientRow = clientToRow(patch);
  if (Object.keys(clientRow).length > 0) {
    await supabase!.from("clients").update(clientRow).eq("id", id);
  }

  // 서브테이블 업데이트
  const indRow = clientToIndividualRow(patch);
  if (Object.keys(indRow).length > 0) {
    await supabase!.from("individuals").update(indRow).eq("party_id", id);
  }
  const corpRow = clientToCorporateRow(patch);
  if (Object.keys(corpRow).length > 0) {
    await supabase!.from("corporates").update(corpRow).eq("party_id", id);
  }
}

export async function deleteClient(id: string): Promise<void> {
  if (usingLocalFallback) {
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
  if (error) throw error;
  return (data ?? []).map(rowToConsultation);
}

export async function listAllConsultations(): Promise<Consultation[]> {
  if (usingLocalFallback) {
    return loadLocal().consultations.slice();
  }
  const { data, error } = await supabase!.from("consultations").select("*");
  if (error) throw error;
  return (data ?? []).map(rowToConsultation);
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
  if (usingLocalFallback) {
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
  if (usingLocalFallback) {
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
