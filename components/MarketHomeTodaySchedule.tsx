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
  };  const preview = items.slice(0, MAX_ITEMS);
  const scheduleHref = `/pb/${pbId}#today-schedule`;

  return (
    <section
      aria-label="오늘의 일정"
      className="rounded-md border border-border bg-white shadow-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-black tracking-tight text-fg">오늘의 일정</h2>
          <p className="text-[11px] text-fg-muted">
            {formatKstDateLabel(today)}
            {!loading && !error ? ` · ${items.length}건` : null}
          </p>
        </div>
        <Link
          href={scheduleHref}
          className="shrink-0 text-[12px] font-semibold text-[#1769D2] hover:underline"
        >
          전체 일정 보기
        </Link>
      </div>

      <div className="min-h-[72px] px-3 py-2 sm:px-4">
        {loading ? (
          <p className="py-4 text-center text-xs text-fg-muted">일정을 불러오는 중…</p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <p className="text-xs text-fg-muted">일정을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-[#1769D2] px-3 py-1.5 text-[12px] font-semibold text-[#1769D2] hover:bg-[#EAF2FF]"
            >
              다시 시도
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-muted">오늘 등록된 일정이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-border">
            {preview.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline gap-2 py-2 text-sm leading-snug text-fg"
              >
                <span className="shrink-0 font-mono text-[13px] font-semibold text-[#0D57BA]">
                  {item.time}
                </span>
                <span className="shrink-0 text-fg-muted" aria-hidden="true">
                  |
                </span>
                <span
                  className={`shrink-0 text-[12px] font-bold ${
                    item.type === "consultation" ? "text-[#0D57BA]" : "text-fg-muted"
                  }`}
                >
                  {scheduleTypeLabel(item)}
                </span>
                <span className="shrink-0 text-fg-muted" aria-hidden="true">
                  |
                </span>
                <span className="min-w-0 truncate font-medium">{scheduleTitle(item)}</span>
              </li>
            ))}
          </ul>
        )}
        {!loading && !error && items.length > MAX_ITEMS ? (
          <p className="border-t border-border pt-2 text-[11px] text-fg-muted">
            외 {items.length - MAX_ITEMS}건 ·{" "}
            <Link href={scheduleHref} className="font-semibold text-[#1769D2] hover:underline">
              전체 보기
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
