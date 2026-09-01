import {
  MACRO_TREND_RANGES,
  type MacroTrendCalendarGap,
  type MacroTrendCoverage,
  type MacroTrendDisplayMode,
  type MacroTrendObservation,
  type MacroTrendRange,
} from "./historyTypes";

const DAY_MS = 86_400_000;

export function isValidMacroTrendIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function isMacroTrendRange(value: unknown): value is MacroTrendRange {
  return typeof value === "string"
    && (MACRO_TREND_RANGES as readonly string[]).includes(value);
}

function isoDate(year: number, month: number, day: number): string {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function subtractCalendarMonths(anchor: Date, months: number): string {
  const absoluteMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() - months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth - year * 12;
  return isoDate(year, month, anchor.getUTCDate());
}

function subtractCalendarYears(anchor: Date, years: number): string {
  return isoDate(anchor.getUTCFullYear() - years, anchor.getUTCMonth(), anchor.getUTCDate());
}

/**
 * 최신 관측일을 종료일로 고정하고 UTC 달력 기준으로 포함 구간을 계산합니다.
 * 예: 1M은 최신 관측일과 정확히 한 달 전 날짜를 모두 포함합니다.
 */
export function computeMacroTrendWindow(
  range: MacroTrendRange,
  anchorObservationDate: string,
): { startDate: string; endDate: string } {
  if (!isValidMacroTrendIsoDate(anchorObservationDate)) {
    throw new RangeError("anchorObservationDate must be a valid ISO calendar date");
  }
  const anchor = new Date(`${anchorObservationDate}T00:00:00.000Z`);
  let startDate: string;
  switch (range) {
    case "1D":
      startDate = new Date(anchor.getTime() - DAY_MS).toISOString().slice(0, 10);
      break;
    case "1W":
      startDate = new Date(anchor.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
      break;
    case "1M":
      startDate = subtractCalendarMonths(anchor, 1);
      break;
    case "3M":
      startDate = subtractCalendarMonths(anchor, 3);
      break;
    case "6M":
      startDate = subtractCalendarMonths(anchor, 6);
      break;
    case "1Y":
      startDate = subtractCalendarYears(anchor, 1);
      break;
    case "3Y":
      startDate = subtractCalendarYears(anchor, 3);
      break;
    case "5Y":
      startDate = subtractCalendarYears(anchor, 5);
      break;
    case "10Y":
      startDate = subtractCalendarYears(anchor, 10);
      break;
    case "20Y":
      startDate = subtractCalendarYears(anchor, 20);
      break;
    case "30Y":
      startDate = subtractCalendarYears(anchor, 30);
      break;
    default: {
      const exhaustive: never = range;
      throw new RangeError(`Unsupported macro trend range: ${String(exhaustive)}`);
    }
  }
  return { startDate, endDate: anchorObservationDate };
}

export function filterMacroTrendObservationsByRange(
  observations: readonly MacroTrendObservation[],
  startDate: string,
  endDate: string,
): MacroTrendObservation[] {
  if (!isValidMacroTrendIsoDate(startDate) || !isValidMacroTrendIsoDate(endDate) || startDate > endDate) {
    throw new RangeError("Macro trend range boundaries are invalid");
  }
  return observations.filter(({ observationDate }) =>
    observationDate >= startDate && observationDate <= endDate
  );
}

export function macroTrendDisplayMode(validObservationCount: number): MacroTrendDisplayMode {
  if (!Number.isSafeInteger(validObservationCount) || validObservationCount < 1) {
    throw new RangeError("At least one valid observation is required");
  }
  if (validObservationCount === 1) return "latest";
  if (validObservationCount <= 7) return "table";
  return "line";
}

export function macroTrendCoverage(
  observations: readonly MacroTrendObservation[],
): MacroTrendCoverage | null {
  if (observations.length === 0) return null;
  const startDate = observations[0].observationDate;
  const endDate = observations[observations.length - 1].observationDate;
  if (!isValidMacroTrendIsoDate(startDate) || !isValidMacroTrendIsoDate(endDate)) return null;
  return {
    startDate,
    endDate,
    calendarDaySpan: Math.round(
      (Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / DAY_MS,
    ),
  };
}

function periodIndex(date: string, frequency: "D" | "M" | "Q"): number {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (frequency === "D") return Math.floor(parsed.getTime() / DAY_MS);
  const monthIndex = parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
  return frequency === "M" ? monthIndex : Math.floor(monthIndex / 3);
}

/**
 * 원천 달력/거래일을 추정하지 않습니다. D는 달력일, M/Q는 월·분기 간격만 기록합니다.
 */
export function collectMacroTrendCalendarGaps(
  observations: readonly MacroTrendObservation[],
  frequency: "D" | "M" | "Q",
): MacroTrendCalendarGap[] {
  const gaps: MacroTrendCalendarGap[] = [];
  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1].observationDate;
    const current = observations[index].observationDate;
    const periodDistance = periodIndex(current, frequency) - periodIndex(previous, frequency);
    if (periodDistance <= 1) continue;
    gaps.push({
      afterObservationDate: previous,
      beforeObservationDate: current,
      calendarDaysBetween: Math.round(
        (Date.parse(`${current}T00:00:00.000Z`) - Date.parse(`${previous}T00:00:00.000Z`)) / DAY_MS,
      ),
    });
  }
  return gaps;
}
