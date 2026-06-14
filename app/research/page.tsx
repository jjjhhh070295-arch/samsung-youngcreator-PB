"use client";

// 리서치 분석 조회 — Gemini가 분석한 리포트별 요약·신호를 본다.
// 데이터는 캐시(/api/research/signals)에서 읽고, [갱신]으로 최신 리포트 재분석(/api/research/ingest).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingView, ErrorView, EmptyView } from "@/components/StateViews";
import { formatDateTime } from "@/lib/format";

type Signal = { signal: string; direction: -1 | 0 | 1; strength: number; evidence: string };
type Report = {
  id: string;
  title: string;
  source: string;
  url: string;
  date: string | null;
  summary: string;
  signals: Signal[];
  model?: string;
};
type Aggregated = { signal: string; score: number; absStrength: number };

const SIGNAL_KO: Record<string, string> = {
  equity: "주식",
  bond: "채권",
  liquidity: "현금성",
  dollar: "달러",
  gold: "금/원자재",
  risk: "위험관리",
  tax: "세금",
};

function DirChip({ s }: { s: Signal }) {
  const arrow = s.direction > 0 ? "▲" : s.direction < 0 ? "▼" : "·";
  const cls =
    s.direction > 0
      ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
      : s.direction < 0
        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "badge-muted";
  return (
    <span className={`badge ${cls}`} title={s.evidence}>
      {SIGNAL_KO[s.signal] ?? s.signal} {arrow}
      {s.strength}
    </span>
  );
}

export default function ResearchPage() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [aggregated, setAggregated] = useState<Aggregated[]>([]);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");
  const [viewMode, setViewMode] = useState<"week" | "source">("week"); // 주차별 / 출처(증권사)별
  const [activeSource, setActiveSource] = useState<string | null>(null); // 출처별 보기에서 선택된 출처

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/research/signals", { cache: "no-store" });
      const data = await res.json();
      setReports(data.reports ?? []);
      setAggregated(data.aggregated ?? []);
      setLastAt(data.lastAnalyzedAt ?? null);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async (mode: "new" | "force" | "retryFailed" = "new") => {
    setRefreshing(true);
    setMsg(
      mode === "force"
        ? "전체 리포트 재분석 중… (본문까지 분석, 다소 걸립니다)"
        : mode === "retryFailed"
          ? "실패(미분석)한 리포트만 다시 분석 중…"
          : "최신 리포트 분석 중… (새 리포트만 분석하므로 보통 빠릅니다)",
    );
    const q = mode === "force" ? "?force=1" : mode === "retryFailed" ? "?retryFailed=1" : "";
    try {
      const res = await fetch(`/api/research/ingest${q}`, { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setMsg(
          `완료 — 총 ${data.total}건 중 새로 분석 ${data.analyzedNow}건, 캐시 ${data.fromCache}건` +
            (data.usedLLM ? " (LLM 분석)" : " (키 없음/한도 → 키워드 추정)"),
        );
        await load();
      } else {
        setMsg(`갱신 실패: ${data.error ?? "알 수 없음"}`);
      }
    } catch (e) {
      setMsg("갱신 호출 실패");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => router.push("/")}>
            ← 대시보드
          </button>
          <h1 className="mt-1 text-xl font-bold text-fg">리서치 분석</h1>
          <p className="text-xs text-fg-muted">
            포트폴리오 산출 근거가 된 리포트들의 요약과 신호입니다.
            {lastAt && ` · 마지막 분석 ${formatDateTime(lastAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-outline text-sm" onClick={() => refresh("retryFailed")} disabled={refreshing}>
            실패만 재분석
          </button>
          <button className="btn-outline text-sm" onClick={() => refresh("force")} disabled={refreshing}>
            전체 재분석
          </button>
          <button className="btn-gold text-sm" onClick={() => refresh("new")} disabled={refreshing}>
            {refreshing ? "분석 중…" : "🔄 리서치 갱신"}
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-lg bg-surface-2 px-4 py-2 text-xs text-fg-muted">{msg}</div>
      )}

      {/* 집계 신호 */}
      {aggregated.length > 0 && (
        <div className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg-muted">종합 신호 (방향 가중 합)</h2>
          <div className="flex flex-wrap gap-2">
            {aggregated.map((a) => (
              <span
                key={a.signal}
                className={`badge ${
                  a.score > 0
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : a.score < 0
                      ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                      : "badge-muted"
                }`}
              >
                {SIGNAL_KO[a.signal] ?? a.signal}: {a.score > 0 ? "+" : ""}
                {a.score}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-muted">
            양수=비중 확대 신호, 음수=축소 신호. 이 신호가 포트폴리오 자산배분에 반영됩니다.
          </p>
        </div>
      )}

      {status === "loading" && <LoadingView />}
      {status === "error" && <ErrorView onRetry={load} />}
      {status === "ready" && reports.length === 0 && (
        <EmptyView
          title="아직 분석된 리포트가 없어요"
          hint="오른쪽 위 '리서치 갱신'을 누르면 최신 리포트를 가져와 분석합니다."
          action={
            <button className="btn-gold text-sm" onClick={() => refresh("new")} disabled={refreshing}>
              🔄 리서치 갱신
            </button>
          }
        />
      )}

      {/* 리포트별 요약 — 주차별 / 출처별 그룹 (토글) */}
      {status === "ready" && reports.length > 0 && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg-muted">
              리포트 ({viewMode === "week" ? "주차별" : "출처별"} · 총 {reports.length})
            </h2>
            {/* 보기 전환 */}
            <div className="inline-flex overflow-hidden rounded-lg border border-border text-xs">
              <button
                className={`px-3 py-1.5 font-medium ${viewMode === "week" ? "bg-navy-800 text-white dark:bg-navy-600" : "text-fg-muted hover:bg-surface-2"}`}
                onClick={() => setViewMode("week")}
              >
                주차별
              </button>
              <button
                className={`px-3 py-1.5 font-medium ${viewMode === "source" ? "bg-navy-800 text-white dark:bg-navy-600" : "text-fg-muted hover:bg-surface-2"}`}
                onClick={() => setViewMode("source")}
              >
                출처별
              </button>
            </div>
          </div>

          {viewMode === "week"
            ? groupByWeek(reports).map((g) => (
                <div key={g.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-navy-800 px-2.5 py-1 text-xs font-bold text-white dark:bg-navy-600">
                      {g.label}
                    </span>
                    <span className="text-xs text-fg-muted">{g.reports.length}건</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="space-y-3">
                    {g.reports.map((r) => (
                      <ReportCard key={r.id} r={r} />
                    ))}
                  </div>
                </div>
              ))
            : (() => {
                // 출처(증권사)별 — 가로 탭바로 출처를 나란히 두고, 선택한 출처의 리포트만 표시
                const groups = groupBySource(reports);
                const active = groups.find((g) => g.key === activeSource) ?? groups[0];
                return (
                  <div className="space-y-4">
                    {/* 출처 탭바 */}
                    <div className="flex flex-wrap gap-2 border-b border-border pb-3">
                      {groups.map((g) => {
                        const on = g.key === active?.key;
                        return (
                          <button
                            key={g.key}
                            onClick={() => setActiveSource(g.key)}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition ${
                              on
                                ? "bg-navy-800 text-white dark:bg-navy-600"
                                : "bg-surface-2 text-fg-muted hover:text-fg"
                            }`}
                          >
                            {g.label}
                            <span
                              className={`rounded px-1 text-[10px] ${on ? "bg-white/20" : "bg-border text-fg-muted"}`}
                            >
                              {g.reports.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* 선택된 출처의 리포트 */}
                    <div className="space-y-3">
                      {active?.reports.map((r) => (
                        <ReportCard key={r.id} r={r} />
                      ))}
                    </div>
                  </div>
                );
              })()}
        </div>
      )}
    </div>
  );
}

