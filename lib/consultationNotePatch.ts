import type { Consultation } from "./types";

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
