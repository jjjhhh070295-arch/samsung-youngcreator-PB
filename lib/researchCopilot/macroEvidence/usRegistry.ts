import type {
  MacroProviderId,
  MacroRightsStatus,
  MacroSectionId,
  SourceAvailability,
} from "./types";

export type UsMacroSeriesId =
  | "ust-cmt-2y"
  | "ust-cmt-5y"
  | "ust-cmt-10y"
  | "ust-cmt-30y"
  | "nyfed-effr"
  | "nyfed-target-lower"
  | "nyfed-target-upper";

export interface UsMacroSeriesDefinition {
  seriesId: UsMacroSeriesId;
  providerId: Extract<MacroProviderId, "us-treasury" | "ny-fed">;
  sectionId: Extract<MacroSectionId, "us-rates">;
  title: string;
  sourceField: string;
  frequency: "D";
  unit: "Percent";
  definitionVersion: string;
  sourceUrl: string;
  dataUrlTemplate: string;
  staleAfterDays: number;
  rightsStatus: MacroRightsStatus;
  releaseDate: SourceAvailability;
  vintageDate: SourceAvailability;
  preliminaryFinal: SourceAvailability;
  revisionStatus: SourceAvailability | "provided_when_flagged";
}

export const TREASURY_SOURCE_PAGE =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve";

export const TREASURY_FEED_TEMPLATE =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value={YEAR}";

export const NY_FED_EFFR_PAGE = "https://www.newyorkfed.org/markets/reference-rates/effr";
export const NY_FED_LATEST_RATES_URL = "https://markets.newyorkfed.org/api/rates/all/latest.json";
export const NY_FED_TERMS_URL = "https://www.newyorkfed.org/privacy/termsofuse";

const SOURCE_NOT_PROVIDED: SourceAvailability = "source_not_provided";

function treasuryDefinition(
  input: Pick<UsMacroSeriesDefinition, "seriesId" | "title" | "sourceField" | "definitionVersion">,
): UsMacroSeriesDefinition {
  return Object.freeze({
    ...input,
    providerId: "us-treasury",
    sectionId: "us-rates",
    frequency: "D",
    unit: "Percent",
    sourceUrl: TREASURY_SOURCE_PAGE,
    dataUrlTemplate: TREASURY_FEED_TEMPLATE,
    staleAfterDays: 4,
    rightsStatus: "pb-internal-use-approved",
    releaseDate: SOURCE_NOT_PROVIDED,
    vintageDate: SOURCE_NOT_PROVIDED,
    preliminaryFinal: SOURCE_NOT_PROVIDED,
    revisionStatus: SOURCE_NOT_PROVIDED,
  });
}

function nyFedDefinition(
  input: Pick<UsMacroSeriesDefinition, "seriesId" | "title" | "sourceField" | "definitionVersion">,
): UsMacroSeriesDefinition {
  return Object.freeze({
    ...input,
    providerId: "ny-fed",
    sectionId: "us-rates",
    frequency: "D",
    unit: "Percent",
    sourceUrl: NY_FED_EFFR_PAGE,
    dataUrlTemplate: NY_FED_LATEST_RATES_URL,
    staleAfterDays: 4,
    rightsStatus: "official-source-rights-review-required",
    releaseDate: SOURCE_NOT_PROVIDED,
    vintageDate: SOURCE_NOT_PROVIDED,
    preliminaryFinal: SOURCE_NOT_PROVIDED,
    revisionStatus: "provided_when_flagged",
  });
}

export const US_MACRO_ALLOWLIST: Readonly<Record<UsMacroSeriesId, UsMacroSeriesDefinition>> = Object.freeze({
  "ust-cmt-2y": treasuryDefinition({
    seriesId: "ust-cmt-2y",
    title: "U.S. Treasury Constant Maturity 2-Year",
    sourceField: "BC_2YEAR",
    definitionVersion: "treasury-daily-par-yield-2y-v1",
  }),
  "ust-cmt-5y": treasuryDefinition({
    seriesId: "ust-cmt-5y",
    title: "U.S. Treasury Constant Maturity 5-Year",
    sourceField: "BC_5YEAR",
    definitionVersion: "treasury-daily-par-yield-5y-v1",
  }),
  "ust-cmt-10y": treasuryDefinition({
    seriesId: "ust-cmt-10y",
    title: "U.S. Treasury Constant Maturity 10-Year",
    sourceField: "BC_10YEAR",
    definitionVersion: "treasury-daily-par-yield-10y-v1",
  }),
  "ust-cmt-30y": treasuryDefinition({
    seriesId: "ust-cmt-30y",
    title: "U.S. Treasury Constant Maturity 30-Year",
    sourceField: "BC_30YEAR",
    definitionVersion: "treasury-daily-par-yield-30y-v1",
  }),
  "nyfed-effr": nyFedDefinition({
    seriesId: "nyfed-effr",
    title: "Effective Federal Funds Rate",
    sourceField: "percentRate",
    definitionVersion: "ny-fed-effr-v1",
  }),
  "nyfed-target-lower": nyFedDefinition({
    seriesId: "nyfed-target-lower",
    title: "Federal Funds Target Range Lower Bound",
    sourceField: "targetRateFrom",
    definitionVersion: "ny-fed-target-range-lower-v1",
  }),
  "nyfed-target-upper": nyFedDefinition({
    seriesId: "nyfed-target-upper",
    title: "Federal Funds Target Range Upper Bound",
    sourceField: "targetRateTo",
    definitionVersion: "ny-fed-target-range-upper-v1",
  }),
});

