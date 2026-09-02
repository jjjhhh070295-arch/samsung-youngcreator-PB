import { KOREA_MACRO_ALLOWLIST } from "./koreaRegistry";
import { RIGHTS_REVIEW_REGISTRY } from "./sourceRegistry";
import { US_MACRO_ALLOWLIST } from "./usRegistry";
import {
  type MacroTrendBlockCode,
  type MacroTrendBlocked,
  type MacroTrendObservation,
  type MacroTrendPreparationResult,
  type MacroTrendRange,
  type MacroTrendReady,
  type MacroTrendResponse,
} from "./historyTypes";
import {
  collectMacroTrendCalendarGaps,
  computeMacroTrendWindow,
  filterMacroTrendObservationsByRange,
  isMacroTrendRange,
  isValidMacroTrendIsoDate,
  macroTrendCoverage,
  macroTrendDisplayMode,
} from "./historyRange";

const MAX_DISPLAY_POINTS = 480;
const DERIVED_TREND_SERIES_IDS = new Set([
  "corp-aa-minus-3y-spread",
  "corp-bbb-minus-3y-spread",
  "real-gdp-sa-qoq",
  "real-gdp-sa-yoy",
  "cpi-headline-yoy",
  "cpi-core-food-energy-excluded-yoy",
]);
const BLOCK_CODES = new Set<MacroTrendBlockCode>([
  "KEY_MISSING",
  "SERIES_NOT_ALLOWED",
  "UPSTREAM_UNAVAILABLE",
  "RESPONSE_INVALID",
  "RESPONSE_TOO_LARGE",
  "METADATA_MISMATCH",
  "DATA_MISSING",
  "DATA_CONFLICT",
  "UNIT_MISMATCH",
  "STALE",
  "RIGHTS_BLOCKED",
  "RAW_CONFLICT",
  "DATA_RIGHTS_REVIEW_REQUIRED",
  "INVALID_RANGE",
  "CLIENT_FORBIDDEN",
  "DEFINITION_MISMATCH",
  "DATE_MISMATCH",
]);
const RIGHTS_STATUSES = new Set([
  "pb-internal-use-approved",
  "official-source-rights-review-required",
  "licensed-data-required",
]);
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "rawBase64",
  "apiKey",
  "authorization",
  "cookie",
  "secret",
]);

type NormalizationResult =
  | { ok: true; observations: MacroTrendObservation[]; originalObservationCount: number }
  | {
      ok: false;
      code: "DATA_MISSING" | "DATA_CONFLICT" | "RESPONSE_INVALID";
      message: string;
      originalObservationCount: number;
    };

export interface PrepareMacroTrendObservationsInput {
  observations: readonly MacroTrendObservation[];
  range: MacroTrendRange;
  frequency: "D" | "M" | "Q";
  maxPoints?: number;
}

export interface MacroTrendResponseExpectation {
  pbId?: string;
  clientId?: string;
  seriesId?: string;
  range?: MacroTrendRange;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function strictNumericRaw(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)
    && Number.isFinite(Number(value));
}

export function macroTrendNumericValue(valueRaw: string): number | null {
  const normalized = valueRaw.trim();
  if (!normalized || !strictNumericRaw(normalized)) return null;
  return Number(normalized);
}

export function isMacroTrendSeriesId(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  return Object.prototype.hasOwnProperty.call(KOREA_MACRO_ALLOWLIST, value)
    || Object.prototype.hasOwnProperty.call(US_MACRO_ALLOWLIST, value)
    || DERIVED_TREND_SERIES_IDS.has(value)
    || RIGHTS_REVIEW_REGISTRY.some((entry) => entry.seriesId === value);
}

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeObservation(observation: MacroTrendObservation): MacroTrendObservation {
  return {
    observationDate: observation.observationDate.trim(),
    observationDateRaw: observation.observationDateRaw.trim(),
    valueRaw: observation.valueRaw.trim(),
    releaseDate: normalizeOptionalText(observation.releaseDate),
    vintageDate: normalizeOptionalText(observation.vintageDate),
    preliminaryFinal: normalizeOptionalText(observation.preliminaryFinal),
    revisionStatus: normalizeOptionalText(observation.revisionStatus),
    availability: {
      releaseDate: observation.availability.releaseDate,
      vintageDate: observation.availability.vintageDate,
      preliminaryFinal: observation.availability.preliminaryFinal,
      revisionStatus: observation.availability.revisionStatus,
    },
  };
}

