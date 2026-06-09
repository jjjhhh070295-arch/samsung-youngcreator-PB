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
  model: string;
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

  const refresh = async () => {
    setRefreshing(true);
    setMsg("최신 리포트 분석 중… (새 리포트만 분석하므로 보통 빠릅니다)");
    try {
      const res = await fetch("/api/research/ingest", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setMsg(
          `완료 — 총 ${data.total}건 중 새로 분석 ${data.analyzedNow}건, 캐시 ${data.fromCache}건` +
            (data.usedLLM ? " (Gemini 분석)" : " (키 없음 → 키워드 추정)"),
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
        <button className="btn-gold text-sm" onClick={refresh} disabled={refreshing}>
          {refreshing ? "분석 중…" : "🔄 리서치 갱신"}
        </button>
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
            <button className="btn-gold text-sm" onClick={refresh} disabled={refreshing}>
              🔄 리서치 갱신
            </button>
          }
        />
      )}

      {/* 리포트별 요약 */}
      {status === "ready" && reports.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-fg-muted">리포트별 요약 ({reports.length})</h2>
          {reports.map((r) => (
            <div key={r.id} className="card p-4">
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
              {r.summary && (
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{r.summary}</p>
              )}
              {r.signals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.signals.map((s, i) => (
                    <DirChip key={i} s={s} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