// 리포트 1건 카드 (주차별·출처별 공용)
function ReportCard({ r }: { r: Report }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-gold-600 dark:text-gold-300">
          {r.source}
          {r.date && <span className="ml-2 text-fg-muted">{r.date}</span>}
        </span>
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-fg-muted underline hover:text-fg"
          >
            원문 ↗
          </a>
        )}
      </div>
      <p className="mt-1 text-sm font-semibold text-fg">{r.title}</p>
      {r.summary ? (
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{r.summary}</p>
      ) : (
        <p className="mt-1 text-[11px] text-fg-muted">
          본문 미분석 (키워드 추정) — [실패만 재분석] 시 요약 생성
        </p>
      )}
      {r.signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.signals.map((s, i) => (
            <DirChip key={i} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// 리포트를 주차(연·월·몇째 주)별로 그룹화 (최신 주 먼저)
function groupByWeek(reports: Report[]): { key: string; label: string; reports: Report[] }[] {
  const map = new Map<string, { key: string; label: string; sort: string; reports: Report[] }>();
  for (const r of reports) {
    let key = "no-date";
    let label = "날짜 미상";
    let sort = "0";
    if (r.date) {
      const [y, m, d] = r.date.split("-").map(Number);
      if (y && m && d) {
        const wom = Math.ceil(d / 7); // 그 달의 몇째 주
        key = `${y}-${m}-${wom}`;
        label = `${y}년 ${m}월 ${wom}주차`;
        sort = `${y}${String(m).padStart(2, "0")}${wom}`;
      }
    }
    if (!map.has(key)) map.set(key, { key, label, sort, reports: [] });
    map.get(key)!.reports.push(r);
  }
  return Array.from(map.values()).sort((a, b) => b.sort.localeCompare(a.sort));
}

// 리포트를 출처(증권사)별로 그룹화. source가 "네이버 금융 … · 대신증권"이면 증권사명으로 묶고,
// 아니면 출처명 그대로 사용. 건수 많은 출처 먼저.
function groupBySource(reports: Report[]): { key: string; label: string; reports: Report[] }[] {
  const map = new Map<string, { key: string; label: string; reports: Report[] }>();
  for (const r of reports) {
    const parts = (r.source || "").split(" · ");
    const label = (parts[1] || parts[0] || "기타").trim();
    const key = label;
    if (!map.has(key)) map.set(key, { key, label, reports: [] });
    map.get(key)!.reports.push(r);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.reports.length - a.reports.length || a.label.localeCompare(b.label),
  );
}
