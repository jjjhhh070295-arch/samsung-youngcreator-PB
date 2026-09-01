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
  buildTreasuryFeedUrl,
  getUsMacroDefinition,
  TREASURY_SOURCE_PAGE,
  TREASURY_SERIES_IDS,
  validateOfficialUsObservationDate,
  type UsMacroSeriesId,
} from "./usRegistry";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TreasuryConnectorOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  archive?: readonly RawMacroCapture[];
  maxResponseBytes?: number;
}

export interface TreasuryConnectorResult {
  ok: boolean;
  results: MacroSeriesResult[];
  capture: RawMacroCapture | null;
  archive: readonly RawMacroCapture[];
  captureCreated: boolean;
  duplicate: boolean;
  rawChangeDetected: boolean;
}

const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

function blockedResults(code: MacroFailureCode, message: string, sourceUrl: string): MacroSeriesBlocked[] {
  return TREASURY_SERIES_IDS.map((seriesId) => {
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
): TreasuryConnectorResult {
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

function localTagValue(xml: string, localName: string): string | null {
  const safeName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${safeName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${safeName}\\s*>`,
    "i",
  );
  const match = expression.exec(xml);
  if (!match) return null;
  const text = match[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
  return text || null;
}

interface ParsedTreasuryRow {
  observationDate: string;
  observationDateRaw: string;
  values: Partial<Record<(typeof TREASURY_SERIES_IDS)[number], string>>;
}

function parseTreasuryRows(xml: string): ParsedTreasuryRow[] {
  const rows: ParsedTreasuryRow[] = [];
  const entryExpression = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entryExpression.exec(xml)) !== null) {
    const body = entry[1] ?? "";
    const observationDateRaw = localTagValue(body, "NEW_DATE");
    if (!observationDateRaw) continue;
    const observationDate = observationDateRaw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) continue;

    const values: ParsedTreasuryRow["values"] = {};
    for (const seriesId of TREASURY_SERIES_IDS) {
      const rawValue = localTagValue(body, getUsMacroDefinition(seriesId).sourceField);
      if (rawValue !== null) values[seriesId] = rawValue;
    }
    rows.push({ observationDate, observationDateRaw, values });
  }
  return rows;
}

function numericValue(valueRaw: string): number | null {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(valueRaw.trim())) return null;
  const value = Number(valueRaw);
  return Number.isFinite(value) ? value : null;
}

function macroObservation(row: ParsedTreasuryRow, seriesId: UsMacroSeriesId): MacroObservation | null {
  const valueRaw = row.values[seriesId as keyof ParsedTreasuryRow["values"]];
  if (valueRaw === undefined || numericValue(valueRaw) === null) return null;
  return {
    observationDate: row.observationDate,
    observationDateRaw: row.observationDateRaw,
    valueRaw,
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
  };
}

function readyEvidence(
  row: ParsedTreasuryRow,
  seriesId: (typeof TREASURY_SERIES_IDS)[number],
  sourceUrl: string,
  retrievedAt: string,
  contentHash: string,
): MacroSeriesEvidence | null {
  const definition = getUsMacroDefinition(seriesId);
  if (definition.rightsStatus !== "pb-internal-use-approved") return null;
  const observation = macroObservation(row, seriesId);
  if (!observation) return null;
  return {
    status: "ready",
    mode: "official-live",
    seriesId,
    sectionId: definition.sectionId,
    providerId: definition.providerId,
    provider: "U.S. Department of the Treasury",
    title: definition.title,
    frequency: definition.frequency,
    unit: definition.unit,
    definitionVersion: definition.definitionVersion,
    observations: [observation],
    latestObservation: observation,
    sourceUrl,
    retrievedAt,
    contentHash,
    rightsStatus: definition.rightsStatus,
    isEducationalFixture: false,
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

export async function fetchTreasuryYieldEvidence(
  options: TreasuryConnectorOptions = {},
): Promise<TreasuryConnectorResult> {
  const now = options.now?.() ?? new Date();
  const archive = options.archive ?? [];
  if (!Number.isFinite(now.getTime())) {
    return failure("METADATA_MISMATCH", "수집 시각이 유효하지 않아 요청을 차단했습니다.", TREASURY_SOURCE_PAGE, archive);
  }
  const sourceUrl = buildTreasuryFeedUrl(now.getUTCFullYear());
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) return failure("UPSTREAM_UNAVAILABLE", "서버 fetch 구현이 없어 수집을 차단했습니다.", sourceUrl, archive);

  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      cache: "no-store",
      headers: { Accept: "application/atom+xml, application/xml, text/xml" },
    });
  } catch {
    return failure("UPSTREAM_UNAVAILABLE", "Treasury 원천 응답을 받지 못해 결과 사용을 차단했습니다.", sourceUrl, archive);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentLength = Number(response.headers.get("content-length"));
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    return failure("RESPONSE_TOO_LARGE", "Treasury 응답이 허용 크기를 초과해 수집을 차단했습니다.", sourceUrl, archive);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return failure("RESPONSE_INVALID", "Treasury 원문 바이트를 읽지 못해 결과 사용을 차단했습니다.", sourceUrl, archive);
  }
  if (bytes.byteLength === 0) return failure("DATA_MISSING", "Treasury 원문 응답이 비어 있습니다.", sourceUrl, archive);
  if (bytes.byteLength > maxResponseBytes) return failure("RESPONSE_TOO_LARGE", "Treasury 응답이 허용 크기를 초과했습니다.", sourceUrl, archive);

  const retrievedAt = now.toISOString();
  const capture = createRawMacroCapture({
    bytes,
    retrievedAt,
    responseStatus: response.status,
    contentType,
    sanitizedRequest: {
      providerId: "us-treasury",
      operation: "daily_treasury_yield_curve",
      seriesIds: [...TREASURY_SERIES_IDS],
      frequency: "D",
      startDate: String(now.getUTCFullYear()),
      endDate: String(now.getUTCFullYear()),
    },
  });
  const stored = preserveCapture(archive, capture);
  if (!stored.ok) return failure("RAW_CONFLICT", "동일 Treasury 원본 식별자의 메타데이터가 충돌해 결과 사용을 차단했습니다.", sourceUrl, archive, capture);
  if (!response.ok) {
    return failure("UPSTREAM_UNAVAILABLE", `Treasury 원천이 HTTP ${response.status}로 응답해 결과 사용을 차단했습니다.`, sourceUrl, stored.archive, stored.capture);
  }
  if (!/(?:xml|atom)/i.test(contentType)) {
    return failure("RESPONSE_INVALID", "Treasury 응답 형식이 공식 XML 형식과 일치하지 않습니다.", sourceUrl, stored.archive, stored.capture);
  }

  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failure("RESPONSE_INVALID", "Treasury XML 문자 인코딩을 검증하지 못했습니다.", sourceUrl, stored.archive, stored.capture);
  }
  const rows = parseTreasuryRows(xml).sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  const latest = rows.at(-1);
  if (!latest) return failure("DATA_MISSING", "Treasury 최신 행 또는 필수 2·5·10·30년 값이 없습니다.", sourceUrl, stored.archive, stored.capture);

  const sameDateRows = rows.filter((row) => row.observationDate === latest.observationDate);
  const signatures = new Set(sameDateRows.map((row) => JSON.stringify(row.values)));
  if (signatures.size !== 1) {
    return failure("DATA_CONFLICT", "Treasury 최신 기준일에 서로 다른 값이 있어 결과 사용을 차단했습니다.", sourceUrl, stored.archive, stored.capture);
  }

  const freshness = validateOfficialUsObservationDate("us-treasury", latest.observationDate, now);
  if (freshness === "stale") return failure("STALE", "Treasury 최신 관측치가 허용 기간보다 오래되어 결과 사용을 차단했습니다.", sourceUrl, stored.archive, stored.capture);
  if (freshness !== "ready") return failure("METADATA_MISMATCH", "Treasury 기준일이 유효하지 않거나 미래 날짜입니다.", sourceUrl, stored.archive, stored.capture);

  const results = TREASURY_SERIES_IDS.map((seriesId) => readyEvidence(
    latest,
    seriesId,
    sourceUrl,
    retrievedAt,
    stored.capture.contentHash,
  ));
  if (results.some((item) => item === null)) {
    return failure("DATA_MISSING", "Treasury 필수 값이 숫자로 검증되지 않아 전체 결과를 차단했습니다.", sourceUrl, stored.archive, stored.capture);
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
