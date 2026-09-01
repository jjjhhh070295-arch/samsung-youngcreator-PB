import {
  getKoreaMacroDefinition,
  type KoreaMacroSeriesDefinition,
  type KoreaMacroSeriesId,
} from "./koreaRegistry";
import type { MacroObservation, MacroSeriesEvidence } from "./types";

export type KoreaCalculationIssueCode =
  | "DATA_MISSING"
  | "STALE"
  | "UNIT_MISMATCH"
  | "DATE_MISMATCH"
  | "DEFINITION_MISMATCH"
  | "SERIES_MISMATCH"
  | "VALUE_INVALID";

export interface KoreaCalculationIssue {
  code: KoreaCalculationIssueCode;
  message: string;
}

export interface KoreaCreditSpreadResult {
  status: "ready";
  creditSeriesId: "corp-aa-minus-3y" | "corp-bbb-minus-3y";
  benchmarkSeriesId: "ktb-3y";
  observationDate: string;
  unit: "bp";
  basisPoints: number;
  formula: "(credit yield - KTB 3Y yield) * 100";
  revisionStatus: "source_not_provided";
}

export interface KoreaRealGdpGrowthResult {
  status: "ready";
  seriesId: "real-gdp-sa";
  currentPeriod: string;
  previousQuarterPeriod: string;
  previousYearPeriod: string;
  qoqPercent: number;
  yoyPercent: number;
  formula: "(current / comparison - 1) * 100";
  revisionStatus: "source_not_provided";
}

export interface KoreaCpiYearOverYearResult {
  status: "ready";
  seriesId: "cpi-headline" | "cpi-core-food-energy-excluded";
  currentPeriod: string;
  previousYearPeriod: string;
  yoyPercent: number;
  formula: "(current / previous-year - 1) * 100";
  revisionStatus: "source_not_provided";
}

export type KoreaCalculationResult<T> =
  | T
  | { status: "blocked"; issues: KoreaCalculationIssue[] };

function blocked<T>(code: KoreaCalculationIssueCode, message: string): KoreaCalculationResult<T> {
  return { status: "blocked", issues: [{ code, message }] };
}

