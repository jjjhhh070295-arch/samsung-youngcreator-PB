"use client";

// Market Home 용 오늘 일정 요약 — 차트 아래·전광판과 나란히 두는 짧은 목록.
// PB Home 의 PbTodayTodos 와 같은 listPbSchedules 소스를 쓰되, 달력/예약 UI 는 복제하지 않는다.
// "오늘"은 항상 Asia/Seoul (todayKstDate). PB Home 달력에서 고른 날짜와는 무관하다.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PbScheduleItem } from "@/lib/advisory/pbScheduleStorage";
import { formatKstDateLabel, todayKstDate } from "@/lib/advisory/pbScheduleStorage";
import { listPbSchedules } from "@/lib/store";

const MAX_ITEMS = 5;

function scheduleTitle(item: PbScheduleItem): string {
  if (item.type === "consultation") return `${item.clientName} 고객님 상담`;
  return item.title;
}

function scheduleTypeLabel(item: PbScheduleItem): string {
  return item.type === "consultation" ? "상담" : "기타";
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
    </svg>
  );
}

interface Props {
  pbId: string;
}

export default function MarketHomeTodaySchedule({ pbId }: Props) {
  const today = todayKstDate();
  const [items, setItems] = useState<PbScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled || !pbId) return;
      setLoading(true);
      setError(false);
      listPbSchedules(pbId)
        .then((rows) => {
          if (cancelled) return;
          const todayRows = rows
            .filter((item) => item.date === today)
            .slice()
            .sort((a, b) => a.time.localeCompare(b.time));
          setItems(todayRows);
        })
        .catch(() => {
          if (cancelled) return;
          setItems([]);
          setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    run();
    const onUpdate = () => run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("pb-schedules-updated", onUpdate);
    window.addEventListener("focus", onUpdate);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("pb-schedules-updated", onUpdate);
      window.removeEventListener("focus", onUpdate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pbId, today]);

  const retry = () => {
    setLoading(true);
    setError(false);
    listPbSchedules(pbId)
      .then((rows) => {
        const todayRows = rows
          .filter((item) => item.date === today)
          .slice()
          .sort((a, b) => a.time.localeCompare(b.time));
        setItems(todayRows);
      })
      .catch(() => {
        setItems([]);
        setError(true);
      })
      .finally(() => setLoading(false));
  };
  const preview = items.slice(0, MAX_ITEMS);
  const scheduleHref = `/pb/${pbId}#today-schedule`;

  return (
    <section
      aria-label="오늘의 일정"
      className="rounded-lg border border-[#E4EBF5] bg-white shadow-[0_1px_3px_rgba(16,42,86,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EEF3F9] px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF2FF] text-[#0D57BA]">
            <CalendarIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-[#111827]">오늘의 일정</h2>
            <p className="mt-0.5 text-[12px] text-[#8A97AB]">
              {formatKstDateLabel(today)}
              {!loading && !error ? ` · ${items.length}건` : null}
            </p>
          </div>
        </div>
        <Link
          href={scheduleHref}
          className="shrink-0 pt-1 text-[12px] font-semibold text-[#0D57BA] hover:underline"
        >
          전체 일정 보기 &gt;
        </Link>
      </div>

      <div className="min-h-[120px] px-4 py-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-[#8A97AB]">일정을 불러오는 중…</p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className="text-xs text-[#8A97AB]">일정을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-[#0D57BA] px-3 py-1.5 text-[12px] font-semibold text-[#0D57BA] hover:bg-[#EAF2FF]"
            >
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F6FA] text-[#A8B6C9]">
              <CalendarIcon className="h-5 w-5" />
            </span>
            <p className="text-[13px] font-medium text-[#5B6B82]">오늘 등록된 일정이 없습니다.</p>
            <p className="text-[11px] text-[#8A97AB]">새로운 상담 일정을 등록하여 일정을 관리해보세요.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#EEF3F9]">
            {preview.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline gap-2 py-2.5 text-sm leading-snug text-[#111827]"
              >
                <span className="shrink-0 font-mono text-[13px] font-semibold text-[#0D57BA]">
                  {item.time}
                </span>
                <span className="shrink-0 text-[#C5CEDA]" aria-hidden="true">
                  |
                </span>
                <span
                  className={`shrink-0 text-[12px] font-bold ${
                    item.type === "consultation" ? "text-[#0D57BA]" : "text-[#8A97AB]"
                  }`}
                >
                  {scheduleTypeLabel(item)}
                </span>
                <span className="shrink-0 text-[#C5CEDA]" aria-hidden="true">
                  |
                </span>
                <span className="min-w-0 truncate font-medium">{scheduleTitle(item)}</span>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && items.length > MAX_ITEMS ? (
          <p className="border-t border-[#EEF3F9] pt-2 text-[11px] text-[#8A97AB]">
            외 {items.length - MAX_ITEMS}건 ·{" "}
            <Link href={scheduleHref} className="font-semibold text-[#0D57BA] hover:underline">
              전체 보기
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
