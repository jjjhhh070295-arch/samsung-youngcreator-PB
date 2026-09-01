import {
  createRawMacroCapture,
  preserveRawMacroCapture,
} from "./rawCapture.server";
import type {
  MacroFailureCode,
  MacroObservation,
  MacroSeriesBlocked,
  MacroSeriesEvidence,
  MacroSeriesResult,
  RawMacroCapture,
} from "./types";
import {
  getUsMacroDefinition,
  NY_FED_LATEST_RATES_URL,
  NY_FED_SERIES_IDS,
  validateOfficialUsObservationDate,
} from "./usRegistry";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NyFedConnectorOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  archive?: readonly RawMacroCapture[];
  maxResponseBytes?: number;
}

export interface NyFedConnectorResult {
  ok: boolean;
  results: MacroSeriesResult[];
  capture: RawMacroCapture | null;
  archive: readonly RawMacroCapture[];
  captureCreated: boolean;
  duplicate: boolean;
  rawChangeDetected: boolean;
}

const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

function blockedResults(code: MacroFailureCode, message: string, sourceUrl: string): MacroSeriesBlocked[] {
  return NY_FED_SERIES_IDS.map((seriesId) => {
    const definition = getUsMacroDefinition(seriesId);
    return {
      status: "blocked",
      seriesId,
      sectionId: definition.sectionId,
      title: definition.title,
      code,
      message,
      sourceUrl,
      rightsStatus: definition.rightsStatus,
    };
  });
}

function failure(
  code: MacroFailureCode,
  message: string,
  sourceUrl: string,
  archive: readonly RawMacroCapture[],
  capture: RawMacroCapture | null = null,
): NyFedConnectorResult {
  return {
    ok: false,
    results: blockedResults(code, message, sourceUrl),
    capture,
    archive,
    captureCreated: false,
    duplicate: false,
    rawChangeDetected: false,
  };
}

function sameSanitizedRequest(left: RawMacroCapture, right: RawMacroCapture): boolean {
  return JSON.stringify(left.sanitizedRequest) === JSON.stringify(right.sanitizedRequest);
}

function preserveCapture(
  archive: readonly RawMacroCapture[],
  capture: RawMacroCapture,
):
  | { ok: true; archive: readonly RawMacroCapture[]; capture: RawMacroCapture; created: boolean; duplicate: boolean; changed: boolean }
  | { ok: false } {
  const exactContent = archive.find((entry) => entry.providerId === capture.providerId
    && entry.contentHash === capture.contentHash
    && entry.responseStatus === capture.responseStatus
    && entry.contentType === capture.contentType
    && sameSanitizedRequest(entry, capture));
  if (exactContent) {
    return { ok: true, archive, capture: exactContent, created: false, duplicate: true, changed: false };
  }
  const changed = archive.some((entry) => entry.providerId === capture.providerId
    && entry.contentHash !== capture.contentHash
    && sameSanitizedRequest(entry, capture));
  const result = preserveRawMacroCapture([...archive], capture);
  if (!result.ok) return { ok: false };
  return { ok: true, archive: result.archive, capture, created: result.created, duplicate: false, changed };
}

interface ParsedEffrRow {
  observationDate: string;
  observationDateRaw: string;
  valueRawBySeries: Partial<Record<(typeof NY_FED_SERIES_IDS)[number], string>>;
  revisionStatus: string | null;
}

function exactScalarRaw(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) || !Number.isFinite(Number(trimmed))) return null;
  return trimmed;
}

function parseEffrRows(value: unknown): ParsedEffrRow[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { refRates?: unknown }).refRates)) {
    return [];
  }
  const rows: ParsedEffrRow[] = [];
  for (const candidate of (value as { refRates: unknown[] }).refRates) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    if (row.type !== "EFFR") continue;
    if (typeof row.effectiveDate !== "string") continue;
    const observationDateRaw = row.effectiveDate.trim();
    const observationDate = observationDateRaw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) continue;
    const effr = exactScalarRaw(row.percentRate);
    const lower = exactScalarRaw(row.targetRateFrom);
    const upper = exactScalarRaw(row.targetRateTo);
    const revisionStatus = typeof row.revisionIndicator === "string" && row.revisionIndicator.trim()
      ? row.revisionIndicator.trim()
      : null;
    const valueRawBySeries: ParsedEffrRow["valueRawBySeries"] = {};
    if (effr !== null) valueRawBySeries["nyfed-effr"] = effr;
    if (lower !== null) valueRawBySeries["nyfed-target-lower"] = lower;
    if (upper !== null) valueRawBySeries["nyfed-target-upper"] = upper;
    rows.push({
      observationDate,
      observationDateRaw,
      valueRawBySeries,
      revisionStatus,
    });
  }
  return rows;
}

