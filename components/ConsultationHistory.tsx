"use client";

import { useState } from "react";
import type { Consultation, Client } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { formatDateTime, formatDurationKo } from "@/lib/format";
import { EmptyView } from "./StateViews";
import ConsultationDetailModal from "./ConsultationDetailModal";

interface Props {
  consultations: Consultation[];
  client?: Client | null; // 현재 현금흐름·포트폴리오 참고 표시용
  onSaved?: () => void; // 상담 수정 저장 후 새로고침
}

// 상담 이력 목록 — 각 상담을 [상세 보기]로 열어 조회·수정·확정.
export default function ConsultationHistory({ consultations, client, onSaved }: Props) {
  const [selected, setSelected] = useState<Consultation | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | undefined>();

  if (consultations.length === 0) {
    return <EmptyView title="상담 이력이 없어요" hint="상담을 시작하고 종료하면 이력이 쌓입니다." />;
  }

  // 오래된→최신 순으로 회차 부여, 표시는 최신순
  const ordered = consultations
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const indexOf = new Map(ordered.map((c, i) => [c.id, i + 1]));
  const sorted = ordered.slice().reverse(); // 최신순

  // 한 줄 요약: 확정된 점수 개수
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
                  {c.notes ? " · 메모 있음" : ""}
                </p>
              </div>
            </div>
            <button
              className="btn-gold shrink-0 text-xs"
              onClick={() => {
                setSelected(c);
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
        onClose={() => setSelected(null)}
        onSaved={() => onSaved?.()}
      />
    </>
  );
}