function observationFingerprint(observation: MacroTrendObservation): string {
  return JSON.stringify([
    observation.observationDate,
    observation.observationDateRaw,
    observation.valueRaw,
    observation.releaseDate,
    observation.vintageDate,
    observation.preliminaryFinal,
    observation.revisionStatus,
    observation.availability.releaseDate,
    observation.availability.vintageDate,
    observation.availability.preliminaryFinal,
    observation.availability.revisionStatus,
  ]);
}

function validAvailability(value: unknown): boolean {
  return value === "provided" || value === "source_not_provided";
}

function availabilityMatchesValue(
  value: string | null,
  availability: unknown,
): boolean {
  return value === null
    ? availability === "source_not_provided"
    : availability === "provided";
}

function validObservationMetadata(observation: MacroTrendObservation): boolean {
  return isValidMacroTrendIsoDate(observation.observationDate)
    && nonEmpty(observation.observationDateRaw)
    && (observation.releaseDate === null || isValidMacroTrendIsoDate(observation.releaseDate))
    && (observation.vintageDate === null || isValidMacroTrendIsoDate(observation.vintageDate))
    && validAvailability(observation.availability.releaseDate)
    && validAvailability(observation.availability.vintageDate)
    && validAvailability(observation.availability.preliminaryFinal)
    && validAvailability(observation.availability.revisionStatus)
    && availabilityMatchesValue(observation.releaseDate, observation.availability.releaseDate)
    && availabilityMatchesValue(observation.vintageDate, observation.availability.vintageDate)
    && availabilityMatchesValue(observation.preliminaryFinal, observation.availability.preliminaryFinal)
    && availabilityMatchesValue(observation.revisionStatus, observation.availability.revisionStatus);
}

export function normalizeMacroTrendObservations(
  source: readonly MacroTrendObservation[],
): NormalizationResult {
  const originalObservationCount = source.length;
  if (source.length === 0) {
    return {
      ok: false,
      code: "DATA_MISSING",
      message: "선택한 계열에 관측치가 없어 추이를 표시할 수 없습니다.",
      originalObservationCount,
    };
  }

  const normalized = source.map(normalizeObservation);
  for (const observation of normalized) {
    if (!validObservationMetadata(observation)) {
      return {
        ok: false,
        code: "RESPONSE_INVALID",
        message: "관측일 또는 관측치 메타데이터 형식이 올바르지 않습니다.",
        originalObservationCount,
      };
    }
    if (observation.valueRaw && !strictNumericRaw(observation.valueRaw)) {
      return {
        ok: false,
        code: "RESPONSE_INVALID",
        message: "숫자가 아닌 원문 관측값은 보정하지 않고 차단합니다.",
        originalObservationCount,
      };
    }
  }

  const byDate = new Map<string, { fingerprint: string; observation: MacroTrendObservation }>();
  for (const observation of normalized) {
    const fingerprint = observationFingerprint(observation);
    const previous = byDate.get(observation.observationDate);
    if (!previous) {
      byDate.set(observation.observationDate, { fingerprint, observation });
      continue;
    }
    if (previous.fingerprint !== fingerprint) {
      return {
        ok: false,
        code: "DATA_CONFLICT",
        message: `동일 관측일(${observation.observationDate})에 서로 다른 원본 값 또는 메타데이터가 있습니다.`,
        originalObservationCount,
      };
    }
  }

  return {
    ok: true,
    observations: Array.from(byDate.values())
      .map(({ observation }) => observation)
      .sort((left, right) => left.observationDate.localeCompare(right.observationDate)),
    originalObservationCount,
  };
}

function selectedIndicesForBucket(
  observations: readonly MacroTrendObservation[],
  start: number,
  end: number,
): number[] {
  let minIndex = -1;
  let maxIndex = -1;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (let index = start; index < end; index += 1) {
    const value = macroTrendNumericValue(observations[index].valueRaw);
    if (value === null) continue;
    if (value < minValue) {
      minValue = value;
      minIndex = index;
    }
    if (value > maxValue) {
      maxValue = value;
      maxIndex = index;
    }
  }
  if (minIndex < 0) return [];
  return minIndex === maxIndex
    ? [minIndex]
    : [minIndex, maxIndex].sort((left, right) => left - right);
}

export class MacroTrendDownsampleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroTrendDownsampleError";
  }
}

