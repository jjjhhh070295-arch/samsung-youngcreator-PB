"use client";

import React, { useMemo, useState } from "react";
import type { Consultation, Client } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { formatDateTime, formatDurationKo } from "@/lib/format";
import { deleteConsultation } from "@/lib/store";
import { consultationHasPbMemo } from "@/lib/advisory/consultationIpsDocument";
import { EmptyView } from "./StateViews";
import ConsultationDetailModal from "./ConsultationDetailModal";

interface Props {
  consultations: Consultation[];
  client?: Client | null;
  onSaved?: () => void;
}

// 상담 이력 목록 — selectedConsultationId 로 최신 props 에서 파생(stale 객체 방지).
export default function ConsultationHistory({ consultations, client, onSaved }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | undefined>();
  const [deleting, setDeleting] = useState<string | null>(null);

  // 삭제는 되돌릴 수 없다 — DB 하드 삭제이고 소프트 삭제 플래그가 없다. 그래서 확인을
  // 반드시 받고, 무엇이 사라지는지(회차·일시)를 문구에 넣는다. 실패는 조용히 넘기지 않는다.
  const remove = async (target: Consultation, idx?: number) => {
    const label = `${idx ? `${idx}회차 ` : ""}${formatDateTime(target.createdAt)}`;
    if (!confirm(`상담 기록을 삭제할까요?\n\n${label}\n\n되돌릴 수 없습니다.`)) return;
    setDeleting(target.id);
    try {
      await deleteConsultation(target.id);
      onSaved?.();
    } catch (e) {
      console.error("[상담 삭제] 실패", e);
      alert("상담 기록을 삭제하지 못했습니다.");
    } finally {
      setDeleting(null);
    }
  };

  const ordered = useMemo(
    () =>
      consultations
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [consultations],
  );
  const indexOf = useMemo(
    () => new Map(ordered.map((c, i) => [c.id, i + 1])),
    [ordered],
  );
  const sorted = useMemo(() => ordered.slice().reverse(), [ordered]);

  const selected = useMemo(
    () => (selectedId ? consultations.find((c) => c.id === selectedId) ?? null : null),
    [consultations, selectedId],
  );

  if (consultations.length === 0) {
    return <EmptyView title="상담 이력이 없어요" hint="상담을 시작하고 종료하면 이력이 쌓입니다." />;
  }

  const scoreCount = (c: Consultation) =>
    FACTOR_META.filter((m) => {
      const f = c.ipsSnapshot?.[m.key];
      return f && f.status === "explicit" && f.score != null;
    }).length;

  return (
    <>
      <ul className="space-y-2">
        {sorted.map((c) => (
          <li
            key={c.id}
            className="card flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-100 text-sm font-bold text-navy-800 dark:bg-navy-700 dark:text-navy-100">
                #{indexOf.get(c.id)}
              </span>
              <div>
                <p className="text-sm font-medium text-fg">{formatDateTime(c.createdAt)}</p>
                <p className="text-xs text-fg-muted">
                  {/* ended_at 이 비어 있으면 아직 진행 중인 상담이다. "상담 시작"이 만든
                      빈 상담이 그렇다 — 소요 0분으로 보여주면 끝난 상담처럼 읽힌다. */}
                  {c.endedAt ? `소요 ${formatDurationKo(c.durationSeconds)}` : "진행 중"}
                  {` · 점수 확정 ${scoreCount(c)}개`}
                  {consultationHasPbMemo(c) ? " · PB 메모 있음" : ""}
                  {c.ipsDocumentSnapshot ? " · 확정 IPS" : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-gold text-xs"
                onClick={() => {
                  setSelectedId(c.id);
                  setSelectedIdx(indexOf.get(c.id));
                }}
              >
                상세 보기
              </button>
              <button
                type="button"
                className="px-1 text-red-400 transition-colors hover:text-red-600 disabled:opacity-40"
                disabled={deleting === c.id}
                title="이 상담 기록 삭제 — 되돌릴 수 없습니다"
                onClick={() => void remove(c, indexOf.get(c.id))}
              >
                {deleting === c.id ? "…" : "✕"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <ConsultationDetailModal
        consultation={selected}
        client={client}
        index={selectedIdx}
        onClose={() => setSelectedId(null)}
        onSaved={() => onSaved?.()}
      />
    </>
  );
}
