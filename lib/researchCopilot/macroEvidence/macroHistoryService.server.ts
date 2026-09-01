import { createHash } from "node:crypto";
import { deriveMacroSpreadHistory } from "./derivedHistory";
import {
  fetchEcosHistory,
  type EcosHistoryConnectorOptions,
  type EcosHistoryConnectorResult,
} from "./ecosHistoryConnector.server";
import { computeMacroTrendWindow } from "./historyRange";
import type {
  MacroTrendBlocked,
  MacroTrendObservation,
  MacroTrendRange,
  MacroTrendReady,
  MacroTrendResult,
} from "./historyTypes";
import { macroTrendNumericValue, prepareMacroTrendObservations } from "./historyValidation";
import {
  KOREA_MACRO_ALLOWLIST,
  getKoreaMacroDefinition,
  type KoreaMacroFrequency,
  type KoreaMacroSeriesId,
} from "./koreaRegistry";
import {
  preserveRawMacroCapture,
  toPublicMacroCaptureManifest,
} from "./rawCapture.server";
import { RIGHTS_REVIEW_REGISTRY } from "./sourceRegistry";
import {
  fetchTreasuryHistory,
  type TreasuryHistoryConnectorOptions,
  type TreasuryHistoryConnectorResult,
} from "./treasuryHistoryConnector.server";
import type { MacroFailureCode, MacroSectionId, RawMacroCapture } from "./types";
import {
  getUsMacroDefinition,
  NY_FED_SERIES_IDS,
  TREASURY_SERIES_IDS,
  TREASURY_SOURCE_PAGE,
  validateOfficialUsObservationDate,
} from "./usRegistry";

type EcosFetcher = (options: EcosHistoryConnectorOptions) => Promise<EcosHistoryConnectorResult>;
type TreasuryFetcher = (options: TreasuryHistoryConnectorOptions) => Promise<TreasuryHistoryConnectorResult>;
type TreasurySeriesId = (typeof TREASURY_SERIES_IDS)[number];

export interface MacroHistoryServiceOptions {
  seriesId: string;
  range: MacroTrendRange;
  ecosCredential?: string;
  now?: () => Date;
  fetchEcos?: EcosFetcher;
  fetchTreasury?: TreasuryFetcher;
}

const DERIVED_SERIES = {
  "corp-aa-minus-3y-spread": {
    kind: "spread" as const,
    title: "회사채 AA- 3년 - 국고채 3년 스프레드",
    leftSeriesId: "corp-aa-minus-3y" as const,
    rightSeriesId: "ktb-3y" as const,
    unit: "bp",
    formula: "(credit yield - KTB 3Y yield) * 100",
  },
  "corp-bbb-minus-3y-spread": {
    kind: "spread" as const,
    title: "회사채 BBB- 3년 - 국고채 3년 스프레드",
    leftSeriesId: "corp-bbb-minus-3y" as const,
    rightSeriesId: "ktb-3y" as const,
    unit: "bp",
    formula: "(credit yield - KTB 3Y yield) * 100",
  },
  "real-gdp-sa-qoq": {
    kind: "change" as const,
    title: "실질 GDP 전분기 대비",
    sourceSeriesId: "real-gdp-sa" as const,
    lag: 1,
    unit: "%",
    formula: "(current / comparison - 1) * 100",
  },
  "real-gdp-sa-yoy": {
    kind: "change" as const,
    title: "실질 GDP 전년 동기 대비",
    sourceSeriesId: "real-gdp-sa" as const,
    lag: 4,
    unit: "%",
    formula: "(current / comparison - 1) * 100",
  },
  "cpi-headline-yoy": {
    kind: "change" as const,
    title: "소비자물가 전년 동월 대비",
    sourceSeriesId: "cpi-headline" as const,
    lag: 12,
    unit: "%",
    formula: "(current / previous-year - 1) * 100",
  },
  "cpi-core-food-energy-excluded-yoy": {
    kind: "change" as const,
    title: "근원 소비자물가 전년 동월 대비",
    sourceSeriesId: "cpi-core-food-energy-excluded" as const,
    lag: 12,
    unit: "%",
    formula: "(current / previous-year - 1) * 100",
  },
} as const;

