/**
 * 거래일 달력 — 월~금만으로 판단하지 않음.
 * 조회 실패·유효기간 만료 시 fail-closed (주문 금지).
 */

import { seoulParts } from "./sessions";

export interface CalendarDay {
  date: string;
  isTradingDay: boolean;
  reason?: string;
  openMinutes?: number | null;
  closeMinutes?: number | null;
}

export interface CalendarSnapshot {
  ok: boolean;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  today: string;
  isTradingDay: boolean;
  reason?: string;
  days: CalendarDay[];
}

const g = globalThis as typeof globalThis & {
  __tradingCalendarCache?: CalendarSnapshot | null;
};

export function seoulDateKey(date: Date = new Date()): string {
  const { year, month, day } = seoulParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const KNOWN_KR_HOLIDAYS_2026 = new Set([
  "2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-01",
  "2026-05-05","2026-05-24","2026-06-06","2026-08-15","2026-10-03",
  "2026-10-05","2026-10-09","2026-12-25",
]);

export function isWeekendSeoul(date: Date = new Date()): boolean {
  const { weekday } = seoulParts(date);
  return weekday === 0 || weekday === 6;
}

export function heuristicTradingDay(date: Date = new Date()): CalendarDay {
  const key = seoulDateKey(date);
  if (isWeekendSeoul(date)) return { date: key, isTradingDay: false, reason: "주말" };
  if (KNOWN_KR_HOLIDAYS_2026.has(key)) return { date: key, isTradingDay: false, reason: "법정공휴일(정적목록)" };
  return { date: key, isTradingDay: true, reason: "평일(정적휴리스틱)" };
}

export function setCalendarCacheForTests(snap: CalendarSnapshot | null): void {
  g.__tradingCalendarCache = snap;
}

export function getCachedCalendar(): CalendarSnapshot | null {
  return g.__tradingCalendarCache ?? null;
}

export function isCalendarUsable(snap: CalendarSnapshot | null | undefined, now = new Date()): boolean {
  if (!snap || !snap.ok) return false;
  const exp = Date.parse(snap.expiresAt);
  if (!Number.isFinite(exp) || exp <= now.getTime()) return false;
  return true;
}

export async function resolveTradingCalendar(options?: {
  now?: Date;
  provider?: () => Promise<{ days: CalendarDay[]; source: string }>;
  ttlMs?: number;
  allowHeuristicFallback?: boolean;
}): Promise<CalendarSnapshot> {
  const now = options?.now ?? new Date();
  const today = seoulDateKey(now);
  const ttlMs = options?.ttlMs ?? 6 * 60 * 60 * 1000;
  const cached = getCachedCalendar();
  if (cached && isCalendarUsable(cached, now) && cached.today === today) return cached;

  if (options?.provider) {
    try {
      const { days, source } = await options.provider();
      const todayRow = days.find((d) => d.date === today);
      if (!todayRow) {
        const fail: CalendarSnapshot = {
          ok: false, source, fetchedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
          today, isTradingDay: false, reason: "오늘 날짜가 달력 응답에 없음 — 주문 차단", days,
        };
        g.__tradingCalendarCache = fail;
        return fail;
      }
      const snap: CalendarSnapshot = {
        ok: true, source, fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        today, isTradingDay: todayRow.isTradingDay, reason: todayRow.reason, days,
      };
      g.__tradingCalendarCache = snap;
      return snap;
    } catch (e: unknown) {
      const fail: CalendarSnapshot = {
        ok: false, source: "provider_error", fetchedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        today, isTradingDay: false,
        reason: e instanceof Error ? e.message : "달력 조회 실패 — 주문 차단", days: [],
      };
      g.__tradingCalendarCache = fail;
      return fail;
    }
  }

  if (options?.allowHeuristicFallback) {
    const h = heuristicTradingDay(now);
    const snap: CalendarSnapshot = {
      ok: true, source: "heuristic:static-holidays", fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      today, isTradingDay: h.isTradingDay, reason: h.reason, days: [h],
    };
    g.__tradingCalendarCache = snap;
    return snap;
  }

  const fail: CalendarSnapshot = {
    ok: false, source: "unconfigured", fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    today, isTradingDay: false, reason: "거래일 제공자 없음 — fail-closed", days: [],
  };
  g.__tradingCalendarCache = fail;
  return fail;
}

export function assertTradingDayOrThrow(snap: CalendarSnapshot): void {
  if (!isCalendarUsable(snap)) throw new Error(snap.reason || "거래일 달력 만료/실패 — 주문 차단");
  if (!snap.isTradingDay) throw new Error(snap.reason || "오늘은 휴장일 — 주문 차단");
}
