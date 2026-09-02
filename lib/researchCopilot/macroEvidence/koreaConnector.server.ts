import { createHash } from "node:crypto";
import {
  getKoreaMacroDefinition,
  type KoreaMacroSeriesId,
  type SourceProvidedStatus,
} from "./koreaRegistry";
import type {
  MacroObservation,
  MacroSeriesBlocked,
  MacroSeriesEvidence,
  MacroSeriesResult,
  RawMacroCapture,
  SanitizedMacroRequest,
} from "./types";

export type KoreaMacroCaptureIssueCode =
  | "KEY_MISSING"
  | "RAW_RESPONSE_MISSING"
  | "INVALID_CAPTURE_METADATA";

export interface KoreaMacroCaptureIssue {
  code: KoreaMacroCaptureIssueCode;
  message: string;
}

/**
 * 공통 RawMacroCapture를 감싸는 ECOS 증거 레코드입니다. 원본 바이트는
 * raw.rawBase64에 정확히 보존하고, ECOS가 제공하지 않는 필드는 별도로
 * source_not_provided 상태를 유지합니다.
 */
export interface KoreaMacroRawCapture {
  captureId: string;
  queryKey: string;
  seriesId: KoreaMacroSeriesId;
  requestedStartPeriod: string;
  requestedEndPeriod: string;
  raw: RawMacroCapture;
  sourceUrl: string;
  releaseDate: SourceProvidedStatus;
  vintageDate: SourceProvidedStatus;
  preliminaryFinal: SourceProvidedStatus;
  revisionStatus: SourceProvidedStatus;
  revisionDetection: "not_detected" | "hash_changed";
  supersedesCaptureId: string | null;
}

export interface KoreaMacroCaptureInput {
  seriesId: KoreaMacroSeriesId;
  requestedStartPeriod: string;
  requestedEndPeriod: string;
  rawBytes: Uint8Array | readonly number[];
  retrievedAt: string;
  environment: object;
  responseStatus?: number;
  contentType?: string;
}

/**
 * 보안 경계: 환경변수 값에는 접근하지 않고 바인딩의 존재만 확인한다.
 * 실제 네트워크 어댑터도 키를 로그·응답·오류 문구에 포함하면 안 된다.
 */
export function hasEcosApiKeyBinding(environment: object): boolean {
  return Object.prototype.hasOwnProperty.call(environment, "ECOS_API_KEY");
}