function strictNumber(observation: MacroObservation): number | null {
  const raw = observation.valueRaw.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function isStale(
  observation: MacroObservation,
  definition: KoreaMacroSeriesDefinition,
  nowIso: string,
): boolean | null {
  const observationDate = isoDate(observation.observationDate);
  const now = new Date(nowIso);
  if (!observationDate || !Number.isFinite(now.getTime())) return null;
  if (observation.observationDate > now.toISOString().slice(0, 10)) return true;
  const ageDays = (now.getTime() - observationDate.getTime()) / 86_400_000;
  return Math.max(0, ageDays) > definition.staleAfterDays;
}

function recognizedEvidence(
  evidence: MacroSeriesEvidence,
): { seriesId: KoreaMacroSeriesId; definition: KoreaMacroSeriesDefinition } | null {
  if (!(evidence.seriesId in KOREA_SERIES_ID_SET)) return null;
  const seriesId = evidence.seriesId as KoreaMacroSeriesId;
  return { seriesId, definition: getKoreaMacroDefinition(seriesId) };
}

const KOREA_SERIES_ID_SET: Readonly<Record<KoreaMacroSeriesId, true>> = Object.freeze({
  "bok-policy-rate": true,
  "ktb-2y": true,
  "ktb-3y": true,
  "ktb-5y": true,
  "ktb-10y": true,
  "ktb-20y": true,
  "ktb-30y": true,
  "ktb-50y": true,
  "corp-aa-minus-3y": true,
  "corp-bbb-minus-3y": true,
  "real-gdp-sa": true,
  "cpi-headline": true,
  "cpi-core-food-energy-excluded": true,
  "usd-krw-close-1530": true,
});

function evidenceDefinitionMatches(
  evidence: MacroSeriesEvidence,
  definition: KoreaMacroSeriesDefinition,
): boolean {
  return evidence.providerId === "ecos"
    && evidence.frequency === definition.frequency
    && evidence.unit === definition.unit
    && evidence.definitionVersion === definition.definitionId;
}

/**
 * AA-/BBB- 3년 금리와 국고채 3년 금리의 동일 일자 스프레드만 계산한다.
 * 날짜·단위·공식 계열 정의 중 하나라도 다르면 숫자를 내지 않는다.
 */
export function calculateKoreaCreditSpread(
  credit: MacroSeriesEvidence,
  benchmark: MacroSeriesEvidence,
  nowIso: string,
): KoreaCalculationResult<KoreaCreditSpreadResult> {
  const creditEntry = recognizedEvidence(credit);
  const benchmarkEntry = recognizedEvidence(benchmark);
  if (!creditEntry || !benchmarkEntry
    || !["corp-aa-minus-3y", "corp-bbb-minus-3y"].includes(creditEntry.seriesId)
    || benchmarkEntry.seriesId !== "ktb-3y") {
    return blocked("SERIES_MISMATCH", "회사채 3년과 국고채 3년 공식 계열 조합만 계산할 수 있습니다.");
  }
  if (credit.unit !== benchmark.unit) {
    return blocked("UNIT_MISMATCH", "두 금리의 단위가 달라 스프레드를 계산할 수 없습니다.");
  }
  if (!evidenceDefinitionMatches(credit, creditEntry.definition)
    || !evidenceDefinitionMatches(benchmark, benchmarkEntry.definition)) {
    return blocked("DEFINITION_MISMATCH", "계열 정의·빈도 또는 공급자가 allowlist와 달라 계산을 차단했습니다.");
  }
  if (credit.latestObservation.observationDate !== benchmark.latestObservation.observationDate) {
    return blocked("DATE_MISMATCH", "동일 기준일 금리만 스프레드로 비교할 수 있습니다.");
  }
  if (creditEntry.definition.comparisonDefinition !== benchmarkEntry.definition.comparisonDefinition) {
    return blocked("DEFINITION_MISMATCH", "만기·산식 비교 정의가 일치하지 않습니다.");
  }
  const creditStale = isStale(credit.latestObservation, creditEntry.definition, nowIso);
  const benchmarkStale = isStale(benchmark.latestObservation, benchmarkEntry.definition, nowIso);
  if (creditStale === null || benchmarkStale === null) {
    return blocked("DATE_MISMATCH", "기준일 또는 현재 시각 형식을 확인할 수 없습니다.");
  }
  if (creditStale || benchmarkStale) {
    return blocked("STALE", "허용된 최신성 범위를 벗어나 스프레드 계산을 차단했습니다.");
  }
  const creditValue = strictNumber(credit.latestObservation);
  const benchmarkValue = strictNumber(benchmark.latestObservation);
  if (creditValue === null || benchmarkValue === null) {
    return blocked("DATA_MISSING", "금리 값이 없거나 숫자 원문이 유효하지 않습니다.");
  }
  return {
    status: "ready",
    creditSeriesId: creditEntry.seriesId as KoreaCreditSpreadResult["creditSeriesId"],
    benchmarkSeriesId: "ktb-3y",
    observationDate: credit.latestObservation.observationDate,
    unit: "bp",
    basisPoints: (creditValue - benchmarkValue) * 100,
    formula: "(credit yield - KTB 3Y yield) * 100",
    revisionStatus: "source_not_provided",
  };
}

type Quarter = { year: number; quarter: 1 | 2 | 3 | 4; key: string };

function quarterFromObservation(observation: MacroObservation): Quarter | null {
  const rawMatch = observation.observationDateRaw.trim().match(/^(\d{4})Q([1-4])$/i);
  if (rawMatch) {
    const year = Number(rawMatch[1]);
    const quarter = Number(rawMatch[2]) as Quarter["quarter"];
    return { year, quarter, key: `${year}Q${quarter}` };
  }
  const date = isoDate(observation.observationDate);
  if (!date) return null;
  const month = date.getUTCMonth() + 1;
  if (![3, 6, 9, 12].includes(month)) return null;
  const quarter = (month / 3) as Quarter["quarter"];
  const year = date.getUTCFullYear();
  return { year, quarter, key: `${year}Q${quarter}` };
}

function previousQuarter(input: Quarter): Quarter {
  return input.quarter === 1
    ? { year: input.year - 1, quarter: 4, key: `${input.year - 1}Q4` }
    : {
        year: input.year,
        quarter: (input.quarter - 1) as Quarter["quarter"],
        key: `${input.year}Q${input.quarter - 1}`,
      };
}

/** 실질 GDP 수준의 동일 계열·동일 단위 관측치로만 q/q와 y/y를 계산한다. */
export function calculateKoreaRealGdpGrowth(
  current: MacroSeriesEvidence,
  previousQuarterEvidence: MacroSeriesEvidence,
  previousYearEvidence: MacroSeriesEvidence,
  nowIso: string,
): KoreaCalculationResult<KoreaRealGdpGrowthResult> {
  const definition = getKoreaMacroDefinition("real-gdp-sa");
  const evidenceSet = [current, previousQuarterEvidence, previousYearEvidence];
  if (evidenceSet.some((evidence) => evidence.seriesId !== "real-gdp-sa")) {
    return blocked("SERIES_MISMATCH", "세 관측치는 모두 동일한 실질 GDP 계열이어야 합니다.");
  }
  if (new Set(evidenceSet.map((evidence) => evidence.unit)).size !== 1) {
    return blocked("UNIT_MISMATCH", "GDP 비교 관측치의 단위가 일치하지 않습니다.");
  }
  if (evidenceSet.some((evidence) => !evidenceDefinitionMatches(evidence, definition))) {
    return blocked("DEFINITION_MISMATCH", "GDP 계열 정의·빈도 또는 공급자가 allowlist와 다릅니다.");
  }
  const currentQuarter = quarterFromObservation(current.latestObservation);
  const priorQuarter = quarterFromObservation(previousQuarterEvidence.latestObservation);
  const yearAgoQuarter = quarterFromObservation(previousYearEvidence.latestObservation);
  if (!currentQuarter || !priorQuarter || !yearAgoQuarter) {
    return blocked("DATE_MISMATCH", "GDP 분기 표기를 확인할 수 없습니다.");
  }
  const expectedPrior = previousQuarter(currentQuarter);
  if (priorQuarter.key !== expectedPrior.key
    || yearAgoQuarter.year !== currentQuarter.year - 1
    || yearAgoQuarter.quarter !== currentQuarter.quarter) {
    return blocked("DATE_MISMATCH", "직전 분기와 전년 동분기 관측치가 정확히 일치하지 않습니다.");
  }
  const stale = isStale(current.latestObservation, definition, nowIso);
  if (stale === null) return blocked("DATE_MISMATCH", "현재 GDP 기준일 또는 현재 시각 형식을 확인할 수 없습니다.");
  if (stale) return blocked("STALE", "현재 GDP 관측치가 허용된 최신성 범위를 벗어났습니다.");

  const currentValue = strictNumber(current.latestObservation);
  const previousQuarterValue = strictNumber(previousQuarterEvidence.latestObservation);
  const previousYearValue = strictNumber(previousYearEvidence.latestObservation);
  if (currentValue === null || previousQuarterValue === null || previousYearValue === null
    || previousQuarterValue === 0 || previousYearValue === 0) {
    return blocked("DATA_MISSING", "GDP 값이 없거나 계산 가능한 숫자 원문이 아닙니다.");
  }
  return {
    status: "ready",
    seriesId: "real-gdp-sa",
    currentPeriod: currentQuarter.key,
    previousQuarterPeriod: priorQuarter.key,
    previousYearPeriod: yearAgoQuarter.key,
    qoqPercent: (currentValue / previousQuarterValue - 1) * 100,
    yoyPercent: (currentValue / previousYearValue - 1) * 100,
    formula: "(current / comparison - 1) * 100",
    revisionStatus: "source_not_provided",
  };
}

function monthFromObservation(observation: MacroObservation): { year: number; month: number; key: string } | null {
  const rawMatch = observation.observationDateRaw.trim().match(/^(\d{4})(\d{2})$/);
  if (rawMatch) {
    const year = Number(rawMatch[1]);
    const month = Number(rawMatch[2]);
    if (month >= 1 && month <= 12) return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
  }
  const date = isoDate(observation.observationDate);
  if (!date) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { year, month, key: `${year}-${String(month).padStart(2, "0")}` };
}

/** 동일 CPI 계열의 정확한 전년 동월 지수로만 y/y를 계산한다. */
export function calculateKoreaCpiYearOverYear(
  current: MacroSeriesEvidence,
  previousYearEvidence: MacroSeriesEvidence,
  nowIso: string,
): KoreaCalculationResult<KoreaCpiYearOverYearResult> {
  const allowed = ["cpi-headline", "cpi-core-food-energy-excluded"] as const;
  if (!allowed.includes(current.seriesId as (typeof allowed)[number])
    || previousYearEvidence.seriesId !== current.seriesId) {
    return blocked("SERIES_MISMATCH", "현재와 전년 관측치는 동일한 CPI 계열이어야 합니다.");
  }
  const seriesId = current.seriesId as KoreaCpiYearOverYearResult["seriesId"];
  const definition = getKoreaMacroDefinition(seriesId);
  if (current.unit !== previousYearEvidence.unit) {
    return blocked("UNIT_MISMATCH", "CPI 비교 관측치의 단위가 일치하지 않습니다.");
  }
  if (!evidenceDefinitionMatches(current, definition)
    || !evidenceDefinitionMatches(previousYearEvidence, definition)) {
    return blocked("DEFINITION_MISMATCH", "CPI 계열 정의·빈도 또는 공급자가 allowlist와 다릅니다.");
  }
  const currentMonth = monthFromObservation(current.latestObservation);
  const previousYearMonth = monthFromObservation(previousYearEvidence.latestObservation);
  if (!currentMonth || !previousYearMonth
    || previousYearMonth.year !== currentMonth.year - 1
    || previousYearMonth.month !== currentMonth.month) {
    return blocked("DATE_MISMATCH", "전년 동월 관측치가 정확히 일치하지 않습니다.");
  }
  const stale = isStale(current.latestObservation, definition, nowIso);
  if (stale === null) return blocked("DATE_MISMATCH", "현재 CPI 기준일 또는 현재 시각 형식을 확인할 수 없습니다.");
  if (stale) return blocked("STALE", "현재 CPI 관측치가 허용된 최신성 범위를 벗어났습니다.");
  const currentValue = strictNumber(current.latestObservation);
  const previousYearValue = strictNumber(previousYearEvidence.latestObservation);
  if (currentValue === null || previousYearValue === null || previousYearValue === 0) {
    return blocked("DATA_MISSING", "CPI 값이 없거나 계산 가능한 숫자 원문이 아닙니다.");
  }
  return {
    status: "ready",
    seriesId,
    currentPeriod: currentMonth.key,
    previousYearPeriod: previousYearMonth.key,
    yoyPercent: (currentValue / previousYearValue - 1) * 100,
    formula: "(current / previous-year - 1) * 100",
    revisionStatus: "source_not_provided",
  };
}