function requiredDownsampleIndices(
  observations: readonly MacroTrendObservation[],
): Set<number> {
  const required = new Set<number>([0, observations.length - 1]);
  let globalMinIndex = -1;
  let globalMaxIndex = -1;
  let globalMin = Number.POSITIVE_INFINITY;
  let globalMax = Number.NEGATIVE_INFINITY;
  let previousWasMissing = false;
  for (let index = 0; index < observations.length; index += 1) {
    const value = macroTrendNumericValue(observations[index].valueRaw);
    const isMissing = value === null;
    if (isMissing && !previousWasMissing) required.add(index);
    previousWasMissing = isMissing;
    if (value === null) continue;
    if (value < globalMin) {
      globalMin = value;
      globalMinIndex = index;
    }
    if (value > globalMax) {
      globalMax = value;
      globalMaxIndex = index;
    }
  }
  if (globalMinIndex >= 0) required.add(globalMinIndex);
  if (globalMaxIndex >= 0) required.add(globalMaxIndex);
  return required;
}

/**
 * 첫값·끝값 및 각 연속 버킷의 최소·최대를 고릅니다. 합성값이나 평균값은 만들지 않습니다.
 */
export function downsampleMacroTrendObservations(
  observations: readonly MacroTrendObservation[],
  maxPoints = MAX_DISPLAY_POINTS,
): MacroTrendObservation[] {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 4 || maxPoints > MAX_DISPLAY_POINTS) {
    throw new RangeError(`maxPoints must be an integer between 4 and ${MAX_DISPLAY_POINTS}`);
  }
  if (observations.length <= maxPoints) return [...observations];

  const selected = requiredDownsampleIndices(observations);
  if (selected.size > maxPoints) {
    throw new MacroTrendDownsampleError(
      "결측 구간 경계와 첫값·끝값·전역 최소·최대를 480점 안에 모두 보존할 수 없습니다.",
    );
  }
  const remainingCapacity = maxPoints - selected.size;
  const interiorStart = 1;
  const interiorCount = observations.length - 2;
  const bucketCount = Math.min(Math.floor(remainingCapacity / 2), interiorCount);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = interiorStart + Math.floor((bucket * interiorCount) / bucketCount);
    const end = interiorStart + Math.floor(((bucket + 1) * interiorCount) / bucketCount);
    for (const index of selectedIndicesForBucket(observations, start, Math.max(start + 1, end))) {
      selected.add(index);
    }
  }
  return Array.from(selected)
    .sort((left, right) => left - right)
    .slice(0, maxPoints)
    .map((index) => observations[index]);
}

export function prepareMacroTrendObservations(
  input: PrepareMacroTrendObservationsInput,
): MacroTrendPreparationResult {
  const normalized = normalizeMacroTrendObservations(input.observations);
  if (!normalized.ok) {
    return {
      status: "blocked",
      range: input.range,
      code: normalized.code,
      message: normalized.message,
      originalObservationCount: normalized.originalObservationCount,
    };
  }

  const anchorObservationDate = normalized.observations.at(-1)?.observationDate;
  if (!anchorObservationDate) {
    return {
      status: "blocked",
      range: input.range,
      code: "DATA_MISSING",
      message: "최신 관측일을 확인할 수 없습니다.",
      originalObservationCount: normalized.originalObservationCount,
    };
  }
  const window = computeMacroTrendWindow(input.range, anchorObservationDate);
  const inRange = filterMacroTrendObservationsByRange(
    normalized.observations,
    window.startDate,
    window.endDate,
  );
  const validObservationCount = inRange.reduce(
    (count, observation) => count + (macroTrendNumericValue(observation.valueRaw) === null ? 0 : 1),
    0,
  );
  const missingObservationCount = inRange.length - validObservationCount;
  if (validObservationCount === 0) {
    return {
      status: "blocked",
      range: input.range,
      code: "DATA_MISSING",
      message: "선택 기간에 숫자로 확인 가능한 관측치가 없습니다.",
      originalObservationCount: normalized.originalObservationCount,
    };
  }
  const coverage = macroTrendCoverage(inRange);
  if (!coverage) {
    return {
      status: "blocked",
      range: input.range,
      code: "DATA_MISSING",
      message: "선택 기간의 실제 관측 범위를 확인할 수 없습니다.",
      originalObservationCount: normalized.originalObservationCount,
    };
  }
  let observations: MacroTrendObservation[];
  try {
    observations = downsampleMacroTrendObservations(inRange, input.maxPoints ?? MAX_DISPLAY_POINTS);
  } catch (error) {
    if (!(error instanceof MacroTrendDownsampleError)) throw error;
    return {
      status: "blocked",
      range: input.range,
      code: "RESPONSE_TOO_LARGE",
      message: error.message,
      originalObservationCount: normalized.originalObservationCount,
    };
  }
  return {
    status: "ready",
    range: input.range,
    anchorObservationDate,
    requestedStartDate: window.startDate,
    requestedEndDate: window.endDate,
    normalizedObservations: normalized.observations,
    inRangeObservations: inRange,
    observations,
    originalObservationCount: normalized.originalObservationCount,
    normalizedObservationCount: normalized.observations.length,
    inRangeObservationCount: inRange.length,
    validObservationCount,
    missingObservationCount,
    returnedObservationCount: observations.length,
    displayMode: macroTrendDisplayMode(validObservationCount),
    actualCoverage: coverage,
    gaps: collectMacroTrendCalendarGaps(inRange, input.frequency),
  };
}

function hasForbiddenPublicKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenPublicKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_PUBLIC_KEYS.has(key) || hasForbiddenPublicKey(child)
  );
}

function isAvailability(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ["releaseDate", "vintageDate", "preliminaryFinal", "revisionStatus"]
    .every((field) => value[field] === "provided" || value[field] === "source_not_provided");
}

function isPublicObservation(value: unknown): value is MacroTrendObservation {
  if (!isRecord(value)) return false;
  if (!isValidMacroTrendIsoDate(value.observationDate) || !nonEmpty(value.observationDateRaw)) return false;
  if (typeof value.valueRaw !== "string") return false;
  if (value.valueRaw.trim() && !strictNumericRaw(value.valueRaw.trim())) return false;
  if (!isAvailability(value.availability)) return false;
  const availability = value.availability as Record<string, unknown>;
  return (value.releaseDate === null || isValidMacroTrendIsoDate(value.releaseDate))
    && (value.vintageDate === null || isValidMacroTrendIsoDate(value.vintageDate))
    && (value.preliminaryFinal === null || nonEmpty(value.preliminaryFinal))
    && (value.revisionStatus === null || nonEmpty(value.revisionStatus))
    && availabilityMatchesValue(value.releaseDate as string | null, availability.releaseDate)
    && availabilityMatchesValue(value.vintageDate as string | null, availability.vintageDate)
    && availabilityMatchesValue(value.preliminaryFinal as string | null, availability.preliminaryFinal)
    && availabilityMatchesValue(value.revisionStatus as string | null, availability.revisionStatus);
}

function isPublicCapture(value: unknown): boolean {
  if (!isRecord(value) || "rawBase64" in value || !isRecord(value.sanitizedRequest)) return false;
  const request = value.sanitizedRequest;
  return nonEmpty(value.captureId)
    && ["ecos", "us-treasury", "ny-fed"].includes(String(value.providerId))
    && typeof value.contentHash === "string"
    && /^[a-f\d]{64}$/i.test(value.contentHash)
    && Number.isSafeInteger(value.bodyByteLength)
    && Number(value.bodyByteLength) >= 0
    && validIsoTimestamp(value.retrievedAt)
    && Number.isSafeInteger(value.responseStatus)
    && nonEmpty(value.contentType)
    && ["ecos", "us-treasury", "ny-fed"].includes(String(request.providerId))
    && nonEmpty(request.operation)
    && Array.isArray(request.seriesIds)
    && request.seriesIds.every(nonEmpty);
}

function exactConsumerPolicy(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.pbInternalResearchDisplay === true
    && value.portfolio === false
    && value.productRecommendation === false
    && value.customerOutput === false
    && value.aiNumericGeneration === false;
}