export const TREASURY_SERIES_IDS = Object.freeze([
  "ust-cmt-2y",
  "ust-cmt-5y",
  "ust-cmt-10y",
  "ust-cmt-30y",
] as const satisfies readonly UsMacroSeriesId[]);

export const NY_FED_SERIES_IDS = Object.freeze([
  "nyfed-effr",
  "nyfed-target-lower",
  "nyfed-target-upper",
] as const satisfies readonly UsMacroSeriesId[]);

export function getUsMacroDefinition(seriesId: UsMacroSeriesId): UsMacroSeriesDefinition {
  return US_MACRO_ALLOWLIST[seriesId];
}

export function buildTreasuryFeedUrl(year: number): string {
  if (!Number.isInteger(year) || year < 1990 || year > 2200) {
    throw new Error("Treasury feed year is invalid.");
  }
  return TREASURY_FEED_TEMPLATE.replace("{YEAR}", String(year));
}

export function validateUsObservationFreshness(
  observationDate: string,
  now: Date,
  staleAfterDays: number,
): "ready" | "invalid" | "future" | "stale" {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)
    || !Number.isFinite(now.getTime())
    || !Number.isInteger(staleAfterDays)
    || staleAfterDays < 0) {
    return "invalid";
  }
  const startMs = Date.parse(`${observationDate}T00:00:00.000Z`);
  const endMs = Date.parse(`${observationDate}T23:59:59.999Z`);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0, 10) !== observationDate) {
    return "invalid";
  }
  if (startMs > now.getTime()) return "future";
  if (now.getTime() - endMs > staleAfterDays * 24 * 60 * 60 * 1_000) return "stale";
  return "ready";
}

type OfficialUsProvider = "us-treasury" | "ny-fed";

function newYorkClock(now: Date): { date: string; hour: number; weekday: number } | null {
  if (!Number.isFinite(now.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !(parts.weekday in weekdays)) return null;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: weekdays[parts.weekday],
  };
}

function previousWeekday(date: string): string {
  const cursor = new Date(`${date}T00:00:00.000Z`);
  do cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor.toISOString().slice(0, 10);
}

function currentOrPreviousWeekday(date: string, weekday: number): string {
  return weekday === 0 || weekday === 6 ? previousWeekday(date) : date;
}

/**
 * 공급자 공표시각과 주중 영업일을 기준으로 반드시 도달해야 할 최신 관측일입니다.
 * 공식 휴일 달력을 확인할 수 없는 휴일에는 더 최신 값을 요구해 표시가 차단되는
 * 방향으로만 오차가 나도록 설계합니다.
 */
export function expectedOfficialUsObservationDate(
  providerId: OfficialUsProvider,
  now: Date,
): string | null {
  const clock = newYorkClock(now);
  if (!clock) return null;
  if (providerId === "us-treasury") {
    if (clock.weekday === 0 || clock.weekday === 6) return currentOrPreviousWeekday(clock.date, clock.weekday);
    return clock.hour >= 18 ? clock.date : previousWeekday(clock.date);
  }
  const publicationDate = clock.weekday === 0 || clock.weekday === 6
    ? currentOrPreviousWeekday(clock.date, clock.weekday)
    : clock.hour >= 9
      ? clock.date
      : previousWeekday(clock.date);
  return previousWeekday(publicationDate);
}

export function validateOfficialUsObservationDate(
  providerId: OfficialUsProvider,
  observationDate: string,
  now: Date,
): "ready" | "invalid" | "future" | "stale" {
  const expected = expectedOfficialUsObservationDate(providerId, now);
  if (!expected || !/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) return "invalid";
  const parsed = new Date(`${observationDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== observationDate) return "invalid";
  if (observationDate > expected) return "future";
  if (observationDate < expected) return "stale";
  return "ready";
}
