"use client";

import { useEffect, useState } from "react";
import type { Consultation, Client, IPS, IPSFactor, FactorKey } from "@/lib/types";
import { FACTOR_KEYS } from "@/lib/types";
import { updateConsultation } from "@/lib/store";
import { formatDateTime, formatDurationKo, formatKRW } from "@/lib/format";
import IPSForm from "./IPSForm";

interface Props {
  consultation: Consultation | null;
  client?: Client | null; // 현재 현금흐름·포트폴리오 참고 표시용
  index?: number;
  onClose: () => void;
  onSaved: () => void; // 저장 후 상위 새로고침
}

function cloneIps(ips: IPS): IPS {
  return JSON.parse(JSON.stringify(ips)) as IPS;
}

// 개별 상담 상세 — 조회 + 수정 + 검토 확정.
export default function ConsultationDetailModal({
  consultation,
  client,
  index,
  onClose,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IPS | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (consultation) {
      setDraft(cloneIps(consultation.ipsSnapshot));
      setNotes(consultation.notes);
      setEditing(false);
    }
  }, [consultation]);

  useEffect(() => {
    if (!consultation) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [consultation, onClose]);

  if (!consultation || !draft) return null;
  const c = consultation;

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
      await updateConsultation(c.id, { notes, ipsSnapshot: draft });
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
        className="flex w-full max-w-2xl flex-col overflow-hidden bg-surface shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
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
                수정 / 확정
              </button>
            ) : (
              <span className="text-[11px] text-gold-300">
                검토 확정 {reviewedCount}/{filledKeys.length}
              </span>
            )}
            <button
              className="rounded-full px-3 py-1 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* 메모 */}
          <div>
            <p className="mb-1 text-sm font-semibold text-fg-muted">상담 메모 (전문)</p>
            {editing ? (
              <textarea
                className="input min-h-[100px] resize-y text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : c.notes ? (
              <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-fg">
                {c.notes}
              </p>
            ) : (
              <p className="text-xs text-fg-muted">기록된 메모 없음</p>
            )}
          </div>

          {/* 검토 확정 바 (편집 시) */}
          {editing && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold-400/60 bg-gold-50 px-4 py-2.5 dark:bg-gold-900/20">
              <span className="text-sm text-fg">
                검토 확정{" "}
                <b className="text-gold-700 dark:text-gold-200">
                  {reviewedCount} / {filledKeys.length}
                </b>
                <span className="ml-1 text-xs text-fg-muted">(확정 점수만 추세 반영)</span>
              </span>
              <button
                className="btn-gold text-xs"
                onClick={() => setAllReviewed(!allReviewed)}
                disabled={filledKeys.length === 0}
              >
                {allReviewed ? "전체 확정 해제" : "모두 검토 확정"}
              </button>
            </div>
          )}

          {/* 7요인 */}
          <div>
            <p className="mb-2 text-sm font-semibold text-fg-muted">
              이 상담 시점의 RRTTLLU 7요인
            </p>
            <IPSForm ips={draft} readOnly={!editing} onChange={factorChange} />
          </div>

          {/* 현재 현금흐름·포트폴리오 (참고용 — 고객 단위 현재값) */}
          {client && (
            <div>
              <p className="mb-2 text-sm font-semibold text-fg-muted">
                현재 현금흐름 · 포트폴리오{" "}
                <span className="font-normal text-[11px]">(참고 · 고객 현재값)</span>
              </p>

              {/* 현금흐름 */}
              <div className="mb-3 rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-medium text-fg">현금흐름</p>
                {client.cashFlows.length === 0 ? (
                  <p className="text-xs text-fg-muted">입력된 현금흐름 없음</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {client.cashFlows.map((cf) => (
                      <li key={cf.id} className="flex justify-between">
                        <span className="text-fg-muted">
                          {cf.label || "(항목)"} · {cf.date || "시점 미정"}
                          {cf.recurring && " · 정기"}
                        </span>
                        <span className={cf.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"}>
                          {cf.amount < 0 ? "−" : "+"}
                          {formatKRW(Math.abs(cf.amount))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 포트폴리오 */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-xs font-medium text-fg">포트폴리오 후보</p>
                {client.portfolios.length === 0 ? (
                  <p className="text-xs text-fg-muted">생성된 포트폴리오 없음</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {client.portfolios.map((p) => (
                      <div key={p.id} className="rounded-md bg-surface-2 p-2">
                        <p className="text-xs font-bold text-fg">{p.label}</p>
                        <p className="text-[11px] text-fg-muted">
                          수익 {p.expectedReturn}% · 변동성 {p.expectedRisk}%
                        </p>
                        <p className="mt-1 text-[11px] text-fg-muted">
                          {p.allocations.map((a) => `${a.assetClass} ${a.weight}%`).join(" · ")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
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
                {saving ? "저장 중…" : "저장 ✓"}
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
