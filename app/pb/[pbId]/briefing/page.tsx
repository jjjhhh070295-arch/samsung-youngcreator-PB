"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface BriefingSource {
  title: string;
  url: string;
}

interface DailyReport {
  id: string;
  report_date: string;
  headline: string;
  html_body: string;
  text_body: string;
  sources: BriefingSource[];
  model: string;
  input_tokens: number;
  output_tokens: number;
  web_search_count: number;
  cost_usd: number;
  duration_sec: number;
  generated_at: string;
  status: string;
}

export default function BriefingPage() {
  const { pbId } = useParams<{ pbId: string }>();

  const [reports, setReports] = useState<DailyReport[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<DailyReport | null>(null);

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [genErrorCode, setGenErrorCode] = useState("");

  const loadList = useCallback(async () => {
    setListBusy(true);
    try {
      const res = await fetch("/api/briefing/list", { cache: "no-store" });
      const data = await res.json();
      if (!data.ok) {
        setListError(data.error ?? "목록을 불러오지 못했습니다.");
        return;
      }
      setListError("");
      setTableMissing(!!data.tableMissing);
      const list: DailyReport[] = data.reports ?? [];
      setReports(list);
      setSelected((prev) => (prev ? list.find((r) => r.id === prev.id) ?? list[0] ?? null : list[0] ?? null));
    } catch {
      setListError("목록을 불러오지 못했습니다.");
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const generate = async (overwrite: boolean) => {
    setGenerating(true);
    setGenError("");
    setGenErrorCode("");
    try {
      const res = await fetch("/api/briefing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overwrite }),
      });
      const data = await res.json();
      if (!data.ok) {
        setGenErrorCode(data.code ?? "");
        setGenError(data.error ?? "리포트 생성에 실패했습니다.");
        return;
      }
      setSelected(data.report);
      await loadList();
    } catch {
      setGenErrorCode("SERVER_ERROR");
      setGenError("리포트 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-4 lg:px-6">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <Link href={`/pb/${pbId}`} className="text-[11px] font-semibold text-[#1428A0] hover:underline">
            ← PB 대시보드
          </Link>
          <h1 className="mt-1 text-xl font-black tracking-tight text-fg">모닝 브리핑</h1>
          <p className="mt-0.5 text-xs text-fg-muted">
            시장 공통 데일리 마켓 인사이트 리포트 — 고객 개인정보는 사용되지 않습니다.
          </p>
        </div>
        <div className="flex gap-2">
          {process.env.NODE_ENV === "production" ? (
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
              리포트는 매일 새벽 자동 생성됩니다.
            </p>
          ) : (
            <button className="btn-primary text-sm" onClick={() => generate(false)} disabled={generating}>
              {generating ? "생성 중… (최대 5분)" : "오늘 리포트 생성"}
            </button>
          )}
        </div>
      </div>

      {/* 에러/안내 배너 */}
      {genErrorCode === "NO_TABLE" && (
        <div className="card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">daily_reports 테이블이 아직 없습니다.</p>
          <p className="mt-1 text-xs">
            supabase-migration-daily-reports.sql 을 Supabase SQL Editor에서 먼저 실행한 뒤 다시 시도하세요.
          </p>
        </div>
      )}
      {genErrorCode === "ALREADY_EXISTS" && (
        <div className="card border border-border p-4 text-sm text-fg">
          <p>{genError}</p>
          <button className="btn-outline mt-2 text-xs" onClick={() => generate(true)} disabled={generating}>
            덮어쓰고 다시 생성
          </button>
        </div>
      )}
      {genError && genErrorCode !== "NO_TABLE" && genErrorCode !== "ALREADY_EXISTS" && (
        <div className="card border border-red-300 bg-red-50 p-4 text-sm text-red-700">{genError}</div>
      )}
      {tableMissing && !genErrorCode && (
        <div className="card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">daily_reports 테이블이 아직 없습니다.</p>
          <p className="mt-1 text-xs">
            supabase-migration-daily-reports.sql 을 Supabase SQL Editor에서 먼저 실행하세요. 실행 후 &ldquo;오늘 리포트 생성&rdquo;을
            누르면 정상적으로 생성됩니다.
          </p>
        </div>
      )}
      {listError && <div className="card border border-red-300 bg-red-50 p-4 text-sm text-red-700">{listError}</div>}

      <div className="grid gap-4 lg:grid-cols-12">
        {/* 지난 리포트 목록 */}
        <aside className="space-y-2 lg:col-span-3">
          <p className="text-xs font-semibold text-fg-muted">지난 리포트</p>
          {listBusy ? (
            <p className="text-xs text-fg-muted">불러오는 중…</p>
          ) : reports.length === 0 ? (
            <p className="text-xs text-fg-muted">아직 생성된 리포트가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                      selected?.id === r.id
                        ? "border-[#1428A0] bg-[#1428A0]/5"
                        : "border-border hover:bg-surface-2"
                    }`}
                    onClick={() => setSelected(r)}
                  >
                    <span className="block font-semibold text-fg">{r.report_date}</span>
                    <span className="mt-0.5 block truncate text-fg-muted">{r.headline}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* 미리보기 */}
        <div className="space-y-3 lg:col-span-9">
          {selected ? (
            <>
              <div className="card grid grid-cols-2 gap-3 p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <span className="block text-fg-muted">모델</span>
                  <span className="font-semibold text-fg">{selected.model}</span>
                </div>
                <div>
                  <span className="block text-fg-muted">입력 토큰</span>
                  <span className="font-semibold text-fg">{selected.input_tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-fg-muted">출력 토큰</span>
                  <span className="font-semibold text-fg">{selected.output_tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="block text-fg-muted">검색 횟수</span>
                  <span className="font-semibold text-fg">{selected.web_search_count}</span>
                </div>
                <div>
                  <span className="block text-fg-muted">비용</span>
                  <span className="font-semibold text-fg">${Number(selected.cost_usd).toFixed(4)}</span>
                </div>
                <div>
                  <span className="block text-fg-muted">소요 시간</span>
                  <span className="font-semibold text-fg">{Number(selected.duration_sec).toFixed(1)}초</span>
                </div>
              </div>
              <p className="text-[11px] text-fg-muted">
                생성 시각: {new Date(selected.generated_at).toLocaleString("ko-KR")} · 상태: {selected.status}
              </p>
              <div className="card overflow-hidden p-0">
                <iframe
                  title="모닝 브리핑 미리보기"
                  srcDoc={selected.html_body}
                  sandbox="allow-popups"
                  className="w-full border-0"
                  style={{ height: "80vh" }}
                />
              </div>
            </>
          ) : (
            <div className="card p-6 text-center text-sm text-fg-muted">
              {tableMissing
                ? "먼저 마이그레이션을 실행하세요."
                : "왼쪽 목록에서 리포트를 선택하거나, 오늘 리포트를 생성하세요."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
