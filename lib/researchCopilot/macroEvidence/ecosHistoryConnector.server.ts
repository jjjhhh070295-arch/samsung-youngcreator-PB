import {
  createRawMacroCapture,
  preserveRawMacroCapture,
} from "./rawCapture.server";
import {
  getKoreaMacroDefinition,
  type KoreaMacroSeriesId,
} from "./koreaRegistry";
import type {
  MacroFailureCode,
  MacroObservation,
  RawMacroCapture,
} from "./types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EcosHistoryConnectorOptions {
  seriesId: KoreaMacroSeriesId;
  startPeriod: string;
  endPeriod: string;
  credential: string;
  retrievedAt: string;
  fetcher?: FetchLike;
  archive?: readonly RawMacroCapture[];
  pageSize?: number;
  maxPages?: number;
  maxResponseBytes?: number;
}

export type EcosHistoryConnectorResult =
  | {
      ok: true;
      observations: MacroObservation[];
      captures: RawMacroCapture[];
      archive: readonly RawMacroCapture[];
      totalCount: number;
    }
  | {
      ok: false;
      code: MacroFailureCode;
      message: string;
      captures: RawMacroCapture[];
      archive: readonly RawMacroCapture[];
    };

interface EcosStatisticRow {
  STAT_CODE?: unknown;
  ITEM_CODE1?: unknown;
  UNIT_NAME?: unknown;
  TIME?: unknown;
  DATA_VALUE?: unknown;
}

interface EcosStatisticPayload {
  StatisticSearch?: {
    list_total_count?: unknown;
    row?: unknown;
  };
}

const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_RESPONSE_BYTES = 4_000_000;

function failure(
  code: MacroFailureCode,
  message: string,
  archive: readonly RawMacroCapture[],
  captures: RawMacroCapture[],
): EcosHistoryConnectorResult {
  return { ok: false, code, message, archive, captures };
}

function validNumericRaw(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
    && Number.isFinite(Number(value));
}

