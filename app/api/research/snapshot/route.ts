// POST /api/research/snapshot  — 오늘 날짜의 자산군별 종합 신호를 daily_signal_snapshots에 박제
// GET  /api/research/snapshot  — Vercel Cron 자동 호출용 (동일 로직)
//
// 같은 날 이미 스냅샷이 있으면 skip (append-only, 덮어쓰기 없음).
// CRON_SECRET 환경변수와 Authorization: Bearer {secret} 헤더로 보호.
// 인증 설정이 없으면 개발 환경에서도 요청을 열지 않고 503으로 차단.
//
// 점수 계산: scoreResearchSignals(capFactor 방식) — 화면 신호와 동일 알고리즘.
// "화면에서 본 신호 = 백테스트에서 검증하는 신호" 일치 보장.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isApprovedResearchModel, SIGNAL_LIST } from "@/lib/researchAnalysis";
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
  // 인증을 통과한 뒤에만 Supabase 모듈을 불러온다. 인증 설정 누락/실패 요청은
  // client 초기화나 데이터 조회 코드에 도달하지 않는다.
  const { supabase } = await import("@/lib/supabase");
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
      .select("report_id, title, source, url, date, signals, model")
      .gte("date", cutoff) // WINDOW_DAYS 이내만 — 화면 withinAgeFloor와 동일 기준
      .order("date", { ascending: false })
      .limit(500); // 시간 윈도우로 이미 필터링되므로 넉넉히

    if (error) throw error;

    // 신호가 없는 리포트(표·차트 only 등)는 제외
    const validRows = (data ?? []).filter(
      (r: any) => isApprovedResearchModel(r.model) && Array.isArray(r.signals) && r.signals.length > 0,
    );

    if (validRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "PB 승인 Evidence가 없어 신호 스냅샷 생성을 차단했습니다." },
        { status: 409 },
      );
    }

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

type SnapshotAuthorization =
  | { ok: true; principal: "cron-secret" }
  | { ok: false; status: 401 | 503; code: "AUTH_NOT_CONFIGURED" | "UNAUTHORIZED" };

type SnapshotExecutor = () => Promise<Response>;

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

// 현재 이 Route Handler에 연결된 신뢰 가능한 서버-principal adapter는 없다.
// x-vercel-cron 같은 호출자 제어 헤더를 승인 근거로 사용하지 않는다.
// 향후 서버 세션/서비스 계정을 연결할 때도 검증이 끝난 principal만 별도 adapter로
// 전달해야 하며, 이 외부 HTTP 요청 자체가 주장하는 principal은 신뢰하지 않는다.
function authorizeSnapshotRequest(req: Request): SnapshotAuthorization {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.trim().length === 0) {
    return { ok: false, status: 503, code: "AUTH_NOT_CONFIGURED" };
  }

  const token = bearerToken(req);
  if (!token || !constantTimeEqual(token, secret)) {
    return { ok: false, status: 401, code: "UNAUTHORIZED" };
  }

  return { ok: true, principal: "cron-secret" };
}

async function handleSnapshotRequest(
  req: Request,
  execute: SnapshotExecutor = runSnapshot,
): Promise<Response> {
  const authorization = authorizeSnapshotRequest(req);
  if (!authorization.ok) {
    const message = authorization.status === 503
      ? "Snapshot authorization is not configured."
      : "Unauthorized";
    return NextResponse.json(
      { ok: false, error: message, code: authorization.code },
      {
        status: authorization.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  return execute();
}

// Vercel Cron은 GET으로 호출
export async function GET(req: Request) {
  return handleSnapshotRequest(req);
}

// 수동 트리거 (curl -X POST 또는 버튼)
export async function POST(req: Request) {
  return handleSnapshotRequest(req);
}