function observation(
  row: ParsedEffrRow,
  seriesId: (typeof NY_FED_SERIES_IDS)[number],
): MacroObservation | null {
  const valueRaw = row.valueRawBySeries[seriesId];
  if (valueRaw === undefined) return null;
  return {
    observationDate: row.observationDate,
    observationDateRaw: row.observationDateRaw,
    valueRaw,
    releaseDate: null,
    vintageDate: null,
    preliminaryFinal: null,
    revisionStatus: row.revisionStatus,
    availability: {
      releaseDate: "source_not_provided",
      vintageDate: "source_not_provided",
      preliminaryFinal: "source_not_provided",
      revisionStatus: row.revisionStatus === null ? "source_not_provided" : "provided",
    },
  };
}

function readyEvidence(
  row: ParsedEffrRow,
  seriesId: (typeof NY_FED_SERIES_IDS)[number],
  sourceUrl: string,
  retrievedAt: string,
  contentHash: string,
): MacroSeriesEvidence | null {
  const definition = getUsMacroDefinition(seriesId);
  if (definition.rightsStatus !== "pb-internal-use-approved") return null;
  const latestObservation = observation(row, seriesId);
  if (!latestObservation) return null;
  return {
    status: "ready",
    mode: "official-live",
    seriesId,
    sectionId: definition.sectionId,
    providerId: definition.providerId,
    provider: "Federal Reserve Bank of New York",
    title: definition.title,
    frequency: definition.frequency,
    unit: definition.unit,
    definitionVersion: definition.definitionVersion,
    observations: [latestObservation],
    latestObservation,
    sourceUrl,
    retrievedAt,
    contentHash,
    rightsStatus: definition.rightsStatus,
    isEducationalFixture: false,
  };
}

