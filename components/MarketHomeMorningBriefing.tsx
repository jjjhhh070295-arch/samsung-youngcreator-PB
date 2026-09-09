"use client";

// Market Home — 오늘(KST) 모닝 브리핑 요약 카드.
// GET /api/briefing/list 를 재사용하고, report_date === todayKstDate() 인 건만 표시한다.
// 최신/어제 리포트를 오늘처럼 보여 주지 않는다. html_body 는 주입하지 않는다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatKstDateLabel, todayKstDate } from "@/lib/advisory/pbScheduleStorage";

export interface BriefingListItem {
  id: string;
  report_date: string;
  headline: string;
  text_body: string;
  status?: string;
}

interface Props {
  pbId: string;
}

const PREVIEW_MAX = 180;

/** Exact KST date match only — never fall back to the latest older report. */
export function selectTodaysBriefing(
  reports: BriefingListItem[],
  today: string,
): BriefingListItem | null {
  return reports.find((r) => r.report_date === today) ?? null;
}

export function previewBriefingText(body: string, max = PREVIEW_MAX): string {
  const flat = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

export default function MarketHomeMorningBriefing({ pbId }: Props) {
  const today = todayKstDate();
  const [report, setReport] = useState<BriefingListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled || !pbId) return;
      setLoading(true);
      setError(false);
      fetch("/api/briefing/list", {
        cache: "no-store",
        headers: { "x-pb-id": pbId },
      })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (!res.ok || !data?.ok) {
            setReport(null);
            setError(true);
            return;
          }
          const list: BriefingListItem[] = Array.isArray(data.reports) ? data.reports : [];
          setReport(selectTodaysBriefing(list, today));
          setError(false);
        })
        .catch(() => {
          if (cancelled) return;
          setReport(null);
          setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    run();
    const onFocus = () => run();
    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pbId, today]);

  const retry = () => {
    setLoading(true);
    setError(false);
    fetch("/api/briefing/list", {
      cache: "no-store",
      headers: { "x-pb-id": pbId },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          setReport(null);
          setError(true);
          return;
        }
        const list: BriefingListItem[] = Array.isArray(data.reports) ? data.reports : [];
        setReport(selectTodaysBriefing(list, today));
        setError(false);
      })
      .catch(() => {
        setReport(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  };

  const briefingHref = `/pb/${pbId}/briefing`;
  const headline = report?.headline?.trim() || "";
  const preview = report ? previewBriefingText(report.text_body) : "";

  return (
    <section
      aria-label="모닝 브리핑"
      className="rounded-md border border-border bg-white shadow-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-black tracking-tight text-fg">모닝 브리핑</h2>
          <p className="text-[11px] text-fg-muted">{formatKstDateLabel(today)}</p>
        </div>
        <Link
          href={briefingHref}
          className="shrink-0 text-[12px] font-semibold text-[#1769D2] hover:underline"
        >
          브리핑 보기
        </Link>
      </div>

      <div className="min-h-[72px] px-3 py-2.5 sm:px-4">
        {loading ? (
          <p className="py-4 text-center text-xs text-fg-muted">모닝 브리핑을 불러오는 중…</p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <p className="text-xs text-fg-muted">모닝 브리핑을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-[#1769D2] px-3 py-1.5 text-[12px] font-semibold text-[#1769D2] hover:bg-[#EAF2FF]"
            >
              다시 시도
            </button>
          </div>
        ) : !report ? (
          <div className="py-4 text-center">
            <p className="text-xs text-fg-muted">오늘 생성된 모닝 브리핑이 없습니다.</p>
            <Link
              href={briefingHref}
              className="mt-2 inline-block text-[12px] font-semibold text-[#1769D2] hover:underline"
            >
              브리핑 페이지 열기
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 py-1">
            {headline ? (
              <p className="text-sm font-bold leading-snug text-fg">{headline}</p>
            ) : null}
            {preview ? (
              <p className="text-[12px] leading-relaxed text-fg-muted">{preview}</p>
            ) : (
              <p className="text-[12px] text-fg-muted">본문 미리보기가 없습니다.</p>
            )}
            <div className="pt-1">
              <Link
                href={briefingHref}
                className="text-[12px] font-semibold text-[#1769D2] hover:underline"
              >
                전체 보기
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
