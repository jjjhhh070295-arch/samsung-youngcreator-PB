// POST /api/research/snapshot  — 오늘 날짜의 자산군별 종합 신호를 daily_signal_snapshots에 박제
// GET  /api/research/snapshot  — Vercel Cron 자동 호출용 (동일 로직)
//
// 같은 날 이미 스냅샷이 있으면 skip (append-only, 덮어쓰기 없음).
// Authorization: Bearer {CRON_SECRET} 헤더로 보호(lib/cronAuth.ts) — fail-closed:
// 시크릿이 없으면 프로덕션에서는 무조건 거부한다(개발 환경 예외만 있음).
//
// 점수 계산: scoreResearchSignals(capFactor 방식) — 화면 신호와 동일 알고리즘.
// "화면에서 본 신호 = 백테스트에서 검증하는 신호" 일치 보장.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { SIGNAL_LIST } from "@/lib/researchAnalysis";
import type { AnalyzedSignal } from "@/lib/researchAnalysis";
import {
  SCORING_VERSION,
  WINDOW_DAYS,
  scoreResearchSignals,
  type MarketResearchItem,
} from "@/lib/portfolioResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stddev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return parseFloat(Math.sqrt(variance).toFixed(4));
}

async function runSnapshot(): Promise<NextResponse> {
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase 미설정" }, { status: 500 });
  }

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD (UTC 기준)

  try {
    // ─ 1. research_signals에서 윈도우 내 리포트 가져오기 ─
    //      source/title/url 포함 — scoreResearchSignals의 소스별 캡에 필수
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .split("T")[0]; // YYYY-MM-DD

    const { data, error } = await supabase
      .from("research_signals")
      .select("report_id, title, source, url, date, signals")
      .gte("date", cutoff) // WINDOW_DAYS 이내만 — 화면 withinAgeFloor와 동일 기준
      .order("date", { ascending: false })
      .limit(500); // 시간 윈도우로 이미 필터링되므로 넉넉히

    if (error) throw error;

    // 신호가 없는 리포트(표·차트 only 등)는 제외
    const validRows = (data ?? []).filter(
      (r: any) => Array.isArray(r.signals) && r.signals.length > 0,
    );

    // ─ 2. MarketResearchItem[] 변환 ─
    //      analysis 필드에 LLM 분석 결과 주입 → scoreResearchSignals가 direction×strength 반영
    const items: MarketResearchItem[] = validRows.map((r: any) => ({
      id:       r.report_id,
      title:    r.title    ?? "",
      source:   r.source   ?? "unknown",
      url:      r.url      ?? "",
      date:     r.date     ?? undefined,
      signals:  [],   // 키워드 폴백 불필요 — DB 행은 항상 LLM 분석 완료
      analysis: (r.signals as AnalyzedSignal[]).map((s) => ({
        signal:    s.signal,
        direction: s.direction,
        strength:  s.strength,
        // evidence는 AnalyzedSignalLite에 없으므로 제외
      })),
    }));

    // ─ 3. scoreResearchSignals 호출 — 화면과 동일한 capFactor 방식 ─
    const signalScores = scoreResearchSignals(items);

    // ─ 4. 자산군별 메타데이터 집계 (report_count / dispersion / contributing_ids) ─
    const meta: Record<string, { directions: number[]; reportIds: Set<string> }> = {};
    for (const sig of SIGNAL_LIST) meta[sig] = { directions: [], reportIds: new Set() };

    for (const item of items) {
      for (const a of item.analysis ?? []) {
        if (!SIGNAL_LIST.includes(a.signal as any)) continue;
        meta[a.signal].directions.push(a.direction);
        meta[a.signal].reportIds.add(item.id);
      }
    }

    // ─ 5. 행 조립 ─
    const rows = signalScores.map(({ signal, score }) => {
      const m = meta[signal] ?? { directions: [], reportIds: new Set() };
      const ids = Array.from(m.reportIds);
      return {
        snapshot_date:           today,
        asset_class:             signal,
        scoring_version:         SCORING_VERSION,
        score,                                        // capFactor × SIGNAL_SCALE, clamp ±10
        report_count:            ids.length,
        dispersion:              stddev(m.directions), // null = 리포트 1개 이하
        contributing_report_ids: ids,
      };
    });

    // ─ 6. INSERT — 같은 날 이미 있으면 DO NOTHING (append-only 원칙) ─
    const { error: insertError, data: inserted } = await supabase
      .from("daily_signal_snapshots")
      .upsert(rows, {
        onConflict:       "snapshot_date,asset_class",
        ignoreDuplicates: true, // ON CONFLICT DO NOTHING
      })
      .select("snapshot_date, asset_class");

    if (insertError) throw insertError;

    const insertedCount = (inserted ?? []).length;
    const skippedCount  = rows.length - insertedCount;

    console.log(
      `[snapshot] ${today}: inserted=${insertedCount}, skipped=${skippedCount}, ` +
      `reports=${items.length}, window=${WINDOW_DAYS}d, version=${SCORING_VERSION}`,
    );

    return NextResponse.json({
      ok:             true,
      snapshot_date:  today,
      scoring_version: SCORING_VERSION,
      window_days:    WINDOW_DAYS,
      inserted:       insertedCount,
      skipped:        skippedCount,     // > 0 이면 오늘 이미 스냅샷 있었음
      source_reports: items.length,
      asset_classes:  rows.map((r) => ({
        asset_class:     r.asset_class,
        score:           r.score,
        report_count:    r.report_count,
        dispersion:      r.dispersion,
      })),
    });
  } catch (e: any) {
    console.error("[/api/research/snapshot]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "실패" }, { status: 500 });
  }
}

// Vercel Cron은 GET으로 호출
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSnapshot();
}

// 수동 트리거 (curl -X POST 또는 버튼)
export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runSnapshot();
}