export async function fetchNyFedRatesEvidence(
  options: NyFedConnectorOptions = {},
): Promise<NyFedConnectorResult> {
  const now = options.now?.() ?? new Date();
  const archive = options.archive ?? [];
  const sourceUrl = NY_FED_LATEST_RATES_URL;
  if (!Number.isFinite(now.getTime())) {
    return failure("METADATA_MISMATCH", "수집 시각이 유효하지 않아 요청을 차단했습니다.", sourceUrl, archive);
  }
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) return failure("UPSTREAM_UNAVAILABLE", "서버 fetch 구현이 없어 수집을 차단했습니다.", sourceUrl, archive);

  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return failure("UPSTREAM_UNAVAILABLE", "NY Fed 원천 응답을 받지 못해 결과 사용을 차단했습니다.", sourceUrl, archive);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentLength = Number(response.headers.get("content-length"));
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    return failure("RESPONSE_TOO_LARGE", "NY Fed 응답이 허용 크기를 초과해 수집을 차단했습니다.", sourceUrl, archive);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure("RESPONSE_INVALID", "NY Fed 원문 바이트를 읽지 못해 결과 사용을 차단했습니다.", sourceUrl, archive);
  }
  if (bytes.byteLength === 0) return failure("DATA_MISSING", "NY Fed 원문 응답이 비어 있습니다.", sourceUrl, archive);
  if (bytes.byteLength > maxResponseBytes) return failure("RESPONSE_TOO_LARGE", "NY Fed 응답이 허용 크기를 초과했습니다.", sourceUrl, archive);

  const retrievedAt = now.toISOString();
  const capture = createRawMacroCapture({
    bytes,
    retrievedAt,
    responseStatus: response.status,
    contentType,
    sanitizedRequest: {
      providerId: "ny-fed",
      operation: "reference_rates_latest",
      seriesIds: [...NY_FED_SERIES_IDS],
      frequency: "D",
    },
  });
  const stored = preserveCapture(archive, capture);
  if (!stored.ok) return failure("RAW_CONFLICT", "동일 NY Fed 원본 식별자의 메타데이터가 충돌해 결과 사용을 차단했습니다.", sourceUrl, archive, capture);
  if (!response.ok) {
    return failure("UPSTREAM_UNAVAILABLE", `NY Fed 원천이 HTTP ${response.status}로 응답해 결과 사용을 차단했습니다.`, sourceUrl, stored.archive, stored.capture);
  }
  if (!/json/i.test(contentType)) {
    return failure("RESPONSE_INVALID", "NY Fed 응답 형식이 공식 JSON 형식과 일치하지 않습니다.", sourceUrl, stored.archive, stored.capture);
  }

  let parsed: unknown;
  try {
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return failure("RESPONSE_INVALID", "NY Fed JSON을 검증하지 못했습니다.", sourceUrl, stored.archive, stored.capture);
  }
  const rows = parseEffrRows(parsed).sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  const latest = rows.at(-1);
  if (!latest) {
    return failure("DATA_MISSING", "NY Fed 최신 EFFR 또는 목표금리 범위 필드가 없습니다.", sourceUrl, stored.archive, stored.capture);
  }

  const sameDateRows = rows.filter((row) => row.observationDate === latest.observationDate);
  const signatures = new Set(sameDateRows.map((row) => JSON.stringify({
    values: row.valueRawBySeries,
    revisionStatus: row.revisionStatus,
  })));
  if (signatures.size !== 1) {
    return failure("DATA_CONFLICT", "NY Fed 최신 기준일에 서로 다른 값 또는 수정 상태가 있어 결과 사용을 차단했습니다.", sourceUrl, stored.archive, stored.capture);
  }

  const freshness = validateOfficialUsObservationDate("ny-fed", latest.observationDate, now);
  if (freshness === "stale") return failure("STALE", "NY Fed 최신 관측치가 허용 기간보다 오래되어 결과 사용을 차단했습니다.", sourceUrl, stored.archive, stored.capture);
  if (freshness !== "ready") return failure("METADATA_MISMATCH", "NY Fed 기준일이 유효하지 않거나 미래 날짜입니다.", sourceUrl, stored.archive, stored.capture);

  const lower = latest.valueRawBySeries["nyfed-target-lower"];
  const upper = latest.valueRawBySeries["nyfed-target-upper"];
  if (NY_FED_SERIES_IDS.some((seriesId) => latest.valueRawBySeries[seriesId] === undefined)) {
    return failure("DATA_MISSING", "NY Fed 최신 EFFR 또는 목표금리 범위 필드가 없습니다.", sourceUrl, stored.archive, stored.capture);
  }
  if (lower !== undefined && upper !== undefined && Number(lower) > Number(upper)) {
    return failure("METADATA_MISMATCH", "NY Fed 목표금리 하단이 상단보다 커 결과 사용을 차단했습니다.", sourceUrl, stored.archive, stored.capture);
  }

  if (NY_FED_SERIES_IDS.some((seriesId) => getUsMacroDefinition(seriesId).rightsStatus !== "pb-internal-use-approved")) {
    return {
      ok: false,
      results: blockedResults(
        "RIGHTS_BLOCKED",
        "NY Fed 기준금리 데이터의 필수 고지문·출처표시를 준법 검토해 화면에 적용하기 전까지 수치 표시를 차단합니다.",
        sourceUrl,
      ),
      capture: stored.capture,
      archive: stored.archive,
      captureCreated: stored.created,
      duplicate: stored.duplicate,
      rawChangeDetected: stored.changed,
    };
  }

  const results = NY_FED_SERIES_IDS.map((seriesId) => readyEvidence(
    latest,
    seriesId,
    sourceUrl,
    retrievedAt,
    stored.capture.contentHash,
  ));
  if (results.some((item) => item === null)) {
    return failure("DATA_MISSING", "NY Fed 최신 EFFR 또는 목표금리 범위 필드가 없습니다.", sourceUrl, stored.archive, stored.capture);
  }

  return {
    ok: true,
    results: results as MacroSeriesEvidence[],
    capture: stored.capture,
    archive: stored.archive,
    captureCreated: stored.created,
    duplicate: stored.duplicate,
    rawChangeDetected: stored.changed,
  };
}
