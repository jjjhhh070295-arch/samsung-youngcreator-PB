// POST /api/briefing/generate — 오늘자 모닝 브리핑(공통 시장 리포트) 생성
//
// 고객 개인정보는 이 라우트에 절대 들어오지 않는다 — 요청 바디는 overwrite 플래그뿐이고,
// LLM에는 시장 공통 프롬프트만 전달한다. 개인화(고객별 발송)는 여기서 다루지 않는다.
//
// Authorization: Bearer {CRON_SECRET} 헤더로 보호(lib/cronAuth.ts) — fail-closed.
// 개발 환경(NODE_ENV=development)에서는 시크릿 없이도 통과한다.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildBriefingSystemPrompt } from "@/lib/briefing/prompt";

export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Hobby 최대치 — 웹 검색 8~10회 포함 생성 소요시간 확보

const MODEL = "claude-sonnet-5";
const PRICE_INPUT_PER_MTOK = 2; // $ / 1M input tokens
const PRICE_OUTPUT_PER_MTOK = 10; // $ / 1M output tokens
const PRICE_PER_WEB_SEARCH = 0.01; // $ / 검색 1건

// SELECT 필터에서 없는 컬럼(42703)과, PostgREST가 스키마 캐시에서 테이블 자체를
// 못 찾을 때(PGRST205)/Postgres가 테이블 자체가 없다고 할 때(42P01) 모두 "마이그레이션
// 미실행"으로 간주한다.
const MISSING_TABLE_ERROR_CODES = new Set(["42P01", "PGRST205"]);
const NO_TABLE_MESSAGE =
  "daily_reports 테이블이 아직 없습니다. supabase-migration-daily-reports.sql 을 Supabase SQL Editor에서 먼저 실행하세요.";

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function kstDateString(): string {
  return kstNow().toISOString().slice(0, 10);
}

function kstDateLabel(): string {
  const kst = kstNow();
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 (${weekday})`;
}

function extractJson(text: string): any | null {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json(
      { ok: false, code: "NO_DB", error: "Supabase가 설정되지 않았습니다(.env.local 확인)." },
      { status: 200 },
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, code: "NO_KEY", error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다." },
      { status: 200 },
    );
  }

  const { overwrite } = await req.json().catch(() => ({ overwrite: false }));
  const reportDate = kstDateString();

  const { data: existing, error: existErr } = await supabase
    .from("daily_reports")
    .select("id, report_date")
    .eq("report_date", reportDate)
    .maybeSingle();

  if (existErr) {
    if (MISSING_TABLE_ERROR_CODES.has((existErr as any).code)) {
      return NextResponse.json({ ok: false, code: "NO_TABLE", error: NO_TABLE_MESSAGE }, { status: 200 });
    }
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: existErr.message },
      { status: 200 },
    );
  }

  if (existing && !overwrite) {
    return NextResponse.json(
      {
        ok: false,
        code: "ALREADY_EXISTS",
        error: `오늘(${reportDate}) 리포트가 이미 있습니다. 덮어쓰려면 overwrite를 켜고 다시 생성하세요.`,
      },
      { status: 200 },
    );
  }

  const startedAt = Date.now();
  try {
    const client = new Anthropic({ apiKey });
    const systemPrompt = buildBriefingSystemPrompt(kstDateLabel());

    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: "user", content: "오늘자 데일리 마켓 인사이트 리포트를 작성하라." }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    });

    const durationSec = (Date.now() - startedAt) / 1000;

    const textBlocks = msg.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
    const parsed = extractJson(lastText);

    if (!parsed) {
      return NextResponse.json(
        { ok: false, code: "PARSE_FAILED", error: "리포트 생성 결과를 파싱하지 못했습니다. 다시 시도하세요." },
        { status: 200 },
      );
    }

    if (parsed.error) {
      return NextResponse.json(
        { ok: false, code: "GENERATION_FAILED", error: String(parsed.error) },
        { status: 200 },
      );
    }

    const { headline, html_body, text_body, sources } = parsed;
    if (!headline || !html_body || !text_body) {
      return NextResponse.json(
        { ok: false, code: "PARSE_FAILED", error: "리포트 생성 결과에 필수 필드가 없습니다. 다시 시도하세요." },
        { status: 200 },
      );
    }

    const usage: any = msg.usage;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const webSearchCount = usage.server_tool_use?.web_search_requests ?? 0;
    const costUsd =
      (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
      (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK +
      webSearchCount * PRICE_PER_WEB_SEARCH;

    const row = {
      report_date: reportDate,
      headline: String(headline),
      html_body: String(html_body),
      text_body: String(text_body),
      sources: Array.isArray(sources) ? sources : [],
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      web_search_count: webSearchCount,
      cost_usd: Number(costUsd.toFixed(4)),
      duration_sec: Number(durationSec.toFixed(1)),
      generated_at: new Date().toISOString(),
      status: "draft",
    };

    const { data: saved, error: upsertError } = await supabase
      .from("daily_reports")
      .upsert(row, { onConflict: "report_date" })
      .select()
      .single();

    if (upsertError) {
      if (MISSING_TABLE_ERROR_CODES.has((upsertError as any).code)) {
        return NextResponse.json({ ok: false, code: "NO_TABLE", error: NO_TABLE_MESSAGE }, { status: 200 });
      }
      throw upsertError;
    }

    return NextResponse.json({ ok: true, report: saved });
  } catch (e: any) {
    console.error("[/api/briefing/generate]", e);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: e?.message ?? "리포트 생성 중 오류가 발생했습니다." },
      { status: 200 },
    );
  }
}
