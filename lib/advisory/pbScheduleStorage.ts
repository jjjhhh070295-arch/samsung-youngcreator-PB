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

export function loadConsultationSchedules(pbId: string): ConsultationSchedule[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<ConsultationSchedule[]>(window.localStorage.getItem(SCHEDULES_KEY(pbId)));
  return Array.isArray(parsed) ? parsed.filter((s) => s.pbId === pbId) : [];
}

export function loadExtraEvents(pbId: string): ExtraEventSchedule[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<ExtraEventSchedule[]>(window.localStorage.getItem(EVENTS_KEY(pbId)));
  return Array.isArray(parsed) ? parsed.filter((s) => s.pbId === pbId) : [];
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

export function listTodayTodos(pbId: string, date = todayKstDate()): PbScheduleItem[] {
  return loadAllPbSchedules(pbId)
    .filter((item) => item.date === date)
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time));
}
