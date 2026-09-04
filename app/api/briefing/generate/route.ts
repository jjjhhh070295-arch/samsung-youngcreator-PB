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
import { isKnownPbRequest } from "@/lib/pbRequestAuth";
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

async function runGenerate(overwrite: boolean) {
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

    // stream() 으로 받는 이유: max_tokens 가 크면 SDK 가 non-streaming 요청을 아예 거부한다
    // ("Streaming is required for operations that may take longer than 10 minutes").
    // finalMessage() 는 스트림을 다 모아 create() 와 같은 Message 를 돌려주므로
    // 아래 파싱·usage 계산 코드는 그대로 쓴다.
    const msg = await client.messages.stream({
      model: MODEL,
      // 리포트 본문(HTML 전문 + 플레인텍스트 사본)이 한 응답에 다 들어가고, claude-sonnet-5 는
      // 사고(thinking) 토큰도 같은 예산에서 쓴다. 8000 으로는 JSON 이 중간에 잘려
      // stop_reason=max_tokens 로 끝나고 파싱이 항상 실패한다(2026-09-04 실측).
      max_tokens: 32000,
      system: systemPrompt,
      messages: [{ role: "user", content: "오늘자 데일리 마켓 인사이트 리포트를 작성하라." }],
      // 검색 1회는 왕복 시간 + 결과 본문이 다음 턴 입력에 그대로 실린다. 10회로는
      // 실측 433초가 나와 maxDuration(300)을 넘겼다 — Vercel 에서는 매일 잘려 실패한다.
      // 6회로 낮춰 300초 안에 들어오게 한다. 프롬프트의 "5~6회"와 짝이므로 한쪽만
      // 바꾸면 모델이 계획한 검색이 중간에 끊긴다.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    }).finalMessage();

    const durationSec = (Date.now() - startedAt) / 1000;

    const textBlocks = msg.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const lastText = textBlocks.length > 0 ? textBlocks[textBlocks.length - 1].text : "";
    const parsed = extractJson(lastText);

    if (!parsed) {
      // 왜 실패했는지 남기지 않으면 재시도밖에 할 수 있는 게 없고, 재시도는 매번 유료다.
      // 잘림(max_tokens)인지 형식 위반인지 구분할 수 있게 stop_reason·사용량·본문 양끝을 돌려준다.
      const diagnostics = {
        stopReason: (msg as any).stop_reason ?? null,
        textBlocks: textBlocks.length,
        textLength: lastText.length,
        usage: {
          inputTokens: (msg.usage as any)?.input_tokens ?? 0,
          outputTokens: (msg.usage as any)?.output_tokens ?? 0,
          webSearches: (msg.usage as any)?.server_tool_use?.web_search_requests ?? 0,
        },
        head: lastText.slice(0, 300),
        tail: lastText.slice(-300),
      };
      console.error("[/api/briefing/generate] PARSE_FAILED", diagnostics);
      return NextResponse.json(
        {
          ok: false,
          code: "PARSE_FAILED",
          error: "리포트 생성 결과를 파싱하지 못했습니다. 다시 시도하세요.",
          diagnostics,
        },
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

// Vercel Cron 은 GET 으로 호출한다 — POST 만 있으면 크론이 405 를 받고 조용히 실패한다.
// 크론은 덮어쓰지 않는다(overwrite=false): 이미 오늘 리포트가 있으면 ALREADY_EXISTS 로
// 끝나므로, 재시도가 겹쳐도 LLM 을 두 번 호출해 비용이 두 배로 나가지 않는다.
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return runGenerate(false);
}

// 수동 트리거 — 화면의 "오늘 리포트 생성" 버튼과 "덮어쓰고 다시 생성"이 여기로 온다.
//
// 크론 시크릿 또는 PB 인증 둘 중 하나면 통과한다. 브라우저에는 CRON_SECRET 을 둘 수
// 없으므로, 시크릿만 받으면 프로덕션에서 버튼이 항상 401 로 끝난다 — 화면에서 버튼을
// 열어 두려면 사람 쪽 경로가 하나 더 있어야 한다.
// 비용 주의: 1회 생성이 $1 수준이다. overwrite=false 면 같은 날 두 번째 호출은
// ALREADY_EXISTS 로 끝나 LLM 을 다시 부르지 않는다.
export async function POST(req: Request) {
  if (!isAuthorizedCronRequest(req) && !(await isKnownPbRequest(req))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { overwrite } = await req.json().catch(() => ({ overwrite: false }));
  return runGenerate(!!overwrite);
}
