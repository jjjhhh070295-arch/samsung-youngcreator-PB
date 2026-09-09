/**
 * 상담별 확정 IPS 문서 스냅샷.
 *
 * DB 컬럼은 consultations.ips_snapshot(jsonb) 하나만 쓴다.
 * - 최상위 키: 기존처럼 RRTTLLU 7요인 (TrendChart / 레거시 호환)
 * - __ipsDocument: IpsA4Document 에 필요한 불변 문서 스냅샷
 *
 * 컬럼 마이그레이션 없이 배포 가능. 레거시 행은 문서 필드가 없다.
 */

import type { Client, Consultation, IPS, Portfolio } from "../types";
import { FACTOR_KEYS, emptyIPS } from "../types";
import {
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "./workflowApprovals";

export const IPS_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const IPS_DOCUMENT_PAYLOAD_KEY = "__ipsDocument" as const;

export type IpsDocumentSnapshot = {
  schemaVersion: typeof IPS_DOCUMENT_SCHEMA_VERSION;
  consultationId: string;
  capturedAt: string;
  approvedAt: string | null;
  pbDisplayName: string;
  investableWon: number | null;
  approvalHashes?: {
    basic?: string;
    portfolio?: string;
    ips?: string;
  };
  /** IpsA4Document 가 읽는 고객 스냅샷 — 이후 Client 변경과 분리 */
  documentClient: Client;
  dateStr: string;
};

export type PackedIpsSnapshot = IPS & {
  [IPS_DOCUMENT_PAYLOAD_KEY]?: IpsDocumentSnapshot;
};

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 문서/차트에 필요한 Client 필드만 동결. 가변 참조를 끊는다. */
export function freezeDocumentClient(client: Client): Client {
  const cloned = deepClone(client);
  // 상담 메모는 고객 최신이 아니라 문서 시점 값 — 비워 문서와 상담 메모를 섞지 않는다.
  cloned.consultationNotes = "";
  return cloned;
}

export function formatIpsDocumentDate(iso = new Date().toISOString()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  }
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function canCaptureFinalizedIpsDocument(client: Client): boolean {
  return isPortfolioWorkflowApproved(client) && isIpsWorkflowApproved(client);
}

export function buildIpsDocumentSnapshot(input: {
  consultationId: string;
  client: Client;
  pbDisplayName: string;
  investableWon: number | null;
  capturedAt?: string;
}): IpsDocumentSnapshot | null {
  if (!canCaptureFinalizedIpsDocument(input.client)) return null;
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const pf = input.client.portfolios[0] as Portfolio | undefined;
  const approvedAt =
    pf?.confirmedAt ||
    (input.client.stages?.ips ? capturedAt : null);
  return {
    schemaVersion: IPS_DOCUMENT_SCHEMA_VERSION,
    consultationId: input.consultationId,
    capturedAt,
    approvedAt,
    pbDisplayName: input.pbDisplayName.trim() || "담당 PB",
    investableWon:
      input.investableWon != null && Number.isFinite(input.investableWon)
        ? input.investableWon
        : null,
    approvalHashes: input.client.approvalHashes
      ? deepClone(input.client.approvalHashes)
      : undefined,
    documentClient: freezeDocumentClient(input.client),
    dateStr: formatIpsDocumentDate(approvedAt ?? capturedAt),
  };
}

export function extractFactorsFromRaw(raw: unknown): IPS {
  if (!raw || typeof raw !== "object") return emptyIPS();
  const obj = raw as Record<string, unknown>;
  // 구형: 7요인이 최상위. 신형 envelope 도 동일.
  const hasFactor = FACTOR_KEYS.some((k) => obj[k] && typeof obj[k] === "object");
  if (!hasFactor) return emptyIPS();
  const ips = emptyIPS();
  for (const key of FACTOR_KEYS) {
    const f = obj[key];
    if (f && typeof f === "object") {
      ips[key] = { ...ips[key], ...(f as object) } as IPS[typeof key];
    }
  }
  return ips;
}

export function extractDocumentFromRaw(raw: unknown): IpsDocumentSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = (raw as Record<string, unknown>)[IPS_DOCUMENT_PAYLOAD_KEY];
  if (!doc || typeof doc !== "object") return null;
  const snap = doc as IpsDocumentSnapshot;
  if (snap.schemaVersion !== IPS_DOCUMENT_SCHEMA_VERSION) return null;
  if (!snap.documentClient || typeof snap.documentClient !== "object") return null;
  if (!snap.consultationId) return null;
  return deepClone(snap);
}

export function packIpsSnapshotPayload(
  factors: IPS,
  document?: IpsDocumentSnapshot | null,
): PackedIpsSnapshot {
  const packed: PackedIpsSnapshot = deepClone(factors);
  if (document) {
    packed[IPS_DOCUMENT_PAYLOAD_KEY] = deepClone(document);
  }
  return packed;
}

export function unpackIpsSnapshotPayload(raw: unknown): {
  ipsSnapshot: IPS;
  ipsDocumentSnapshot: IpsDocumentSnapshot | null;
} {
  return {
    ipsSnapshot: extractFactorsFromRaw(raw),
    ipsDocumentSnapshot: extractDocumentFromRaw(raw),
  };
}

/**
 * 메모만 수정할 때 기존 문서 스냅샷을 유지한 채 factors 만 갱신.
 * factors 패치가 없으면 기존 factors 유지.
 */
export function mergeIpsSnapshotForUpdate(input: {
  previousRawOrPacked: unknown;
  previousDocument?: IpsDocumentSnapshot | null;
  nextFactors?: IPS;
  nextDocument?: IpsDocumentSnapshot | null | undefined;
  /** true 면 문서를 명시적으로 비움(일반 경로에서는 쓰지 않음) */
  clearDocument?: boolean;
}): PackedIpsSnapshot {
  const prev = unpackIpsSnapshotPayload(input.previousRawOrPacked);
  const factors = input.nextFactors ?? prev.ipsSnapshot;
  if (input.clearDocument) {
    return packIpsSnapshotPayload(factors, null);
  }
  const document =
    input.nextDocument !== undefined
      ? input.nextDocument
      : input.previousDocument !== undefined
        ? input.previousDocument
        : prev.ipsDocumentSnapshot;
  return packIpsSnapshotPayload(factors, document);
}

export function consultationHasPbMemo(c: Pick<Consultation, "notes">): boolean {
  return Boolean(c.notes?.trim());
}

/** sessionStorage — ConsultationModal 이 만든 상담 ID 를 완료 단계까지 전달 */
export function activeConsultationStorageKey(clientId: string): string {
  return `pb-active-consultation:${clientId}`;
}

export function rememberActiveConsultationId(clientId: string, consultationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(activeConsultationStorageKey(clientId), consultationId);
  } catch {
    /* ignore quota */
  }
}

export function readActiveConsultationId(clientId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(activeConsultationStorageKey(clientId));
  } catch {
    return null;
  }
}

export function clearActiveConsultationId(clientId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(activeConsultationStorageKey(clientId));
  } catch {
    /* ignore */
  }
}
