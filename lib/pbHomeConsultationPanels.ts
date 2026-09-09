/**
 * PB Home 고객 구성 · 상담로그 패널용 순수 셀렉터.
 * 네트워크 호출 없이 이미 로드된 clients/consultations 를 집계한다.
 */

import type { Client, Consultation } from "@/lib/types";
import { canIssueClientPdf, loadBundle } from "@/lib/advisory/control";
import { isIpsWorkflowApproved } from "@/lib/advisory/workflowApprovals";

export type ClientCompositionCounts = {
  individual: number;
  corporate: number;
  soleProprietor: number;
  total: number;
};

export type ClientListRow = {
  id: string;
  name: string;
  code: string;
  clientType: Client["clientType"];
  consultationCount: number;
  latestConsultationAt: string | null;
};

export function filterAssignedClients(clients: Client[], pbId: string): Client[] {
  return clients.filter((c) => c.assignedPbId === pbId);
}

export function compositionCounts(clients: Client[]): ClientCompositionCounts {
  return {
    individual: clients.filter((c) => c.clientType === "individual").length,
    corporate: clients.filter((c) => c.clientType === "corporate").length,
    soleProprietor: clients.filter((c) => c.clientType === "sole_proprietor").length,
    total: clients.length,
  };
}

/** 한글 이름 오름차순 → 코드 오름차순 */
export function sortClientsForPbHome(clients: Client[]): Client[] {
  return clients.slice().sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "ko");
    if (byName !== 0) return byName;
    return a.code.localeCompare(b.code, "ko");
  });
}

export function consultationsForClient(opts: {
  consultations: Consultation[];
  pbId: string;
  clientId: string;
  assignedClientIds: Set<string>;
}): Consultation[] {
  const { consultations, pbId, clientId, assignedClientIds } = opts;
  if (!assignedClientIds.has(clientId)) return [];
  return consultations
    .filter((c) => c.clientId === clientId && c.pbId === pbId && assignedClientIds.has(c.clientId))
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0));
}

export function buildClientListRows(
  clients: Client[],
  consultations: Consultation[],
  pbId: string,
): ClientListRow[] {
  const assigned = sortClientsForPbHome(filterAssignedClients(clients, pbId));
  const assignedIds = new Set(assigned.map((c) => c.id));
  return assigned.map((client) => {
    const logs = consultationsForClient({
      consultations,
      pbId,
      clientId: client.id,
      assignedClientIds: assignedIds,
    });
    return {
      id: client.id,
      name: client.name,
      code: client.code,
      clientType: client.clientType,
      consultationCount: logs.length,
      latestConsultationAt: logs[0]?.createdAt ?? null,
    };
  });
}

export function memoPreview(notes: string | null | undefined, max = 48): string {
  const trimmed = (notes ?? "").trim();
  if (!trimmed) return "";
  const oneLine = trimmed.replace(/\s+/g, " ");
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * 최종 IPS 열람 가능 여부.
 * consultation.ipsSnapshot 존재만으로는 true가 되지 않는다.
 */
export function canViewFinalIps(client: Client | null | undefined, pbId: string): boolean {
  if (!client) return false;
  if (client.assignedPbId !== pbId) return false;
  if (!isIpsWorkflowApproved(client)) return false;
  try {
    const bundle = loadBundle(client.id);
    return canIssueClientPdf(bundle);
  } catch {
    return false;
  }
}

/** 선택 ID가 여전히 담당 고객이면 유지, 아니면 null */
export function sanitizeSelectedClientId(
  selectedClientId: string | null,
  assignedClientIds: Set<string>,
): string | null {
  if (!selectedClientId) return null;
  return assignedClientIds.has(selectedClientId) ? selectedClientId : null;
}

/**
 * notes 만 바꾼 복사본을 만든다. ipsSnapshot 은 동일 참조로 유지한다.
 * 소유권 불일치 시 throw.
 */
export function patchConsultationNotesOnly(
  existing: Consultation,
  opts: { pbId: string; clientId: string; notes: string },
): Consultation {
  if (existing.pbId !== opts.pbId || existing.clientId !== opts.clientId) {
    throw new Error("다른 PB·고객의 상담 메모는 수정할 수 없습니다.");
  }
  const notes = opts.notes.replace(/^\s+|\s+$/g, "");
  return { ...existing, notes };
}
