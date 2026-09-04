export type PbScheduleStatus = "planned" | "done" | "canceled";

export interface ConsultationSchedule {
  id: string;
  type: "consultation";
  pbId: string;
  clientId: string;
  clientName: string;
  date: string;
  time: string;
  memo?: string;
  createdAt: string;
  /** 없으면 "planned" — 상태 도입 이전에 저장된 값과 호환된다. */
  status?: PbScheduleStatus;
  updatedAt?: string;
  /** 상담을 실제로 진행했을 때 그 이력(consultations)의 id. */
  consultationId?: string;
}

export interface ExtraEventSchedule {
  id: string;
  type: "event";
  pbId: string;
  title: string;
  date: string;
  time: string;
  memo?: string;
  createdAt: string;
  /** 없으면 "planned" — 상태 도입 이전에 저장된 값과 호환된다. */
  status?: PbScheduleStatus;
  updatedAt?: string;
}

export type PbScheduleItem = ConsultationSchedule | ExtraEventSchedule;

const SCHEDULES_KEY = (pbId: string) => `pb-schedules:${pbId || "default"}`;
const EVENTS_KEY = (pbId: string) => `pb-extra-events:${pbId || "default"}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Today's date in Asia/Seoul as YYYY-MM-DD. */
export function todayKstDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

export const KST_WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** Weekday index for a KST calendar date (0 = Sunday). */
export function kstWeekdayIndex(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00+09:00`).getUTCDay();
}

export function formatKstDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const weekday = KST_WEEKDAY_LABELS[kstWeekdayIndex(dateStr)];
  return `${year}.${month}.${day} (${weekday})`;
}

export function formatKstTodoHeader(dateStr: string): string {
  return `${formatKstDateLabel(dateStr)} 해야 할 일`;
}

export function parseKstDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split("-").map(Number);
  return { year, month, day };
}

export function formatKstDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInKstMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar grid cells for a month; null = leading padding. */
export function buildMonthCalendarDays(year: number, month: number): (string | null)[] {
  const total = daysInKstMonth(year, month);
  const leading = kstWeekdayIndex(formatKstDate(year, month, 1));
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= total; day += 1) {
    cells.push(formatKstDate(year, month, day));
  }
  return cells;
}

export function getScheduleDateSet(pbId: string): Set<string> {
  return new Set(loadAllPbSchedules(pbId).map((item) => item.date));
}

/** 상태 도입 이전에 저장된 항목은 status 가 없다 — "planned" 로 본다. */
function withStatus<T extends { status?: PbScheduleStatus }>(item: T): T {
  return item.status ? item : { ...item, status: "planned" as PbScheduleStatus };
}

export function loadConsultationSchedules(pbId: string): ConsultationSchedule[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<ConsultationSchedule[]>(window.localStorage.getItem(SCHEDULES_KEY(pbId)));
  return Array.isArray(parsed) ? parsed.filter((s) => s.pbId === pbId).map(withStatus) : [];
}

export function loadExtraEvents(pbId: string): ExtraEventSchedule[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<ExtraEventSchedule[]>(window.localStorage.getItem(EVENTS_KEY(pbId)));
  return Array.isArray(parsed) ? parsed.filter((s) => s.pbId === pbId).map(withStatus) : [];
}

export function loadAllPbSchedules(pbId: string): PbScheduleItem[] {
  return [...loadConsultationSchedules(pbId), ...loadExtraEvents(pbId)];
}

export function saveConsultationSchedules(pbId: string, items: ConsultationSchedule[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SCHEDULES_KEY(pbId), JSON.stringify(items));
}

export function saveExtraEvents(pbId: string, items: ExtraEventSchedule[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENTS_KEY(pbId), JSON.stringify(items));
}

export function addConsultationSchedule(
  pbId: string,
  input: Omit<ConsultationSchedule, "id" | "type" | "pbId" | "createdAt">,
): ConsultationSchedule {
  const next: ConsultationSchedule = {
    id: uid("consult"),
    type: "consultation",
    pbId,
    createdAt: new Date().toISOString(),
    ...input,
  };
  const items = [...loadConsultationSchedules(pbId), next];
  saveConsultationSchedules(pbId, items);
  return next;
}

export function addExtraEventSchedule(
  pbId: string,
  input: Omit<ExtraEventSchedule, "id" | "type" | "pbId" | "createdAt">,
): ExtraEventSchedule {
  const next: ExtraEventSchedule = {
    id: uid("event"),
    type: "event",
    pbId,
    createdAt: new Date().toISOString(),
    ...input,
  };
  const items = [...loadExtraEvents(pbId), next];
  saveExtraEvents(pbId, items);
  return next;
}

/**
 * 상태 변경 — 취소(canceled)·완료(done)에 쓴다. 해당 id 를 못 찾으면 false.
 * 상담·기타 두 배열 중 어디에 있는지 모르므로 둘 다 훑는다.
 *
 * DB(pb_schedules)가 있는 환경에서는 lib/store.ts 가 직접 update 하고 이 함수는
 * 타지 않는다. 여기는 supabase-migration-pb-schedules.sql 미실행 환경의 폴백이다.
 */
export function setScheduleStatus(pbId: string, id: string, status: PbScheduleStatus): boolean {
  if (typeof window === "undefined") return false;
  const now = new Date().toISOString();

  const consultations = loadConsultationSchedules(pbId);
  const consultIdx = consultations.findIndex((item) => item.id === id);
  if (consultIdx >= 0) {
    consultations[consultIdx] = { ...consultations[consultIdx], status, updatedAt: now };
    saveConsultationSchedules(pbId, consultations);
    return true;
  }

  const events = loadExtraEvents(pbId);
  const eventIdx = events.findIndex((item) => item.id === id);
  if (eventIdx >= 0) {
    events[eventIdx] = { ...events[eventIdx], status, updatedAt: now };
    saveExtraEvents(pbId, events);
    return true;
  }
  return false;
}

/** 완전 삭제. 되돌릴 수 없으므로 기본은 setScheduleStatus(…, "canceled") 를 쓴다. */
export function deleteSchedule(pbId: string, id: string): boolean {
  if (typeof window === "undefined") return false;

  const consultations = loadConsultationSchedules(pbId);
  const nextConsultations = consultations.filter((item) => item.id !== id);
  if (nextConsultations.length !== consultations.length) {
    saveConsultationSchedules(pbId, nextConsultations);
    return true;
  }

  const events = loadExtraEvents(pbId);
  const nextEvents = events.filter((item) => item.id !== id);
  if (nextEvents.length !== events.length) {
    saveExtraEvents(pbId, nextEvents);
    return true;
  }
  return false;
}

/** 취소된 항목을 뺀 전체 일정. 화면에 뿌릴 목록은 이걸 쓴다. */
export function loadActivePbSchedules(pbId: string): PbScheduleItem[] {
  return loadAllPbSchedules(pbId).filter((item) => item.status !== "canceled");
}

export function listTodayTodos(pbId: string, date = todayKstDate()): PbScheduleItem[] {
  return loadActivePbSchedules(pbId)
    .filter((item) => item.date === date)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
}
