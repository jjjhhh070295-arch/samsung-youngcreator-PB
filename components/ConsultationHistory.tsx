"use client";

import { useState } from "react";
import type { Consultation } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { formatDateTime, formatDurationKo } from "@/lib/format";
import { EmptyView } from "./StateViews";

interface Props {
  consultations: Consultation[];
}

// 상담 이력 목록 (날짜·소요시간 + 펼쳐서 그 시점 7요인 스냅샷 확인)
export default function ConsultationHistory({ consultations }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (consultations.length === 0) {
    return <EmptyView title="상담 이력이 없어요" hint="상담을 시작하고 종료하면 이력이 쌓입니다." />;
  }

  const sorted = consultations
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1)); // 최신순

  return (
    <ul className="space-y-2">
      {sorted.map((c) => {
        const open = openId === c.id;
        return (
          <li key={c.id} className="card overflow-hidden">
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2"
              onClick={() => setOpenId(open ? null : c.id)}
            >
              <div>
                <p className="text-sm font-medium text-fg">{formatDateTime(c.createdAt)}</p>
                <p className="text-xs text-fg-muted">
                  소요시간 {formatDurationKo(c.durationSeconds)}
                </p>
              </div>
              <span className="text-fg-muted">{open ? "▲" : "▼"}</span>
            </button>
            {open && (
              <div className="border-t border-border px-4 py-3">
                {c.notes && (
                  <p className="mb-3 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">
                    {c.notes}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {FACTOR_META.map((m) => {
                    const f = c.ipsSnapshot?.[m.key];
                    const score = f?.status === "explicit" ? f?.score : null;
                    return (
                      <div key={m.key} className="rounded-lg border border-border p-2">
                        <p className="text-[11px] text-fg-muted">{m.label}</p>
                        <p className="text-sm font-semibold text-fg">
                          {score != null ? (
                            <span className="text-gold-600 dark:text-gold-300">{score}점</span>
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </p>
                        {f?.value && (
                          <p className="mt-0.5 truncate text-[11px] text-fg-muted" title={f.value}>
                            {f.value}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
