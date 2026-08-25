/**
 * KRX / NXT 세션 (Asia/Seoul).
 * 종목 선별·일봉 신호는 KRX 공식 일봉 기준. 당일 봉은 종가 확정 전 incomplete.
 */

export type MarketSession =
  | "NXT_PRE"
  | "KRX_REGULAR"
  | "NXT_MAIN"
  | "KRX_CLOSING_AUCTION"
  | "NXT_AFTER"
  | "CLOSED";

export interface SessionSnapshot {
  session: MarketSession;
  /** 동시 유효 세션(겹치는 구간) */
  activeSessions: MarketSession[];
  minutesOfDay: number;
  timezone: "Asia/Seoul";
  asOfIso: string;
  /** KRX 당일 공식 종가 확정 여부(15:30 이후 근사) */
  krxOfficialCloseConfirmed: boolean;
  /** 신규 주문 허용(세션만; 휴장일·live 조건은 별도) */
  orderable: boolean;
  labelKo: string;
  nextSession: MarketSession | null;
  nextSessionStartMinutes: number | null;
}

const SEOUL = "Asia/Seoul";

export function seoulParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SEOUL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value ?? "0";
    return Number.parseInt(value, 10);
  };
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekdayLabel = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour") === 24 ? 0 : lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second"),
    weekday: weekdayMap[weekdayLabel] ?? 1,
  };
}

export function minutesOfSeoulDay(date: Date = new Date()): number {
  const { hour, minute } = seoulParts(date);
  return hour * 60 + minute;
}

function inRange(m: number, start: number, endExclusive: number): boolean {
  return m >= start && m < endExclusive;
}

/** HH:MM → minutes */
export function hm(h: number, m = 0): number {
  return h * 60 + m;
}

/**
 * 세션 판정 (거래일 전제 — 휴장일은 호출측에서 CLOSED 강제).
 * NXT_PRE 08:00–08:50
 * KRX_REGULAR 09:00–15:30
 * NXT_MAIN 09:00:30–15:20
 * KRX_CLOSING_AUCTION 15:20–15:30
 * NXT_AFTER 주문접수 15:30–20:00 (체결 15:40–20:00)
 */
export function detectMarketSessions(
  date: Date = new Date(),
  options?: { isTradingDay?: boolean },
): SessionSnapshot {
  const isTradingDay = options?.isTradingDay !== false;
  const parts = seoulParts(date);
  const minutes = minutesOfSeoulDay(date);
  const seconds = parts.second;
  const asOfIso = date.toISOString();

  if (!isTradingDay) {
    return {
      session: "CLOSED",
      activeSessions: ["CLOSED"],
      minutesOfDay: minutes,
      timezone: SEOUL,
      asOfIso,
      krxOfficialCloseConfirmed: false,
      orderable: false,
      labelKo: "휴장 · 세션 없음",
      nextSession: null,
      nextSessionStartMinutes: null,
    };
  }

  const active: MarketSession[] = [];

  if (inRange(minutes, hm(8, 0), hm(8, 50))) active.push("NXT_PRE");
  if (inRange(minutes, hm(9, 0), hm(15, 30))) active.push("KRX_REGULAR");

  const afterOpenAuction =
    minutes > hm(9, 0) || (minutes === hm(9, 0) && seconds >= 30);
  if (afterOpenAuction && inRange(minutes, hm(9, 0), hm(15, 20))) {
    active.push("NXT_MAIN");
  }

  if (inRange(minutes, hm(15, 20), hm(15, 30))) active.push("KRX_CLOSING_AUCTION");
  if (inRange(minutes, hm(15, 30), hm(20, 0))) active.push("NXT_AFTER");

  if (active.length === 0) active.push("CLOSED");

  const primary: MarketSession =
    active.find((s) => s === "NXT_MAIN") ??
    active.find((s) => s === "KRX_REGULAR") ??
    active.find((s) => s === "NXT_PRE") ??
    active.find((s) => s === "KRX_CLOSING_AUCTION") ??
    active.find((s) => s === "NXT_AFTER") ??
    "CLOSED";

  const krxOfficialCloseConfirmed = minutes >= hm(15, 30);
  const orderable = primary !== "CLOSED";

  const labels: Record<MarketSession, string> = {
    NXT_PRE: "NXT 프리마켓 (08:00–08:50)",
    KRX_REGULAR: "KRX 정규장 (09:00–15:30)",
    NXT_MAIN: "NXT 메인마켓 (09:00:30–15:20)",
    KRX_CLOSING_AUCTION: "KRX 종가단일가 (15:20–15:30)",
    NXT_AFTER: "NXT 애프터마켓 (15:30–20:00)",
    CLOSED: "장 마감",
  };

  const schedule: Array<{ session: MarketSession; start: number }> = [
    { session: "NXT_PRE", start: hm(8, 0) },
    { session: "KRX_REGULAR", start: hm(9, 0) },
    { session: "NXT_MAIN", start: hm(9, 0) },
    { session: "KRX_CLOSING_AUCTION", start: hm(15, 20) },
    { session: "NXT_AFTER", start: hm(15, 30) },
  ];
  const next = schedule.find((s) => s.start > minutes) ?? null;

  return {
    session: primary,
    activeSessions: active,
    minutesOfDay: minutes,
    timezone: SEOUL,
    asOfIso,
    krxOfficialCloseConfirmed,
    orderable,
    labelKo: labels[primary],
    nextSession: next?.session ?? null,
    nextSessionStartMinutes: next?.start ?? null,
  };
}

/** @deprecated 기존 after_close 15:40–18:00 대체 — NXT_AFTER 사용 */
export function isAfterCloseSessionOpen(date: Date = new Date()): boolean {
  return detectMarketSessions(date).activeSessions.includes("NXT_AFTER");
}

export function isRegularSessionOpen(date: Date = new Date()): boolean {
  return detectMarketSessions(date).activeSessions.includes("KRX_REGULAR");
}

export function sessionLabel(date: Date = new Date()): MarketSession {
  return detectMarketSessions(date).session;
}
