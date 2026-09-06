"use client";

import { useEffect, useMemo, useState } from "react";
import type { PbScheduleItem } from "@/lib/advisory/pbScheduleStorage";
import {
  KST_WEEKDAY_LABELS,
  buildMonthCalendarDays,
  formatKstDateLabel,
  formatKstTodoHeader,
  parseKstDateParts,
  todayKstDate,
} from "@/lib/advisory/pbScheduleStorage";
import { listPbSchedules } from "@/lib/store";

interface Props {
  pbId: string;
  refreshKey?: number;
}

function monthLabel(year: number, month: number) {
  return `${year}년 ${month}월`;
}

export function PbTodayTodos({ pbId, refreshKey = 0 }: Props) {
  const today = todayKstDate();
  const todayParts = parseKstDateParts(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewYear, setViewYear] = useState(todayParts.year);
  const [viewMonth, setViewMonth] = useState(todayParts.month);
  const [schedules, setSchedules] = useState<PbScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 일정은 이제 DB(pb_schedules)에서 온다 — 마이그레이션 전이면 store 가 localStorage 로
  // 폴백한다. 조회는 PB 단위로 한 번만 하고, 달력 점과 선택 날짜 목록은 그 결과에서
  // 파생시킨다(날짜를 누를 때마다 다시 조회하지 않는다).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listPbSchedules(pbId)
      .then((rows) => {
        if (!cancelled) setSchedules(rows);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setSchedules([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pbId, refreshKey]);

  const scheduleDates = useMemo(
    () => new Set(schedules.map((item) => item.date)),
    [schedules],
  );

  const items = useMemo(
    () =>
      schedules
        .filter((item) => item.date === selectedDate)
        .slice()
        .sort((a, b) => a.time.localeCompare(b.time)),
    [schedules, selectedDate],
  );

  const calendarDays = useMemo(
    () => buildMonthCalendarDays(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const header = formatKstTodoHeader(selectedDate);
  const emptyLabel =
    selectedDate === today ? "오늘 등록된 일정이 없습니다." : "선택한 날짜에 등록된 일정이 없습니다.";

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(viewYear, viewMonth - 1 + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth() + 1);
  };

  const selectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    const parts = parseKstDateParts(dateStr);
    setViewYear(parts.year);
    setViewMonth(parts.month);
  };

  return (
    <section id="today-schedule" className="overflow-hidden border border-border bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <h2 className="text-[15px] font-black tracking-tight text-fg">오늘의 일정</h2>
          <p className="text-[11px] text-fg-muted">{header}</p>
        </div>
        <span className="badge-navy">{loading ? "…" : `${items.length}건`}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_356px] md:items-stretch">
        <div className="flex min-h-[128px] flex-col border-b border-border md:border-b-0 md:border-r">
          {loading || items.length === 0 ? (
            <div className="flex flex-1 items-center justify-center bg-[#F9FBFF] px-4 py-5 text-xs text-fg-muted">
              {loading ? "일정을 불러오는 중…" : emptyLabel}
            </div>
          ) : (
            <ul>
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className={`relative flex min-h-10 items-center gap-3 border-b border-border px-4 py-2 last:border-0 ${index === 0 ? "bg-[#EAF2FF] before:absolute before:left-0 before:top-1.5 before:h-7 before:w-[3px] before:rounded-r before:bg-[#1769D2]" : "bg-white"}`}
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      item.type === "consultation"
                        ? "bg-[#EAF2FF] text-[#0D57BA]"
                        : "bg-surface-2 text-fg-muted"
                    }`}
                  >
                    {item.type === "consultation" ? "상담" : "기타"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-fg">
                      <span className="mr-2 font-mono text-[#0D57BA]">{item.time}</span>
                      {item.type === "consultation"
                        ? `${item.clientName} 고객님 상담`
                        : item.title}
                    </p>
                    {item.memo ? (
                      <p className="mt-0.5 text-[11px] text-fg-muted">{item.memo}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white p-2.5 md:shrink-0">
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className="btn-ghost h-7 w-7 px-0 text-xs text-fg-muted"
              onClick={() => shiftMonth(-1)}
              aria-label="이전 달"
            >
              ‹
            </button>
            <span className="text-[11px] font-bold text-fg">{monthLabel(viewYear, viewMonth)}</span>
            <button
              type="button"
              className="btn-ghost h-7 w-7 px-0 text-xs text-fg-muted"
              onClick={() => shiftMonth(1)}
              aria-label="다음 달"
            >
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center">
            {KST_WEEKDAY_LABELS.map((label) => (
              <span key={label} className="py-0.5 text-[10px] font-semibold text-fg-muted">
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {calendarDays.map((dateStr, idx) =>
              dateStr ? (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => selectDate(dateStr)}
                  aria-label={formatKstDateLabel(dateStr)}
                  aria-pressed={selectedDate === dateStr}
                  className={`relative flex h-5 flex-col items-center justify-center rounded-md text-[10px] font-semibold transition-colors ${
                    selectedDate === dateStr
                      ? "bg-[#1769D2] text-white"
                      : dateStr === today
                        ? "bg-[#EAF2FF] text-[#0D57BA] ring-1 ring-[#1769D2]/25"
                        : "text-fg hover:bg-white"
                  }`}
                >
                  {parseKstDateParts(dateStr).day}
                  {scheduleDates.has(dateStr) ? (
                    <span
                      className={`absolute bottom-0.5 h-1 w-1 rounded-full ${
                        selectedDate === dateStr ? "bg-white" : "bg-[#1769D2]"
                      }`}
                    />
                  ) : null}
                </button>
              ) : (
                <span key={`pad-${idx}`} className="h-5" aria-hidden />
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
