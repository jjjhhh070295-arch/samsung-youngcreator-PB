import {
  createRawMacroCapture,
  preserveRawMacroCapture,
} from "./rawCapture.server";
import type {
  MacroFailureCode,
  MacroObservation,
  RawMacroCapture,
} from "./types";
import {
  buildTreasuryFeedUrl,
  getUsMacroDefinition,
  TREASURY_SERIES_IDS,
  type UsMacroSeriesId,
} from "./usRegistry";

type TreasurySeriesId = (typeof TREASURY_SERIES_IDS)[number];
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TreasuryHistoryConnectorOptions {
  seriesId: TreasurySeriesId;
  startDate: string;
  endDate: string;
  retrievedAt: string;
  fetcher?: FetchLike;
  archive?: readonly RawMacroCapture[];
  maxResponseBytes?: number;
}

export type TreasuryHistoryConnectorResult =
  | {
      ok: true;
      observations: MacroObservation[];
      captures: RawMacroCapture[];
      archive: readonly RawMacroCapture[];
    }
  | {
      ok: false;
      code: MacroFailureCode;
      message: string;
      captures: RawMacroCapture[];
      archive: readonly RawMacroCapture[];
    };

const DEFAULT_MAX_RESPONSE_BYTES = 4_000_000;

function failure(
  code: MacroFailureCode,
  message: string,
  archive: readonly RawMacroCapture[],
  captures: RawMacroCapture[],
): TreasuryHistoryConnectorResult {
  return { ok: false, code, message, archive, captures };
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

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function observationFromEntry(body: string, seriesId: UsMacroSeriesId): MacroObservation | null {
  const observationDateRaw = localTagValue(body, "NEW_DATE");
  const valueRaw = localTagValue(body, getUsMacroDefinition(seriesId).sourceField);
  if (!observationDateRaw) return null;
  const observationDate = observationDateRaw.slice(0, 10);
  if (!validDate(observationDate)) return null;
  const missing = valueRaw === null || /^(?:N\/?A|--|NULL)$/i.test(valueRaw.trim());
  if (!missing && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(valueRaw)
    || !Number.isFinite(Number(valueRaw)))) return null;
  return {
    observationDate,
    observationDateRaw,
    // 공식 nil/N/A는 빈 원문값으로 보존합니다. 0이나 보간값을 만들지 않습니다.
    valueRaw: missing ? "" : valueRaw,
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

function parseYear(xml: string, seriesId: TreasurySeriesId): MacroObservation[] {
  const observations: MacroObservation[] = [];
  const entries = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = entries.exec(xml)) !== null) {
    const observation = observationFromEntry(match[1] ?? "", seriesId);
    if (observation) observations.push(observation);
  }
  return observations;
}

async function fetchYear(
  input: TreasuryHistoryConnectorOptions,
  fetcher: FetchLike,
  year: number,
  archive: readonly RawMacroCapture[],
): Promise<
  | { ok: true; observations: MacroObservation[]; capture: RawMacroCapture; archive: readonly RawMacroCapture[] }
  | { ok: false; code: MacroFailureCode; message: string; capture?: RawMacroCapture; archive: readonly RawMacroCapture[] }
