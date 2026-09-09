"use client";

import React, { useMemo, useState } from "react";
import type { Consultation, Client } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { formatDateTime, formatDurationKo } from "@/lib/format";
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
                  소요 {formatDurationKo(c.durationSeconds)} · 점수 확정 {scoreCount(c)}개
                  {consultationHasPbMemo(c) ? " · PB 메모 있음" : ""}
                  {c.ipsDocumentSnapshot ? " · 확정 IPS" : ""}
                </p>
              </div>
            </div>
            <button
              className="btn-gold shrink-0 text-xs"
              onClick={() => {
                setSelectedId(c.id);
                setSelectedIdx(indexOf.get(c.id));
              }}
            >
              상세 보기
            </button>
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