type DerivedSeriesId = keyof typeof DERIVED_SERIES;

let ecosHistoryArchive: readonly RawMacroCapture[] = [];
let treasuryHistoryArchive: readonly RawMacroCapture[] = [];

export function mergeAppendOnlyMacroHistoryArchive(
  current: readonly RawMacroCapture[],
  incoming: readonly RawMacroCapture[],
): readonly RawMacroCapture[] {
  let merged = [...current];
  for (const capture of incoming) {
    const preserved = preserveRawMacroCapture(merged, capture);
    if (!preserved.ok) throw new Error("MACRO_HISTORY_RAW_CONFLICT");
    merged = preserved.archive;
  }
  return merged;
}

function validNow(now: Date): boolean {
  return Number.isFinite(now.getTime());
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftUtcDate(date: string, input: { days?: number; months?: number; years?: number }): string {
  const cursor = new Date(`${date}T00:00:00.000Z`);
  if (input.years) cursor.setUTCFullYear(cursor.getUTCFullYear() + input.years);
  if (input.months) cursor.setUTCMonth(cursor.getUTCMonth() + input.months);
  if (input.days) cursor.setUTCDate(cursor.getUTCDate() + input.days);
  return isoDay(cursor);
}

function requestStartDate(range: MacroTrendRange, nowDate: string, frequency: KoreaMacroFrequency): string {
  const window = computeMacroTrendWindow(range, nowDate);
  if (frequency === "D") return shiftUtcDate(window.startDate, { days: -14 });
  if (frequency === "M") return shiftUtcDate(window.startDate, { months: -13 });
  return shiftUtcDate(window.startDate, { months: -15 });
}

function ecosPeriod(date: string, frequency: KoreaMacroFrequency): string {
  if (frequency === "D") return date.replaceAll("-", "");
  if (frequency === "M") return date.slice(0, 7).replace("-", "");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return `${parsed.getUTCFullYear()}Q${Math.floor(parsed.getUTCMonth() / 3) + 1}`;
}

function blocked(input: {
  seriesId: string;
  title: string;
  sectionId: MacroSectionId;
  range: MacroTrendRange;
  code: MacroTrendBlocked["code"];
  message: string;
  sourceUrl: string;
  rightsStatus?: MacroTrendBlocked["rightsStatus"];
}): MacroTrendBlocked {
  return {
    status: "blocked",
    seriesId: input.seriesId,
    title: input.title,
    sectionId: input.sectionId,
    range: input.range,
    code: input.code,
    message: input.message,
    sourceUrl: input.sourceUrl,
    rightsStatus: input.rightsStatus ?? "pb-internal-use-approved",
  };
}

function datasetHash(input: {
  seriesId: string;
  definitionVersion: string;
  captureHashes: string[];
  observations: MacroTrendObservation[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function readyResult(input: {
  seriesId: string;
  title: string;
  sectionId: MacroSectionId;
  provider: string;
  frequency: "D" | "M" | "Q";
  unit: string;
  definitionVersion: string;
  range: MacroTrendRange;
  sourceUrl: string;
  retrievedAt: string;
  observations: MacroTrendObservation[];
  captures: RawMacroCapture[];
}): MacroTrendResult {
  const prepared = prepareMacroTrendObservations({
    observations: input.observations,
    range: input.range,
    frequency: input.frequency,
  });
  if (prepared.status === "blocked") {
    return blocked({
      seriesId: input.seriesId,
      title: input.title,
      sectionId: input.sectionId,
      range: input.range,
      code: prepared.code,
      message: prepared.message,
      sourceUrl: input.sourceUrl,
    });
  }
  const captureHashes = input.captures.map((capture) => capture.contentHash);
  const ready: MacroTrendReady = {
    status: "ready",
    seriesId: input.seriesId,
    title: input.title,
    sectionId: input.sectionId,
    providerId: input.sectionId === "us-rates" ? "us-treasury" : "ecos",
    provider: input.provider,
    frequency: input.frequency,
    unit: input.unit,
    definitionVersion: input.definitionVersion,
    range: input.range,
    anchorObservationDate: prepared.anchorObservationDate,
    requestedStartDate: prepared.requestedStartDate,
    requestedEndDate: prepared.requestedEndDate,
    observations: prepared.observations,
    originalObservationCount: prepared.originalObservationCount,
    normalizedObservationCount: prepared.normalizedObservationCount,
    inRangeObservationCount: prepared.inRangeObservationCount,
    validObservationCount: prepared.validObservationCount,
    missingObservationCount: prepared.missingObservationCount,
    returnedObservationCount: prepared.returnedObservationCount,
    displayMode: prepared.displayMode,
    actualCoverage: prepared.actualCoverage,
    gaps: prepared.gaps,
    sourceUrl: input.sourceUrl,
    retrievedAt: input.retrievedAt,
    datasetContentHash: datasetHash({
      seriesId: input.seriesId,
      definitionVersion: input.definitionVersion,
      captureHashes,
      observations: prepared.inRangeObservations,
    }),
    rightsStatus: "pb-internal-use-approved",
    isEducationalFixture: false,
    captures: input.captures.map(toPublicMacroCaptureManifest),
  };
  return ready;
}

function latestObservationIsStale(
  observationDate: string,
  now: Date,
  staleAfterDays: number,
): boolean {
  const observed = Date.parse(`${observationDate}T23:59:59.999Z`);
  return !Number.isFinite(observed)
    || observed > now.getTime()
    || now.getTime() - observed > staleAfterDays * 86_400_000;
}

async function loadEcosBase(
  seriesId: KoreaMacroSeriesId,
  options: MacroHistoryServiceOptions,
  now: Date,
): Promise<
  | { ok: true; observations: MacroTrendObservation[]; captures: RawMacroCapture[] }
  | { ok: false; code: MacroFailureCode; message: string; captures: RawMacroCapture[] }
> {
  const definition = getKoreaMacroDefinition(seriesId);
  const nowDate = isoDay(now);
  const startDate = requestStartDate(options.range, nowDate, definition.frequency);
  const fetched = await (options.fetchEcos ?? fetchEcosHistory)({
    seriesId,
    startPeriod: ecosPeriod(startDate, definition.frequency),
    endPeriod: ecosPeriod(nowDate, definition.frequency),
    credential: options.ecosCredential ?? "",
    retrievedAt: now.toISOString(),
    archive: ecosHistoryArchive,
  });
  // 동시에 끝난 요청도 기존 archive를 덮어쓰지 않고 현재 상태에 다시 병합합니다.
  ecosHistoryArchive = mergeAppendOnlyMacroHistoryArchive(ecosHistoryArchive, fetched.archive);
  if (!fetched.ok) {
    return { ok: false, code: fetched.code, message: fetched.message, captures: fetched.captures };
  }
  const latest = fetched.observations.at(-1);
  if (!latest || latestObservationIsStale(latest.observationDate, now, definition.staleAfterDays)) {
    return { ok: false, code: "STALE", message: "ECOS 최신 관측치가 허용된 최신성 범위를 벗어났습니다.", captures: fetched.captures };
  }
  return { ok: true, observations: fetched.observations, captures: fetched.captures };
}

async function loadTreasuryBase(
  seriesId: TreasurySeriesId,
  options: MacroHistoryServiceOptions,
  now: Date,
): Promise<
  | { ok: true; observations: MacroTrendObservation[]; captures: RawMacroCapture[] }
  | { ok: false; code: MacroFailureCode; message: string; captures: RawMacroCapture[] }
> {
  const nowDate = isoDay(now);
  const startDate = shiftUtcDate(computeMacroTrendWindow(options.range, nowDate).startDate, { days: -7 });
  const fetched = await (options.fetchTreasury ?? fetchTreasuryHistory)({
    seriesId,
    startDate,
    endDate: nowDate,
    retrievedAt: now.toISOString(),
    archive: treasuryHistoryArchive,
  });
  treasuryHistoryArchive = mergeAppendOnlyMacroHistoryArchive(treasuryHistoryArchive, fetched.archive);
  if (!fetched.ok) return { ok: false, code: fetched.code, message: fetched.message, captures: fetched.captures };
  const latest = fetched.observations.at(-1);
  if (!latest || validateOfficialUsObservationDate("us-treasury", latest.observationDate, now) !== "ready") {
    return { ok: false, code: "STALE", message: "Treasury 최신 관측일을 공식 공표 주기와 일치시킬 수 없습니다.", captures: fetched.captures };
  }
  return { ok: true, observations: fetched.observations, captures: fetched.captures };
}

function previousPeriodKey(raw: string, frequency: "M" | "Q", lag: number): string | null {
  if (frequency === "M") {
    if (!/^\d{6}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    const absolute = year * 12 + month - 1 - lag;
    return `${Math.floor(absolute / 12)}${String(absolute % 12 + 1).padStart(2, "0")}`;
  }
  const match = /^(\d{4})Q([1-4])$/i.exec(raw);
  if (!match) return null;
  const absolute = Number(match[1]) * 4 + Number(match[2]) - 1 - lag;
  return `${Math.floor(absolute / 4)}Q${absolute % 4 + 1}`;
}

function absolutePeriod(raw: string, frequency: "M" | "Q"): number | null {
  if (frequency === "M") {
    if (!/^\d{6}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    return month >= 1 && month <= 12 ? year * 12 + month - 1 : null;
  }
  const match = /^(\d{4})Q([1-4])$/i.exec(raw);
  return match ? Number(match[1]) * 4 + Number(match[2]) - 1 : null;
}

function deterministicChangeHistory(input: {
  observations: MacroTrendObservation[];
  frequency: "M" | "Q";
  lag: number;
}): { ok: true; observations: MacroTrendObservation[] } | { ok: false; code: MacroTrendBlocked["code"]; message: string } {
  const byRawPeriod = new Map(input.observations.map((observation) => [observation.observationDateRaw, observation]));
  const firstAbsolute = input.observations
    .map((observation) => absolutePeriod(observation.observationDateRaw, input.frequency))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  if (firstAbsolute === undefined) {
    return { ok: false, code: "DATE_MISMATCH", message: "원천 기준기간을 승인된 월·분기 형식으로 해석할 수 없습니다." };
  }
  const derived: MacroTrendObservation[] = [];
  for (const current of input.observations) {
    const priorKey = previousPeriodKey(current.observationDateRaw, input.frequency, input.lag);
    const currentAbsolute = absolutePeriod(current.observationDateRaw, input.frequency);
    if (!priorKey || currentAbsolute === null) return { ok: false, code: "DATE_MISMATCH", message: "원천 기준기간을 승인된 변화율 시차로 해석할 수 없습니다." };
    const prior = byRawPeriod.get(priorKey);
    if (!prior) {
      if (currentAbsolute - input.lag < firstAbsolute) continue;
      return { ok: false, code: "DATE_MISMATCH", message: `기준기간 ${current.observationDateRaw}의 정확한 비교기간 ${priorKey}가 없어 변화율 계산을 차단했습니다.` };
    }
    const currentValue = macroTrendNumericValue(current.valueRaw);
    const priorValue = macroTrendNumericValue(prior.valueRaw);
    if (currentValue === null || priorValue === null || priorValue === 0) {
      return { ok: false, code: "DATA_MISSING", message: "변화율 입력값이 결측이거나 분모가 0이라 계산을 차단했습니다." };
    }
    const rounded = Number((((currentValue / priorValue) - 1) * 100).toFixed(12));
    derived.push({
      observationDate: current.observationDate,
      observationDateRaw: current.observationDateRaw,
      valueRaw: String(Object.is(rounded, -0) ? 0 : rounded),
      releaseDate: null,
      vintageDate: null,
      preliminaryFinal: null,
      revisionStatus: null,
      availability: {
        releaseDate: "source_not_provided",
        vintageDate: "source_not_provided",
        preliminaryFinal: "source_not_provided",
        revisionStatus: "source_not_provided",
      },
    });
  }
  return derived.length > 0
    ? { ok: true, observations: derived }
    : { ok: false, code: "DATA_MISSING", message: "승인된 동일 계열·정확한 시차의 변화율 관측치를 만들 수 없습니다." };
}

export function macroTrendSeriesNeedsEcos(seriesId: string): boolean {
  return Object.prototype.hasOwnProperty.call(KOREA_MACRO_ALLOWLIST, seriesId)
    || Object.prototype.hasOwnProperty.call(DERIVED_SERIES, seriesId);
}

export async function loadMacroTrendSeries(
  options: MacroHistoryServiceOptions,
): Promise<MacroTrendResult> {
  const now = options.now?.() ?? new Date();
  if (!validNow(now)) throw new Error("INVALID_NOW");
  const directKorea = KOREA_MACRO_ALLOWLIST[options.seriesId as KoreaMacroSeriesId];
  if (directKorea) {
    const fetched = await loadEcosBase(directKorea.seriesId, options, now);
    if (!fetched.ok) return blocked({
      seriesId: options.seriesId,
      title: directKorea.label,
      sectionId: "korea-macro",
      range: options.range,
      code: fetched.code,
      message: fetched.message,
      sourceUrl: directKorea.sourceUrl,
    });
    return readyResult({
      seriesId: options.seriesId,
      title: directKorea.label,
      sectionId: "korea-macro",
      provider: directKorea.sourceInstitution,
      frequency: directKorea.frequency,
      unit: directKorea.unit,
      definitionVersion: directKorea.definitionId,
      range: options.range,
      sourceUrl: directKorea.sourceUrl,
      retrievedAt: now.toISOString(),
      observations: fetched.observations,
      captures: fetched.captures,
    });
  }

  if ((TREASURY_SERIES_IDS as readonly string[]).includes(options.seriesId)) {
    const definition = getUsMacroDefinition(options.seriesId as TreasurySeriesId);
    const fetched = await loadTreasuryBase(options.seriesId as TreasurySeriesId, options, now);
    if (!fetched.ok) return blocked({
      seriesId: options.seriesId,
      title: definition.title,
      sectionId: "us-rates",
      range: options.range,
      code: fetched.code,
      message: fetched.message,
      sourceUrl: TREASURY_SOURCE_PAGE,
    });
    return readyResult({
      seriesId: options.seriesId,
      title: definition.title,
      sectionId: "us-rates",
      provider: "U.S. Department of the Treasury",
      frequency: "D",
      unit: definition.unit,
      definitionVersion: definition.definitionVersion,
      range: options.range,
      sourceUrl: TREASURY_SOURCE_PAGE,
      retrievedAt: now.toISOString(),
      observations: fetched.observations,
      captures: fetched.captures,
    });
  }

  if ((NY_FED_SERIES_IDS as readonly string[]).includes(options.seriesId)) {
    const definition = getUsMacroDefinition(options.seriesId as (typeof NY_FED_SERIES_IDS)[number]);
    return blocked({
      seriesId: options.seriesId,
      title: definition.title,
      sectionId: "us-rates",
      range: options.range,
      code: "RIGHTS_BLOCKED",
      message: "New York Fed 이력 데이터의 내부 이용권 확인 전에는 추이 조회를 연결하지 않습니다.",
      sourceUrl: definition.sourceUrl,
      rightsStatus: definition.rightsStatus,
    });
  }

  const rightsReview = RIGHTS_REVIEW_REGISTRY.find((entry) => entry.seriesId === options.seriesId);
  if (rightsReview) return blocked({
    seriesId: options.seriesId,
    title: rightsReview.title,
    sectionId: "credit-volatility",
    range: options.range,
    code: "RIGHTS_BLOCKED",
    message: rightsReview.reason,
    sourceUrl: rightsReview.sourceUrl,
    rightsStatus: "licensed-data-required",
  });

  const derived = DERIVED_SERIES[options.seriesId as DerivedSeriesId];
  if (derived?.kind === "spread") {
    // 두 호출이 공유하는 append-only 원본 archive 순서를 보존합니다.
    const left = await loadEcosBase(derived.leftSeriesId, options, now);
    if (!left.ok) return blocked({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "credit-volatility",
      range: options.range,
      code: left.code,
      message: left.message,
      sourceUrl: getKoreaMacroDefinition(derived.leftSeriesId).sourceUrl,
    });
    const right = await loadEcosBase(derived.rightSeriesId, options, now);
    if (!right.ok) return blocked({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "credit-volatility",
      range: options.range,
      code: right.code,
      message: right.message,
      sourceUrl: getKoreaMacroDefinition(derived.leftSeriesId).sourceUrl,
    });
    const captures = [...left.captures, ...right.captures];
    const leftDefinition = getKoreaMacroDefinition(derived.leftSeriesId);
    const rightDefinition = getKoreaMacroDefinition(derived.rightSeriesId);
    const calculated = deriveMacroSpreadHistory({
      left: {
        seriesId: leftDefinition.seriesId,
        unit: leftDefinition.unit,
        definitionVersion: leftDefinition.definitionId,
        observations: left.observations,
      },
      right: {
        seriesId: rightDefinition.seriesId,
        unit: rightDefinition.unit,
        definitionVersion: rightDefinition.definitionId,
        observations: right.observations,
      },
      definition: {
        outputSeriesId: options.seriesId,
        outputUnit: derived.unit,
        formula: derived.formula,
        leftSeriesId: leftDefinition.seriesId,
        rightSeriesId: rightDefinition.seriesId,
        leftDefinitionVersion: leftDefinition.definitionId,
        rightDefinitionVersion: rightDefinition.definitionId,
        inputUnit: leftDefinition.unit,
        multiplier: 100,
      },
    });
    if (calculated.status === "blocked") return blocked({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "credit-volatility",
      range: options.range,
      code: calculated.code,
      message: calculated.message,
      sourceUrl: leftDefinition.sourceUrl,
    });
    return readyResult({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "credit-volatility",
      provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산",
      frequency: "D",
      unit: derived.unit,
      definitionVersion: `${leftDefinition.definitionId}:minus:${rightDefinition.definitionId}:v1`,
      range: options.range,
      sourceUrl: leftDefinition.sourceUrl,
      retrievedAt: now.toISOString(),
      observations: calculated.observations,
      captures,
    });
  }

  if (derived?.kind === "change") {
    const sourceDefinition = getKoreaMacroDefinition(derived.sourceSeriesId);
    const source = await loadEcosBase(derived.sourceSeriesId, options, now);
    if (!source.ok) return blocked({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "korea-macro",
      range: options.range,
      code: source.code,
      message: source.message,
      sourceUrl: sourceDefinition.sourceUrl,
    });
    const calculated = deterministicChangeHistory({
      observations: source.observations,
      frequency: sourceDefinition.frequency as "M" | "Q",
      lag: derived.lag,
    });
    if (!calculated.ok) return blocked({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "korea-macro",
      range: options.range,
      code: calculated.code,
      message: calculated.message,
      sourceUrl: sourceDefinition.sourceUrl,
    });
    return readyResult({
      seriesId: options.seriesId,
      title: derived.title,
      sectionId: "korea-macro",
      provider: "한국은행 경제통계시스템(ECOS) · 결정론 계산",
      frequency: sourceDefinition.frequency,
      unit: derived.unit,
      definitionVersion: `${sourceDefinition.definitionId}:${options.seriesId}:v1`,
      range: options.range,
      sourceUrl: sourceDefinition.sourceUrl,
      retrievedAt: now.toISOString(),
      observations: calculated.observations,
      captures: source.captures,
    });
  }

  return blocked({
    seriesId: options.seriesId,
    title: "미승인 거시 계열",
    sectionId: "korea-macro",
    range: options.range,
    code: "SERIES_NOT_ALLOWED",
    message: "출처 registry allowlist에 없는 계열이어서 이력 조회를 차단했습니다.",
    sourceUrl: "https://ecos.bok.or.kr/api/",
  });
}
