"use client";

import { useEffect, useState } from "react";
import type { Client, IPS } from "@/lib/types";
import { finalizeConsultationRecord, updateClient } from "@/lib/store";
import {
  buildIpsDocumentSnapshot,
  canCaptureFinalizedIpsDocument,
  clearActiveConsultationId,
  readActiveConsultationId,
} from "@/lib/advisory/consultationIpsDocument";

interface Props {
  open: boolean;
  client: Client;
  pbId: string;
  pbDisplayName: string;
  investableWon: number | null;
  /** 상담 모달에서 이미 입력한 메모를 시드로 사용 */
  initialNotes?: string;
  consultationId?: string | null;
  ipsSnapshot?: IPS;
  startedAt?: string;
  durationSeconds?: number;
  onClose: () => void;
  onCompleted: (consultationId: string) => void;
}

/**
 * IPS·포트폴리오 승인 후 PB 메모와 확정 IPS 문서를 같은 상담 ID 에 저장한다.
 */
export default function ConsultationCompletionModal({
  open,
  client,
  pbId,
  pbDisplayName,
  investableWon,
  initialNotes = "",
  consultationId,
  ipsSnapshot,
  startedAt,
  durationSeconds,
  onClose,
  onCompleted,
}: Props) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setNotes(initialNotes);
      setError("");
      setSaving(false);
    }
  }, [open, initialNotes]);

  if (!open) return null;

  const canFinalizeIps = canCaptureFinalizedIpsDocument(client);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      if (!canFinalizeIps) {
        setError("포트폴리오·IPS 승인이 완료된 뒤에만 확정 IPS를 저장할 수 있습니다.");
        return;
      }

      const trackedId =
        consultationId || readActiveConsultationId(client.id) || undefined;
      const factors = ipsSnapshot ?? client.ips;

      const finalized = await finalizeConsultationRecord({
        consultationId: trackedId,
        clientId: client.id,
        pbId,
        notes,
        ipsSnapshot: factors,
        startedAt,
        durationSeconds,
        buildDocument: (id) =>
          buildIpsDocumentSnapshot({
            consultationId: id,
            client,
            pbDisplayName,
            investableWon,
          }),
      });

      if (!finalized.ipsDocumentSnapshot) {
        throw new Error("확정 IPS 스냅샷 저장에 실패했습니다.");
      }

      // 고객 최신 메모는 별도 유지 — 이력 notes 의 대체재가 아니다.
      await updateClient(client.id, { consultationNotes: notes });
      clearActiveConsultationId(client.id);
      onCompleted(finalized.id);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "상담 완료 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border bg-navy-800 px-5 py-3 text-white dark:bg-navy-900">
          <p className="text-sm font-bold">상담 완료 · PB 메모</p>
          <p className="text-[11px] text-white/60">
            {client.name} · 이 메모와 확정 IPS가 같은 상담 이력에 저장됩니다
          </p>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-xs text-fg-muted">
            포트폴리오·IPS 승인이 끝난 상담의 최종 메모입니다. 줄바꿈과 긴 내용이 그대로 보존됩니다.
          </p>
          <textarea
            className="input min-h-[160px] resize-y whitespace-pre-wrap text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="PB 상담 메모를 입력하세요"
            autoFocus
          />
          {!canFinalizeIps && (
            <p className="text-xs font-semibold text-red-600">
              포트폴리오와 IPS 승인이 필요합니다. 승인 후 다시 완료해 주세요.
            </p>
          )}
          {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className="btn-outline text-sm" onClick={onClose} disabled={saving}>
            나중에
          </button>
          <button
            type="button"
            className="btn-gold text-sm"
            onClick={() => void save()}
            disabled={saving || !canFinalizeIps}
          >
            {saving ? "저장 중…" : "상담 완료 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
