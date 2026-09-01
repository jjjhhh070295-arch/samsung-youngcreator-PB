"use client";

import type { PbScheduleItem } from "@/lib/advisory/pbScheduleStorage";
import { formatKstTodoHeader, todayKstDate } from "@/lib/advisory/pbScheduleStorage";

export function PbTodayTodos({ items }: { items: PbScheduleItem[] }) {
  const today = todayKstDate();
  const header = formatKstTodoHeader(today);

  return (
    <section className="card flex min-h-[220px] flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-fg">오늘 PB의 할일</h2>
          <p className="mt-0.5 text-[11px] text-fg-muted">{header}</p>
        </div>
        <span className="badge-navy">{items.length}건</span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/50 px-4 py-8 text-sm text-fg-muted">
          오늘 등록된 일정이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-white px-3 py-2.5"
            >
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  item.type === "consultation"
                    ? "bg-[#1428A0]/10 text-[#1428A0]"
                    : "bg-surface-2 text-fg-muted"
                }`}
              >
                {item.type === "consultation" ? "상담" : "기타"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">
                  <span className="mr-2 font-mono text-[#1428A0]">{item.time}</span>
                  {item.type === "consultation"
                    ? `${item.clientName} 고객님 상담`
                    : item.title}
                </p>
                {item.memo ? <p className="mt-0.5 text-[11px] text-fg-muted">{item.memo}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
