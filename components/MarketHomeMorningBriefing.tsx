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

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3.5h7.5L19 8v12.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14.5 3.5V8H19M9 12h6M9 15.5h6" />
    </svg>
  );
}

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
      className="rounded-lg border border-[#E4EBF5] bg-white shadow-[0_1px_3px_rgba(16,42,86,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#EEF3F9] px-4 py-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF2FF] text-[#0D57BA]">
            <DocumentIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-[#111827]">모닝 브리핑</h2>
            <p className="mt-0.5 text-[12px] text-[#8A97AB]">{formatKstDateLabel(today)}</p>
          </div>
        </div>
        <Link
          href={briefingHref}
          className="shrink-0 pt-1 text-[12px] font-semibold text-[#0D57BA] hover:underline"
        >
          브리핑 보기 &gt;
        </Link>
      </div>

      <div className="min-h-[140px] px-4 py-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-[#8A97AB]">모닝 브리핑을 불러오는 중…</p>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <p className="text-xs text-[#8A97AB]">모닝 브리핑을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={retry}
              className="rounded border border-[#0D57BA] px-3 py-1.5 text-[12px] font-semibold text-[#0D57BA] hover:bg-[#EAF2FF]"
            >
              다시 시도
            </button>
          </div>
        ) : !report ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F6FA] text-[#A8B6C9]">
              <DocumentIcon className="h-5 w-5" />
            </span>
            <p className="text-[13px] font-medium text-[#5B6B82]">오늘 생성된 모닝 브리핑이 없습니다.</p>
            <p className="text-[11px] text-[#8A97AB]">시장 정보를 확인하고 고객과의 상담에 활용해보세요.</p>
            <Link
              href={briefingHref}
              className="mt-1 inline-flex h-9 items-center justify-center rounded-md border border-[#D0DBEA] bg-white px-4 text-[12px] font-semibold text-[#0D57BA] transition-colors hover:border-[#0D57BA] hover:bg-[#F3F7FD]"
            >
              브리핑 페이지 열기
            </Link>
          </div>
        ) : (
          <div className="space-y-1.5 py-1">
            {headline ? (
              <p className="text-sm font-bold leading-snug text-[#111827]">{headline}</p>
            ) : null}
            {preview ? (
              <p className="text-[12px] leading-relaxed text-[#5B6B82]">{preview}</p>
            ) : (
              <p className="text-[12px] text-[#8A97AB]">본문 미리보기가 없습니다.</p>
            )}
            <div className="pt-1">
              <Link
                href={briefingHref}
                className="text-[12px] font-semibold text-[#0D57BA] hover:underline"
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
