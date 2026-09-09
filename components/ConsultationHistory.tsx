"use client";

import { useState } from "react";
import type { Consultation, Client } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { formatDateTime, formatDurationKo } from "@/lib/format";
import { deleteConsultation } from "@/lib/store";
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
                  {/* ended_at 이 비어 있으면 아직 진행 중인 상담이다. 소요 시간을 0분으로
                      보여주면 끝난 상담처럼 읽히므로 상태를 그대로 적는다. */}
                  {c.endedAt ? `소요 ${formatDurationKo(c.durationSeconds)}` : "진행 중"}
                  {` · 점수 확정 ${scoreCount(c)}개`}
                  {c.pbMemo ? " · PB 메모 있음" : c.notes ? " · 상담 전문 있음" : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                className="btn-gold text-xs"
                onClick={() => {
                  setSelected(c);
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
        onClose={() => setSelected(null)}
        onSaved={() => onSaved?.()}
      />
    </>
  );
}