> {
  let response: Response;
  try {
    response = await fetcher(buildTreasuryFeedUrl(year), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/atom+xml, application/xml, text/xml" },
    });
  } catch {
    return { ok: false, code: "UPSTREAM_UNAVAILABLE", message: "Treasury 연도별 이력 응답을 받지 못했습니다.", archive };
  }
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    return { ok: false, code: "RESPONSE_TOO_LARGE", message: "Treasury 연도별 이력 응답이 허용 크기를 초과했습니다.", archive };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, code: "RESPONSE_INVALID", message: "Treasury 연도별 원문 바이트를 읽지 못했습니다.", archive };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, code: "DATA_MISSING", message: "Treasury 연도별 원문이 비어 있습니다.", archive };
  }
  if (bytes.byteLength > maxResponseBytes) {
    return { ok: false, code: "RESPONSE_TOO_LARGE", message: "Treasury 연도별 이력 응답이 허용 크기를 초과했습니다.", archive };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const capture = createRawMacroCapture({
    bytes,
    retrievedAt: input.retrievedAt,
    responseStatus: response.status,
    contentType: contentType || "application/octet-stream",
    sanitizedRequest: {
      providerId: "us-treasury",
      operation: `daily_treasury_yield_curve:year:${year}`,
      seriesIds: [input.seriesId],
      frequency: "D",
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    },
  });
  const preserved = preserveRawMacroCapture([...archive], capture);
  if (!preserved.ok) {
    return { ok: false, code: "RAW_CONFLICT", message: "Treasury 이력 원본 보존 레코드가 충돌했습니다.", archive, capture };
  }
  if (!response.ok) {
    return { ok: false, code: "UPSTREAM_UNAVAILABLE", message: `Treasury 이력 원천이 HTTP ${response.status}로 응답했습니다.`, archive: preserved.archive, capture };
  }
  if (!/(?:xml|atom)/i.test(contentType)) {
    return { ok: false, code: "RESPONSE_INVALID", message: "Treasury 이력 응답이 공식 XML 형식이 아닙니다.", archive: preserved.archive, capture };
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "RESPONSE_INVALID", message: "Treasury 이력 XML을 안전하게 해석하지 못했습니다.", archive: preserved.archive, capture };
  }
  const observations = parseYear(xml, input.seriesId);
  if (observations.length === 0) {
    return { ok: false, code: "DATA_MISSING", message: `${year}년 Treasury 이력에 요청 계열 관측치가 없습니다.`, archive: preserved.archive, capture };
  }
  return { ok: true, observations, capture, archive: preserved.archive };
}

export async function fetchTreasuryHistory(
  input: TreasuryHistoryConnectorOptions,
): Promise<TreasuryHistoryConnectorResult> {
  const archive = input.archive ?? [];
  const captures: RawMacroCapture[] = [];
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate
    || !Number.isFinite(Date.parse(input.retrievedAt))) {
    return failure("METADATA_MISMATCH", "Treasury 이력 조회 기간 또는 수집시각이 유효하지 않습니다.", archive, captures);
  }
  if (!TREASURY_SERIES_IDS.includes(input.seriesId)) {
    return failure("SERIES_NOT_ALLOWED", "승인되지 않은 Treasury 이력 계열입니다.", archive, captures);
  }
  const startYear = Number(input.startDate.slice(0, 4));
  const endYear = Number(input.endDate.slice(0, 4));
  // 30Y 화면은 최신 관측일 지연을 보완하는 짧은 앞쪽 버퍼 때문에
  // 달력상 최대 32개 연도 feed가 필요할 수 있습니다.
  if (startYear < 1990 || endYear > 2200 || endYear - startYear > 31) {
    return failure("METADATA_MISMATCH", "Treasury 이력 연도 범위가 허용 범위를 벗어났습니다.", archive, captures);
  }
  const fetcher = input.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    return failure("UPSTREAM_UNAVAILABLE", "서버 fetch 구현이 없어 Treasury 이력 조회를 차단했습니다.", archive, captures);
  }
  let workingArchive = archive;
  const byDate = new Map<string, MacroObservation>();
  for (let year = startYear; year <= endYear; year += 1) {
    const page = await fetchYear(input, fetcher, year, workingArchive);
    if (!page.ok) {
      if (page.capture) captures.push(page.capture);
      return failure(page.code, page.message, page.archive, captures);
    }
    workingArchive = page.archive;
    captures.push(page.capture);
    for (const observation of page.observations) {
      if (observation.observationDate < input.startDate || observation.observationDate > input.endDate) continue;
      const existing = byDate.get(observation.observationDate);
      if (existing && existing.valueRaw !== observation.valueRaw) {
        return failure("DATA_CONFLICT", "같은 Treasury 관측일에 서로 다른 값이 있어 이력 사용을 차단했습니다.", workingArchive, captures);
      }
      if (!existing) byDate.set(observation.observationDate, observation);
    }
  }
  const observations = Array.from(byDate.values()).sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  if (observations.length === 0) {
    return failure("DATA_MISSING", "선택 기간에 Treasury 이력 관측치가 없습니다.", workingArchive, captures);
  }
  return { ok: true, observations, captures, archive: workingArchive };
}
