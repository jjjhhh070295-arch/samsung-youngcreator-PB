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
} from "./types";
import { emptyIPS } from "./types";

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

function rowToClient(r: any): Client {
  return {
    id: r.id,
    code: r.code,
    clientType: r.client_type,
    name: r.name,
    birthDate: r.birth_date ?? "",
    assignedPbId: r.assigned_pb_id ?? "",
    assetSize: Number(r.asset_size ?? 0),
    linkedClientId: r.linked_client_id ?? null,
    ownershipPct: r.ownership_pct == null ? null : Number(r.ownership_pct),
    isMajorityShareholder: r.is_majority_shareholder ?? null,
    accountSeparation: r.account_separation ?? null,
    consultationNotes: r.consultation_notes ?? "",
    ips: (r.ips && Object.keys(r.ips).length ? r.ips : emptyIPS()) as IPS,
    cashFlows: (r.cash_flows ?? []) as CashFlow[],
    portfolios: (r.portfolios ?? []) as Portfolio[],
    stages: (r.stages ?? {}) as Client["stages"],
    createdAt: r.created_at,
  };
}

function clientToRow(c: Partial<Client>): any {
  const row: any = {};
  if (c.code !== undefined) row.code = c.code;
  if (c.clientType !== undefined) row.client_type = c.clientType;
  if (c.name !== undefined) row.name = c.name;
  if (c.birthDate !== undefined) row.birth_date = c.birthDate || null;
  if (c.assignedPbId !== undefined) row.assigned_pb_id = c.assignedPbId || null;
  if (c.assetSize !== undefined) row.asset_size = c.assetSize;
  if (c.linkedClientId !== undefined) row.linked_client_id = c.linkedClientId || null;
  if (c.ownershipPct !== undefined) row.ownership_pct = c.ownershipPct ?? null;
  if (c.isMajorityShareholder !== undefined) row.is_majority_shareholder = c.isMajorityShareholder ?? null;
  if (c.accountSeparation !== undefined) row.account_separation = c.accountSeparation ?? null;
  if (c.consultationNotes !== undefined) row.consultation_notes = c.consultationNotes;
  if (c.ips !== undefined) row.ips = c.ips;
  if (c.cashFlows !== undefined) row.cash_flows = c.cashFlows;
  if (c.portfolios !== undefined) row.portfolios = c.portfolios;
  if (c.stages !== undefined) row.stages = c.stages;
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
    ["부동산 양도세 예상액", -420_000_000, "2026-11"],
    ["증여세 예상액", -150_000_000, "2027-02"],
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
      "2026년 10월~2027년 5월 주요 현금화 일정, 잔여 운용자금은 3년 이상",
      3,
      "M&A 클로징 2026-10-31, 증여 예정일 2026-11-20, IPO 보호예수 해제일 2027-03-31",
    ),
    tax: factor(
      "법인세·부동산 양도세·증여세·해외주식 양도세 납부일 우선 반영",
      5,
      "법인세 예상액 11.8억원, 부동산 양도세 4.2억원, 증여세 1.5억원, 해외주식 양도세 0.85억원",
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
      "2026년 법인세·양도세·가업승계 증여세 납부 재원 분리 필요. 잔여 운용자금도 세후 효율과 절세 가능성을 우선 검토",
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
    .from("clients")
    .select("*")
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
    .from("clients")
    .select("*")
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
  const { data, error } = await supabase!
    .from("clients")
    .insert(
      clientToRow({
        code,
        clientType: input.clientType,
        name: input.name,
        birthDate: input.birthDate,
        assignedPbId: input.assignedPbId,
        assetSize: input.assetSize,
        linkedClientId: input.linkedClientId ?? null,
        ownershipPct: input.ownershipPct ?? null,
        isMajorityShareholder: input.isMajorityShareholder ?? null,
        accountSeparation: input.accountSeparation ?? null,
        ips: emptyIPS(),
        cashFlows: [],
        portfolios: [],
      }),
    )
    .select()
    .single();
  if (error) throw error;
  return rowToClient(data);
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const idx = db.clients.findIndex((c) => c.id === id);
    if (idx >= 0) db.clients[idx] = { ...db.clients[idx], ...patch };
    saveLocal(db);
    return;
  }
  const { error } = await supabase!.from("clients").update(clientToRow(patch)).eq("id", id);
  if (error) throw error;
}

export async function deleteClient(id: string): Promise<void> {
  if (usingLocalFallback) {
    const db = loadLocal();
    db.clients = db.clients.filter((c) => c.id !== id);
    db.consultations = db.consultations.filter((cs) => cs.clientId !== id);
    saveLocal(db);
    return;
  }
  // on delete cascade 로 consultations 함께 삭제됨
  const { error } = await supabase!.from("clients").delete().eq("id", id);
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
