const SEOUL_TZ = "Asia/Seoul";

export interface SchedulerReadiness {
  ready: boolean;
  reason?: string;
}

export function describeSchedulerReadiness(): SchedulerReadiness {
  const enabled = process.env.STRATEGY_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (enabled === "1" || enabled === "true" || enabled === "yes") {
    return { ready: true };
  }
  return {
    ready: false,
    reason: "자동실행 준비 안 됨 — cron/워커 미배포",
  };
}

function seoulParts(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value ?? "Mon";

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    weekday: weekdayMap[weekdayLabel] ?? 1,
  };
}

export function seoulDateKey(date: Date = new Date()): string {
  const { year, month, day } = seoulParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isSeoulTradingDay(date: Date = new Date()): boolean {
  const { weekday } = seoulParts(date);
  return weekday >= 1 && weekday <= 5;
}

/** Regular KRX cash session approximation (09:00–15:30 KST). */
export function isRegularSessionOpen(date: Date = new Date()): boolean {
  if (!isSeoulTradingDay(date)) return false;
  const { hour, minute } = seoulParts(date);
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

/** After-close (장후 시간외) window approximation (15:40–18:00 KST). */
export function isAfterCloseSessionOpen(date: Date = new Date()): boolean {
  if (!isSeoulTradingDay(date)) return false;
  const { hour, minute } = seoulParts(date);
  const minutes = hour * 60 + minute;
  return minutes >= 15 * 60 + 40 && minutes < 18 * 60;
}

export function sessionLabel(date: Date = new Date()): "regular" | "after_close" | "closed" {
  if (isRegularSessionOpen(date)) return "regular";
  if (isAfterCloseSessionOpen(date)) return "after_close";
  return "closed";
}

export function minutesUntilNextRegularOpen(from: Date = new Date()): number | null {
  if (isRegularSessionOpen(from)) return 0;

  const probe = new Date(from.getTime());
  for (let i = 0; i < 8; i += 1) {
    const parts = seoulParts(probe);
    if (isSeoulTradingDay(probe)) {
      const openMinutes = 9 * 60;
      const nowMinutes = parts.hour * 60 + parts.minute;
      if (nowMinutes < openMinutes) {
        return openMinutes - nowMinutes;
      }
    }
    probe.setUTCDate(probe.getUTCDate() + 1);
    probe.setUTCHours(probe.getUTCHours()); // advance calendar day; seoulParts handles TZ
  }
  return null;
}