function isPublicBlocked(value: unknown): value is MacroTrendBlocked {
  if (!isRecord(value)) return false;
  return value.status === "blocked"
    && nonEmpty(value.seriesId)
    && nonEmpty(value.title)
    && ["korea-macro", "us-rates", "credit-volatility"].includes(String(value.sectionId))
    && isMacroTrendRange(value.range)
    && BLOCK_CODES.has(value.code as MacroTrendBlockCode)
    && nonEmpty(value.message)
    && nonEmpty(value.sourceUrl)
    && RIGHTS_STATUSES.has(String(value.rightsStatus))
    && !("observations" in value);
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPublicReady(value: unknown): value is MacroTrendReady {
  if (!isRecord(value) || value.status !== "ready") return false;
  if (!nonEmpty(value.seriesId)
    || !nonEmpty(value.title)
    || !["korea-macro", "us-rates", "credit-volatility"].includes(String(value.sectionId))
    || !["ecos", "us-treasury", "ny-fed"].includes(String(value.providerId))
    || !nonEmpty(value.provider)
    || !["D", "M", "Q"].includes(String(value.frequency))
    || !nonEmpty(value.unit)
    || !nonEmpty(value.definitionVersion)
    || !isMacroTrendRange(value.range)
    || !isValidMacroTrendIsoDate(value.anchorObservationDate)
    || !isValidMacroTrendIsoDate(value.requestedStartDate)
    || !isValidMacroTrendIsoDate(value.requestedEndDate)) return false;

  const range = value.range as MacroTrendRange;
  const anchorObservationDate = value.anchorObservationDate as string;
  const requestedStartDate = value.requestedStartDate as string;
  const requestedEndDate = value.requestedEndDate as string;
  const expectedWindow = computeMacroTrendWindow(range, anchorObservationDate);
  if (expectedWindow.startDate !== requestedStartDate
    || expectedWindow.endDate !== requestedEndDate) return false;
  if (!Array.isArray(value.observations)
    || value.observations.length === 0
    || value.observations.length > MAX_DISPLAY_POINTS
    || !value.observations.every(isPublicObservation)) return false;
  const observations = value.observations as MacroTrendObservation[];
  if (observations.some((observation, index) =>
    observation.observationDate < requestedStartDate
    || observation.observationDate > requestedEndDate
    || (index > 0 && observation.observationDate <= observations[index - 1].observationDate)
  )) return false;

  const countFields = [
    value.originalObservationCount,
    value.normalizedObservationCount,
    value.inRangeObservationCount,
    value.validObservationCount,
    value.missingObservationCount,
    value.returnedObservationCount,
  ];
  if (!countFields.every(isCount)) return false;
  const [
    originalObservationCount,
    normalizedObservationCount,
    inRangeObservationCount,
    validObservationCount,
    missingObservationCount,
    returnedObservationCount,
  ] = countFields as number[];
  if (originalObservationCount < normalizedObservationCount
    || normalizedObservationCount < inRangeObservationCount
    || inRangeObservationCount !== validObservationCount + missingObservationCount
    || returnedObservationCount !== observations.length
    || returnedObservationCount > inRangeObservationCount
    || validObservationCount < 1
    || value.displayMode !== macroTrendDisplayMode(validObservationCount)) return false;

  if (!isRecord(value.actualCoverage)
    || !isValidMacroTrendIsoDate(value.actualCoverage.startDate)
    || !isValidMacroTrendIsoDate(value.actualCoverage.endDate)
    || !isCount(value.actualCoverage.calendarDaySpan)
    || value.actualCoverage.startDate !== observations[0].observationDate
    || value.actualCoverage.endDate !== observations.at(-1)?.observationDate) return false;
  const expectedSpan = Math.round(
    (Date.parse(`${value.actualCoverage.endDate}T00:00:00.000Z`)
      - Date.parse(`${value.actualCoverage.startDate}T00:00:00.000Z`)) / 86_400_000,
  );
  if (value.actualCoverage.calendarDaySpan !== expectedSpan) return false;

  if (!Array.isArray(value.gaps) || !value.gaps.every((gap) =>
    isRecord(gap)
    && isValidMacroTrendIsoDate(gap.afterObservationDate)
    && isValidMacroTrendIsoDate(gap.beforeObservationDate)
    && gap.afterObservationDate < gap.beforeObservationDate
    && Number.isSafeInteger(gap.calendarDaysBetween)
    && Number(gap.calendarDaysBetween) > 1
  )) return false;
  if (!nonEmpty(value.sourceUrl)
    || !validIsoTimestamp(value.retrievedAt)
    || typeof value.datasetContentHash !== "string"
    || !/^[a-f\d]{64}$/i.test(value.datasetContentHash)
    || value.rightsStatus !== "pb-internal-use-approved"
    || value.isEducationalFixture !== false
    || !Array.isArray(value.captures)
    || !value.captures.every(isPublicCapture)) return false;
  return true;
}

export function isMacroTrendResponse(
  value: unknown,
  expected: MacroTrendResponseExpectation = {},
): value is MacroTrendResponse {
  if (!isRecord(value) || hasForbiddenPublicKey(value)) return false;
  if (value.ok !== true
    || !nonEmpty(value.pbId)
    || !nonEmpty(value.clientId)
    || !isMacroTrendRange(value.range)
    || !exactConsumerPolicy(value.consumerPolicy)
    || (!isPublicReady(value.result) && !isPublicBlocked(value.result))) return false;
  const result = value.result as MacroTrendReady | MacroTrendBlocked;
  if (result.range !== value.range) return false;
  if (expected.pbId !== undefined && value.pbId !== expected.pbId) return false;
  if (expected.clientId !== undefined && value.clientId !== expected.clientId) return false;
  if (expected.seriesId !== undefined && result.seriesId !== expected.seriesId) return false;
  if (expected.range !== undefined && value.range !== expected.range) return false;
  return true;
}
