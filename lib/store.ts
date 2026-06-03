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
  return { id: r.id, code: r.code, name: r.name, createdAt: r.created_at };
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

function loadLocal(): LocalDB {
  if (typeof window === "undefined") return { pbs: [], clients: [], consultations: [] };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { pbs: [], clients: [], consultations: [] };
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

export async function createPb(name: string): Promise<PB> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb: PB = {
      id: uid(),
      code: nextPbCode(db.pbs),
      name,
      createdAt: new Date().toISOString(),
    };
    db.pbs.push(pb);
    saveLocal(db);
    return pb;
  }
  const existing = await listPbs();
  const code = nextPbCode(existing);
  const { data, error } = await supabase!
    .from("pbs")
    .insert({ code, name })
    .select()
    .single();
  if (error) throw error;
  return rowToPb(data);
}

export async function updatePb(id: string, name: string): Promise<void> {
  if (usingLocalFallback) {
    const db = loadLocal();
    const pb = db.pbs.find((p) => p.id === id);
    if (pb) pb.name = name;
    saveLocal(db);
    return;
  }
  const { error } = await supabase!.from("pbs").update({ name }).eq("id", id);
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
