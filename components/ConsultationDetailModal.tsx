"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Consultation, Client, IPS, IPSFactor, FactorKey } from "@/lib/types";
import { FACTOR_KEYS } from "@/lib/types";
import { updateConsultation } from "@/lib/store";
import { formatDateTime, formatDurationKo } from "@/lib/format";
import { consultationHasPbMemo } from "@/lib/advisory/consultationIpsDocument";
import { packIpsSnapshotPayload } from "@/lib/advisory/consultationIpsDocument";
import IPSForm from "./IPSForm";
import IpsA4Document from "./ips/IpsA4Document";

interface Props {
  consultation: Consultation | null;
  client?: Client | null;
  index?: number;
  onClose: () => void;
  onSaved: () => void;
}

function cloneIps(ips: IPS): IPS {
  return JSON.parse(JSON.stringify(ips)) as IPS;
}

// 개별 상담 상세 — 메모 전문 + 확정 IPS(A4). 선택 시 props 의 최신 행을 그대로 읽는다.
export default function ConsultationDetailModal({
  consultation,
  client,
  index,
  onClose,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IPS | null>(() =>
    consultation ? cloneIps(consultation.ipsSnapshot) : null,
  );
  const [notes, setNotes] = useState(() => consultation?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [docExpanded, setDocExpanded] = useState(false);

  useEffect(() => {
    if (consultation) {
      setDraft(cloneIps(consultation.ipsSnapshot));
      setNotes(consultation.notes ?? "");
      setEditing(false);
    } else {
      setDraft(null);
      setNotes("");
    }
  }, [consultation]);

  useEffect(() => {
    if (!consultation) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [consultation, onClose]);

  const documentSnap = consultation?.ipsDocumentSnapshot ?? null;
  const documentClient = useMemo(
    () => (documentSnap ? documentSnap.documentClient : null),
    [documentSnap],
  );

  if (!consultation || !draft) return null;
  const c = consultation;
  const hasMemo = consultationHasPbMemo(c);

  const filledKeys = FACTOR_KEYS.filter((k) => {
    const f = draft[k];
    return f.status !== "empty" && (f.value || f.score != null || f.inferenceHint);
  });
  const reviewedCount = filledKeys.filter((k) => draft[k].reviewed).length;
  const allReviewed = filledKeys.length > 0 && reviewedCount === filledKeys.length;

  const setAllReviewed = (reviewed: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneIps(prev);
      for (const k of FACTOR_KEYS) {
        const f = next[k];
        if (f.status !== "empty" && (f.value || f.score != null || f.inferenceHint)) {
          f.reviewed = reviewed;
        }
      }
      return next;
    });
  };

  const factorChange = (key: FactorKey, factor: IPSFactor) =>
    setDraft((prev) => (prev ? { ...prev, [key]: factor } : prev));

  const save = async () => {
    setSaving(true);
    try {
      // 메모·7요인만 갱신. 확정 IPS 문서 스냅샷(__ipsDocument)은 updateConsultation 이 보존.
      await updateConsultation(c.id, {
        notes,
        ipsSnapshot: draft,
        // 명시적으로 기존 문서 유지
        ipsDocumentSnapshot: c.ipsDocumentSnapshot ?? null,
      });
      // pack 검증 — 문서 키가 factors 와 함께 직렬화될 수 있는지 확인(로컬 개발 안전망)
      void packIpsSnapshotPayload(draft, c.ipsDocumentSnapshot ?? null);
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      alert("상담 수정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`flex w-full flex-col overflow-hidden bg-surface shadow-2xl sm:max-h-[94vh] sm:rounded-2xl ${
          docExpanded ? "max-w-5xl" : "max-w-3xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-navy-800 px-5 py-3 text-white dark:bg-navy-900">
          <div>
            <p className="text-sm font-bold">{index != null ? `상담 #${index}` : "상담 상세"}</p>
            <p className="text-[11px] text-white/60">
              {formatDateTime(c.createdAt)} · 소요 {formatDurationKo(c.durationSeconds)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!editing ? (
              <button
                className="rounded-md bg-white/10 px-3 py-1 text-xs font-medium hover:bg-white/20"
                onClick={() => setEditing(true)}
              >
                메모 수정
              </button>
            ) : (
              <span className="text-[11px] text-gold-300">메모·7요인 편집 중</span>
            )}
            <button
              className="rounded-full px-3 py-1 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* 1) 상담 메모 (전문) — consultation.notes 단일 소스 */}
          <div>
            <p className="mb-1 text-sm font-semibold text-fg-muted">상담 메모 (전문)</p>
            {editing ? (
              <textarea
                className="input min-h-[120px] resize-y whitespace-pre-wrap text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : hasMemo ? (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-sm text-fg">
                {c.notes}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">기록된 메모 없음</p>
            )}
          </div>

          {/* 2) 확정 IPS — IpsA4Document. 레거시는 정직한 안내. */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-fg-muted">확정 IPS</p>
              {documentSnap && (
                <button
                  type="button"
                  className="btn-outline text-[11px]"
                  onClick={() => setDocExpanded((v) => !v)}
                >
                  {docExpanded ? "미리보기 축소" : "원본 크게 보기"}
                </button>
              )}
            </div>

            {documentClient && documentSnap ? (
              <div className="-mx-1 overflow-x-auto rounded-lg border border-border bg-[#F7F8FA] p-2 sm:mx-0 sm:p-3">
                <div className="min-w-[210mm]">
                  <IpsA4Document
                    documentClient={documentClient}
                    documentPbDisplay={documentSnap.pbDisplayName}
                    investableWon={documentSnap.investableWon}
                    dateStr={documentSnap.dateStr}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-5">
                <p className="text-sm font-semibold text-fg">
                  이 상담에는 저장된 확정 IPS가 없습니다.
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  상담 완료 시점에 포트폴리오·IPS 승인이 없었던 기록이거나, 이전 버전에서 저장된
                  이력입니다. 현재 고객 데이터로 문서를 만들어 보여 주지 않습니다.
                </p>
                {client && (
                  <Link
                    href={`/pb/${client.assignedPbId}/${client.id}/ips?mode=draft`}
                    className="mt-3 inline-block text-xs font-semibold text-[#0D57BA] underline"
                  >
                    현재 IPS 보기 (참고 · 이 상담의 확정본이 아님)
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* 편집 시에만 7요인 — 확정 IPS 대체가 아님을 명시 */}
          {editing && (
            <div>
              <p className="mb-2 text-sm font-semibold text-fg-muted">
                이 상담 시점의 RRTTLLU 7요인{" "}
                <span className="font-normal text-[11px]">(추세 그래프용 · 확정 IPS 아님)</span>
              </p>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold-400/60 bg-gold-50 px-4 py-2.5 dark:bg-gold-900/20">
                <span className="text-sm text-fg">
                  검토 확정{" "}
                  <b className="text-gold-700 dark:text-gold-200">
                    {reviewedCount} / {filledKeys.length}
                  </b>
                </span>
                <button
                  className="btn-gold text-xs"
                  onClick={() => setAllReviewed(!allReviewed)}
                  disabled={filledKeys.length === 0}
                >
                  {allReviewed ? "전체 확정 해제" : "모두 검토 확정"}
                </button>
              </div>
              <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                이 편집은 상담 기록의 7요인 스냅샷만 바꿉니다. 위에 표시된 확정 IPS 문서는 바뀌지
                않습니다.
              </p>
              <IPSForm ips={draft} readOnly={false} onChange={factorChange} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          {editing ? (
            <>
              <button
                className="btn-outline text-sm"
                onClick={() => {
                  setDraft(cloneIps(c.ipsSnapshot));
                  setNotes(c.notes);
                  setEditing(false);
                }}
                disabled={saving}
              >
                되돌리기
              </button>
              <button className="btn-gold text-sm" onClick={save} disabled={saving}>
                {saving ? "저장 중…" : "상담 기록 저장 ✓"}
              </button>
            </>
          ) : (
            <button className="btn-outline text-sm" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