function validIsoInstant(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function exactBytes(input: Uint8Array | readonly number[]): Buffer {
  return Buffer.from(input);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sanitizedRequest(input: KoreaMacroCaptureInput): SanitizedMacroRequest {
  const definition = getKoreaMacroDefinition(input.seriesId);
  return {
    providerId: "ecos",
    operation: "StatisticSearch",
    seriesIds: [input.seriesId],
    frequency: definition.frequency,
    startDate: input.requestedStartPeriod,
    endDate: input.requestedEndPeriod,
  };
}

export function captureKoreaMacroRawResponse(
  input: KoreaMacroCaptureInput,
): { ok: true; capture: KoreaMacroRawCapture } | { ok: false; issues: KoreaMacroCaptureIssue[] } {
  if (!hasEcosApiKeyBinding(input.environment)) {
    return {
      ok: false,
      issues: [{ code: "KEY_MISSING", message: "서버 전용 ECOS 인증 바인딩이 없어 수집을 차단했습니다." }],
    };
  }

  const responseStatus = input.responseStatus ?? 200;
  const contentType = input.contentType ?? "application/json";
  if (!input.requestedStartPeriod.trim()
    || !input.requestedEndPeriod.trim()
    || !validIsoInstant(input.retrievedAt)
    || !Number.isInteger(responseStatus)
    || responseStatus < 100
    || responseStatus > 599
    || !contentType.trim()) {
    return {
      ok: false,
      issues: [{ code: "INVALID_CAPTURE_METADATA", message: "조회 기간 또는 수집시각이 유효하지 않아 원본을 보존하지 않았습니다." }],
    };
  }

  const rawBytes = exactBytes(input.rawBytes);
  if (rawBytes.length === 0) {
    return {
      ok: false,
      issues: [{ code: "RAW_RESPONSE_MISSING", message: "원본 응답 바이트가 없어 결과 사용을 차단했습니다." }],
    };
  }

  const series = getKoreaMacroDefinition(input.seriesId);
  const contentHash = sha256(rawBytes);
  const queryKey = [input.seriesId, input.requestedStartPeriod, input.requestedEndPeriod].join(":");
  const captureId = `macro-raw:ecos:${queryKey}:${contentHash}`;
  const raw: RawMacroCapture = Object.freeze({
    captureId,
    providerId: "ecos",
    rawBase64: rawBytes.toString("base64"),
    contentHash,
    bodyByteLength: rawBytes.byteLength,
    retrievedAt: input.retrievedAt,
    responseStatus,
    contentType,
    sanitizedRequest: sanitizedRequest(input),
  });
  return {
    ok: true,
    capture: Object.freeze({
      captureId,
      queryKey,
      seriesId: input.seriesId,
      requestedStartPeriod: input.requestedStartPeriod,
      requestedEndPeriod: input.requestedEndPeriod,
      raw,
      sourceUrl: series.sourceUrl,
      releaseDate: series.releaseDate,
      vintageDate: series.vintageDate,
      preliminaryFinal: series.preliminaryFinal,
      revisionStatus: series.revisionStatus,
      revisionDetection: "not_detected",
      supersedesCaptureId: null,
    }),
  };
}

function sameRawCapture(left: RawMacroCapture, right: RawMacroCapture): boolean {
  return left.contentHash === right.contentHash
    && left.rawBase64 === right.rawBase64
    && left.bodyByteLength === right.bodyByteLength
    && left.responseStatus === right.responseStatus
    && left.contentType === right.contentType
    && JSON.stringify(left.sanitizedRequest) === JSON.stringify(right.sanitizedRequest);
}

/**
 * 동일 원본은 멱등 처리한다. 같은 조회 범위의 바이트가 바뀌면 공식 수정 여부를
 * 추론하지 않고 hash_changed로 별도 보존하며, 기존 원본은 절대 덮어쓰지 않는다.
 */
export function preserveKoreaMacroRawCapture(
  archive: readonly KoreaMacroRawCapture[],
  incoming: KoreaMacroRawCapture,
): { archive: readonly KoreaMacroRawCapture[]; entry: KoreaMacroRawCapture; created: boolean; revisionDetected: boolean } {
  const exact = archive.find(
    (entry) => entry.queryKey === incoming.queryKey && sameRawCapture(entry.raw, incoming.raw),
  );
  if (exact) {
    return { archive, entry: exact, created: false, revisionDetected: false };
  }

  const previous = [...archive].reverse().find((entry) => entry.queryKey === incoming.queryKey);
  const entry: KoreaMacroRawCapture = previous
    ? Object.freeze({
        ...incoming,
        revisionDetection: "hash_changed",
        supersedesCaptureId: previous.captureId,
      })
    : incoming;
  return {
    archive: Object.freeze([...archive, entry]),
    entry,
    created: true,
    revisionDetected: Boolean(previous),
  };
}

interface EcosStatisticRow {
  STAT_CODE?: unknown;
  ITEM_CODE1?: unknown;
  UNIT_NAME?: unknown;
  TIME?: unknown;
  DATA_VALUE?: unknown;
}

interface EcosStatisticPayload {
  StatisticSearch?: {
    row?: unknown;
  };
}

export interface KoreaMacroFetchResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type KoreaMacroFetch = (
  input: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<KoreaMacroFetchResponse>;

export interface FetchKoreaMacroSeriesInput {
  seriesId: KoreaMacroSeriesId;
  requestedStartPeriod: string;
  requestedEndPeriod: string;
  /** 서버가 비밀 저장소에서 주입하는 불투명 값. 함수는 URL 조립 외에 읽거나 반환하지 않는다. */
  credential: string;
  retrievedAt: string;
  nowIso: string;
  fetcher?: KoreaMacroFetch;
  maxResponseBytes?: number;
}

export type FetchKoreaMacroSeriesResult =
  { result: MacroSeriesResult; capture?: KoreaMacroRawCapture };

function blockedSeries(
  seriesId: KoreaMacroSeriesId,
  code: MacroSeriesBlocked["code"],
  message: string,
): MacroSeriesBlocked {
  const definition = getKoreaMacroDefinition(seriesId);
  return {
    status: "blocked",
    seriesId,
    sectionId: "korea-macro",
    title: definition.label,
    code,
    message,
    sourceUrl: definition.sourceUrl,
    rightsStatus: "pb-internal-use-approved",
  };
}

function normalizedObservationDate(raw: string, frequency: "D" | "M" | "Q"): string | null {
  if (frequency === "D") {
    if (!/^\d{8}$/.test(raw)) return null;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
  }
  if (frequency === "M") {
    if (!/^\d{6}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6));
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  const match = raw.match(/^(\d{4})Q([1-4])$/i);
  if (!match) return null;
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const month = quarter * 3;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function validNumericRaw(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())
    && Number.isFinite(Number(value));
}

function observationFreshness(
  observationDate: string,
  nowIso: string,
  staleAfterDays: number,
): "ok" | "invalid" | "stale" {
  const observedAt = Date.parse(`${observationDate}T23:59:59.999Z`);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(observedAt) || !Number.isFinite(now) || observedAt > now) return "invalid";
  return (now - observedAt) / 86_400_000 > staleAfterDays ? "stale" : "ok";
}

function parseEcosEvidence(
  seriesId: KoreaMacroSeriesId,
  rawBytes: Uint8Array,
  retrievedAt: string,
  contentHash: string,
  nowIso: string,
): MacroSeriesResult {
  const definition = getKoreaMacroDefinition(seriesId);
  let payload: EcosStatisticPayload;
  try {
    payload = JSON.parse(Buffer.from(rawBytes).toString("utf8")) as EcosStatisticPayload;
  } catch {
    return blockedSeries(seriesId, "RESPONSE_INVALID", "ECOS 응답이 유효한 JSON이 아니어서 사용을 차단했습니다.");
  }
  const rows = payload.StatisticSearch?.row;
  if (!Array.isArray(rows) || rows.length === 0) {
    return blockedSeries(seriesId, "DATA_MISSING", "ECOS 응답에 요청한 관측치가 없습니다.");
  }
  const observations: MacroObservation[] = [];
  const seenPeriods = new Map<string, string>();
  for (const candidate of rows) {
    if (!candidate || typeof candidate !== "object") {
      return blockedSeries(seriesId, "RESPONSE_INVALID", "ECOS 관측 행 형식이 유효하지 않습니다.");
    }
    const row = candidate as EcosStatisticRow;
    if (row.STAT_CODE !== definition.statCode
      || !definition.itemCodes.includes(String(row.ITEM_CODE1))
      || row.UNIT_NAME !== definition.unit) {
      return blockedSeries(seriesId, row.UNIT_NAME !== definition.unit ? "UNIT_MISMATCH" : "METADATA_MISMATCH", "ECOS 응답 메타데이터가 allowlist 정의와 일치하지 않습니다.");
    }
    if (typeof row.TIME !== "string" || typeof row.DATA_VALUE !== "string") {
      return blockedSeries(seriesId, "DATA_MISSING", "기준일 또는 수치 원문이 누락되었습니다.");
    }
    const observationDate = normalizedObservationDate(row.TIME, definition.frequency);
    if (!observationDate || !validNumericRaw(row.DATA_VALUE)) {
      return blockedSeries(seriesId, "RESPONSE_INVALID", "기준일 또는 수치 원문을 안전하게 해석할 수 없습니다.");
    }
    const periodSignature = JSON.stringify({
      statCode: row.STAT_CODE,
      itemCode: row.ITEM_CODE1,
      unit: row.UNIT_NAME,
      valueRaw: row.DATA_VALUE,
    });
    const existingSignature = seenPeriods.get(row.TIME);
    if (existingSignature && existingSignature !== periodSignature) {
      return blockedSeries(seriesId, "DATA_CONFLICT", "같은 ECOS 기준기간에 서로 다른 값이 있어 결과 사용을 차단했습니다.");
    }
    if (existingSignature === periodSignature) continue;
    seenPeriods.set(row.TIME, periodSignature);
    observations.push({
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
    });
  }
  observations.sort((left, right) => left.observationDate.localeCompare(right.observationDate));
  const latestObservation = observations.at(-1)!;
  const freshness = observationFreshness(latestObservation.observationDate, nowIso, definition.staleAfterDays);
  if (freshness === "invalid") {
    return blockedSeries(seriesId, "METADATA_MISMATCH", "최신 관측일 또는 검증 시각이 유효하지 않습니다.");
  }
  if (freshness === "stale") {
    return blockedSeries(seriesId, "STALE", "최신 관측치가 허용된 최신성 범위를 벗어났습니다.");
  }
  return {
    status: "ready",
    mode: "official-live",
    seriesId,
    sectionId: "korea-macro",
    providerId: "ecos",
    provider: "한국은행 경제통계시스템(ECOS)",
    title: definition.label,
    frequency: definition.frequency,
    unit: definition.unit,
    definitionVersion: definition.definitionId,
    observations,
    latestObservation,
    sourceUrl: definition.sourceUrl,
    retrievedAt,
    contentHash,
    rightsStatus: "pb-internal-use-approved",
    isEducationalFixture: false,
  };
}

function credentialedEcosUrl(input: FetchKoreaMacroSeriesInput): string {
  const definition = getKoreaMacroDefinition(input.seriesId);
  const itemPath = definition.itemCodes.map(encodeURIComponent).join("/");
  return `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(input.credential)}/json/kr/1/1000/${definition.statCode}/${definition.frequency}/${encodeURIComponent(input.requestedStartPeriod)}/${encodeURIComponent(input.requestedEndPeriod)}/${itemPath}`;
}

/**
 * ECOS StatisticSearch의 서버 전용 수집 경계. credential은 URL에만 주입하고
 * 결과·원본 manifest·오류 문구에는 포함하지 않는다. 테스트는 fetcher를 주입한다.
 */
export async function fetchKoreaMacroSeries(
  input: FetchKoreaMacroSeriesInput,
): Promise<FetchKoreaMacroSeriesResult> {
  if (!input.credential) {
    return { result: blockedSeries(input.seriesId, "KEY_MISSING", "서버 전용 ECOS 인증키가 없어 수집을 차단했습니다.") };
  }
  const fetcher = input.fetcher ?? (globalThis.fetch as unknown as KoreaMacroFetch);
  let response: KoreaMacroFetchResponse;
  try {
    response = await fetcher(credentialedEcosUrl(input), {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch {
    return { result: blockedSeries(input.seriesId, "UPSTREAM_UNAVAILABLE", "ECOS 호출에 실패하여 결과 사용을 차단했습니다.") };
  }
  const maxResponseBytes = input.maxResponseBytes ?? 2_000_000;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    return { result: blockedSeries(input.seriesId, "RESPONSE_TOO_LARGE", "ECOS 응답이 허용 크기를 초과해 수집을 차단했습니다.") };
  }
  let rawBytes: Uint8Array;
  try {
    rawBytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    return { result: blockedSeries(input.seriesId, "RESPONSE_INVALID", "ECOS 원본 응답을 읽지 못했습니다.") };
  }
  if (rawBytes.byteLength === 0) {
    return { result: blockedSeries(input.seriesId, "DATA_MISSING", "ECOS 원본 응답이 비어 있어 사용을 차단했습니다.") };
  }
  if (rawBytes.byteLength > maxResponseBytes) {
    return { result: blockedSeries(input.seriesId, "RESPONSE_TOO_LARGE", "ECOS 응답이 허용 크기를 초과해 수집을 차단했습니다.") };
  }
  const contentType = response.headers.get("content-type") ?? "";
  const captured = captureKoreaMacroRawResponse({
    seriesId: input.seriesId,
    requestedStartPeriod: input.requestedStartPeriod,
    requestedEndPeriod: input.requestedEndPeriod,
    rawBytes,
    retrievedAt: input.retrievedAt,
    environment: { ECOS_API_KEY: true },
    responseStatus: response.status,
    contentType: contentType || "application/octet-stream",
  });
  if (!captured.ok) {
    return { result: blockedSeries(input.seriesId, "RESPONSE_INVALID", captured.issues[0]?.message ?? "ECOS 원본을 보존하지 못했습니다.") };
  }
  if (!response.ok) {
    return {
      result: blockedSeries(input.seriesId, "UPSTREAM_UNAVAILABLE", `ECOS가 정상 응답을 반환하지 않았습니다(status ${response.status}).`),
      capture: captured.capture,
    };
  }
  if (!contentType.toLowerCase().includes("json")) {
    return {
      result: blockedSeries(input.seriesId, "RESPONSE_INVALID", "ECOS 응답 형식이 JSON이 아니어서 사용을 차단했습니다."),
      capture: captured.capture,
    };
  }
  return {
    result: parseEcosEvidence(
      input.seriesId,
      rawBytes,
      input.retrievedAt,
      captured.capture.raw.contentHash,
      input.nowIso,
    ),
    capture: captured.capture,
  };
}