function normalizedObservationDate(raw: string, frequency: "D" | "M" | "Q"): string | null {
  if (frequency === "D") {
    if (!/^\d{8}$/.test(raw)) return null;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
      ? date
      : null;
  }
  if (frequency === "M") {
    if (!/^\d{6}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    if (year < 1900 || month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  const match = /^(\d{4})Q([1-4])$/i.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  if (year < 1900) return null;
  return new Date(Date.UTC(year, quarter * 3, 0)).toISOString().slice(0, 10);
}

function observationFromRow(
  row: EcosStatisticRow,
  seriesId: KoreaMacroSeriesId,
): { observation: MacroObservation; signature: string } | null {
  const definition = getKoreaMacroDefinition(seriesId);
  if (row.STAT_CODE !== definition.statCode
    || !definition.itemCodes.includes(String(row.ITEM_CODE1))) {
    return null;
  }
  if (row.UNIT_NAME !== definition.unit
    || typeof row.TIME !== "string"
    || typeof row.DATA_VALUE !== "string"
    || !validNumericRaw(row.DATA_VALUE)) {
    return null;
  }
  const observationDate = normalizedObservationDate(row.TIME, definition.frequency);
  if (!observationDate) return null;
  const signature = JSON.stringify({
    statCode: row.STAT_CODE,
    itemCode: row.ITEM_CODE1,
    unit: row.UNIT_NAME,
    time: row.TIME,
    valueRaw: row.DATA_VALUE,
  });
  return {
    signature,
    observation: {
      observationDate,
      observationDateRaw: row.TIME,
      valueRaw: row.DATA_VALUE,
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
    },
  };
}

function buildCredentialedUrl(
  input: EcosHistoryConnectorOptions,
  rowStart: number,
  rowEnd: number,
): string {
  const definition = getKoreaMacroDefinition(input.seriesId);
  const itemPath = definition.itemCodes.map(encodeURIComponent).join("/");
  return [
    "https://ecos.bok.or.kr/api/StatisticSearch",
    encodeURIComponent(input.credential),
    "json",
    "kr",
    String(rowStart),
    String(rowEnd),
    definition.statCode,
    definition.frequency,
    encodeURIComponent(input.startPeriod),
    encodeURIComponent(input.endPeriod),
    itemPath,
  ].join("/");
}

async function readPage(
  input: EcosHistoryConnectorOptions,
  fetcher: FetchLike,
  rowStart: number,
  rowEnd: number,
  archive: readonly RawMacroCapture[],
): Promise<
  | { ok: true; payload: EcosStatisticPayload; capture: RawMacroCapture; archive: readonly RawMacroCapture[] }
  | { ok: false; code: MacroFailureCode; message: string; archive: readonly RawMacroCapture[]; capture?: RawMacroCapture }
> {
  let response: Response;
  try {
    response = await fetcher(buildCredentialedUrl(input, rowStart, rowEnd), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "UPSTREAM_UNAVAILABLE", message: "ECOS 이력 원천 응답을 받지 못했습니다.", archive };
  }
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    return { ok: false, code: "RESPONSE_TOO_LARGE", message: "ECOS 이력 응답이 허용 크기를 초과했습니다.", archive };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { ok: false, code: "RESPONSE_INVALID", message: "ECOS 이력 원문 바이트를 읽지 못했습니다.", archive };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, code: "DATA_MISSING", message: "ECOS 이력 원문이 비어 있습니다.", archive };
  }
  if (bytes.byteLength > maxResponseBytes) {
    return { ok: false, code: "RESPONSE_TOO_LARGE", message: "ECOS 이력 응답이 허용 크기를 초과했습니다.", archive };
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const capture = createRawMacroCapture({
    bytes,
    retrievedAt: input.retrievedAt,
    responseStatus: response.status,
    contentType: contentType || "application/octet-stream",
    sanitizedRequest: {
      providerId: "ecos",
      operation: `StatisticSearch:rows:${rowStart}-${rowEnd}`,
      seriesIds: [input.seriesId],
      frequency: getKoreaMacroDefinition(input.seriesId).frequency,
      startDate: input.startPeriod,
      endDate: input.endPeriod,
    },
  });
  const preserved = preserveRawMacroCapture([...archive], capture);
  if (!preserved.ok) {
    return { ok: false, code: "RAW_CONFLICT", message: "ECOS 이력 원본 보존 레코드가 충돌했습니다.", archive, capture };
  }
  if (!response.ok) {
    return { ok: false, code: "UPSTREAM_UNAVAILABLE", message: `ECOS 이력 원천이 HTTP ${response.status}로 응답했습니다.`, archive: preserved.archive, capture };
  }
  if (!contentType.includes("json")) {
    return { ok: false, code: "RESPONSE_INVALID", message: "ECOS 이력 응답이 공식 JSON 형식이 아닙니다.", archive: preserved.archive, capture };
  }
  let payload: EcosStatisticPayload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as EcosStatisticPayload;
  } catch {
    return { ok: false, code: "RESPONSE_INVALID", message: "ECOS 이력 JSON을 안전하게 해석하지 못했습니다.", archive: preserved.archive, capture };
  }
  return { ok: true, payload, capture, archive: preserved.archive };
}

export async function fetchEcosHistory(
  input: EcosHistoryConnectorOptions,
): Promise<EcosHistoryConnectorResult> {
  const archive = input.archive ?? [];
  const captures: RawMacroCapture[] = [];
  if (!input.credential.trim()) {
    return failure("KEY_MISSING", "서버 전용 ECOS 인증키가 없어 이력 조회를 차단했습니다.", archive, captures);
  }
  if (!Number.isFinite(Date.parse(input.retrievedAt)) || !input.startPeriod.trim() || !input.endPeriod.trim()) {
    return failure("METADATA_MISMATCH", "ECOS 이력 조회 기간 또는 수집시각이 유효하지 않습니다.", archive, captures);
  }
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000
    || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) {
    return failure("METADATA_MISMATCH", "ECOS 이력 페이지 설정이 허용 범위를 벗어났습니다.", archive, captures);
  }
  const fetcher = input.fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) {
    return failure("UPSTREAM_UNAVAILABLE", "서버 fetch 구현이 없어 ECOS 이력 조회를 차단했습니다.", archive, captures);
  }

  let workingArchive = archive;
  let expectedTotal: number | null = null;
  const observationsByPeriod = new Map<string, { observation: MacroObservation; signature: string }>();
  for (let pageIndex = 0; ; pageIndex += 1) {
    if (pageIndex >= maxPages) {
      return failure("RESPONSE_TOO_LARGE", "ECOS 이력 페이지 수가 허용 한도를 초과했습니다.", workingArchive, captures);
    }
    const rowStart = pageIndex * pageSize + 1;
    const rowEnd = rowStart + pageSize - 1;
    const page = await readPage(input, fetcher, rowStart, rowEnd, workingArchive);
    if (!page.ok) {
      if (page.capture) captures.push(page.capture);
      return failure(page.code, page.message, page.archive, captures);
    }
    workingArchive = page.archive;
    captures.push(page.capture);
    const totalRaw = page.payload.StatisticSearch?.list_total_count;
    const total = typeof totalRaw === "number" ? totalRaw : Number(totalRaw);
    if (!Number.isSafeInteger(total) || total < 0) {
      return failure("RESPONSE_INVALID", "ECOS 이력 전체 건수가 유효하지 않습니다.", workingArchive, captures);
    }
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) {
      return failure("DATA_CONFLICT", "ECOS 페이지별 전체 건수가 서로 달라 이력 사용을 차단했습니다.", workingArchive, captures);
    }
    if (expectedTotal === 0) {
      return failure("DATA_MISSING", "선택 기간에 ECOS 이력 관측치가 없습니다.", workingArchive, captures);
    }
    const rows = page.payload.StatisticSearch?.row;
    if (!Array.isArray(rows)) {
      return failure("RESPONSE_INVALID", "ECOS 이력 관측 행 배열이 없습니다.", workingArchive, captures);
    }
    const remaining = Math.max(0, expectedTotal - rowStart + 1);
    const expectedRowsOnPage = Math.min(pageSize, remaining);
    if (rows.length !== expectedRowsOnPage) {
      return failure("DATA_CONFLICT", "ECOS 페이지 건수와 공식 전체 건수가 일치하지 않습니다.", workingArchive, captures);
    }
    for (const candidate of rows) {
      if (!candidate || typeof candidate !== "object") {
        return failure("RESPONSE_INVALID", "ECOS 이력 관측 행 형식이 유효하지 않습니다.", workingArchive, captures);
      }
      const parsed = observationFromRow(candidate as EcosStatisticRow, input.seriesId);
      if (!parsed) {
        const unit = (candidate as EcosStatisticRow).UNIT_NAME;
        const definition = getKoreaMacroDefinition(input.seriesId);
        const code: MacroFailureCode = unit !== definition.unit ? "UNIT_MISMATCH" : "METADATA_MISMATCH";
        return failure(code, "ECOS 이력 메타데이터·단위·수치가 allowlist 정의와 일치하지 않습니다.", workingArchive, captures);
      }
      const existing = observationsByPeriod.get(parsed.observation.observationDateRaw);
      if (existing && existing.signature !== parsed.signature) {
        return failure("DATA_CONFLICT", "같은 ECOS 기준기간에 서로 다른 값이 있어 이력 사용을 차단했습니다.", workingArchive, captures);
      }
      if (!existing) observationsByPeriod.set(parsed.observation.observationDateRaw, parsed);
    }
    if (rowEnd >= expectedTotal) break;
  }

  const observations = Array.from(observationsByPeriod.values())
    .map((entry) => entry.observation)
    .sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  if (observations.length !== expectedTotal) {
    return failure("DATA_CONFLICT", "ECOS 전체 건수와 고유 관측치 수가 일치하지 않습니다.", workingArchive, captures);
  }
  return {
    ok: true,
    observations,
    captures,
    archive: workingArchive,
    totalCount: expectedTotal,
  };
}
