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
import { htmlToText } from "@/lib/briefing/htmlToText";

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
      // 이 호출은 출력 토큰 생성 속도에 묶여 있다 — 실측 두 회차 모두 약 90 tok/s 로,
      // 소요시간이 출력 토큰 수에 거의 정비례한다(433.1s/38,447tok, 417.3s/37,721tok).
      // sonnet-5 는 thinking 파라미터를 생략하면 adaptive thinking 이 켜지고
      // output_config.effort 는 지정이 없으면 high 다. 즉 지금까지는 최대 사고 예산으로
      // 돌고 있었고, 출력의 상당 부분이 리포트가 아니라 사고 토큰이었다.
      // effort 를 낮추는 것이 리포트 사양을 하나도 건드리지 않고 시간을 줄이는 유일한 축이다.
      output_config: { effort: "medium" },
      // 검색 횟수는 시간을 지배하지 않는다 — 10→6 으로 줄였을 때 433.1s→417.3s 로
      // 15.8초(3.6%)밖에 줄지 않았고, 대신 "데이터 확인 안 됨"이 8→18개로 늘었다.
      // 검색 1회의 실측 비용은 약 4초뿐이라 여기서 깎을 수 있는 시간이 없다.
      // 프롬프트의 "8~10회"와 짝이므로 한쪽만 바꾸면 모델이 계획한 검색이 중간에 끊긴다.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    }).finalMessage();

    const durationSec = (Date.now() - startedAt) / 1000;

    // 최종 JSON 은 text 블록 하나로 오지 않는다. web_search 결과에는 인용(citation)이
    // 붙고, 인용이 걸린 구간마다 text 블록이 쪼개진다 — 2026-09-04 실측에서 리포트 하나가
    // 42개 블록으로 나뉘어 왔다. 예전처럼 마지막 블록만 집으면 표 중간부터 시작하는
    // 조각을 파싱하게 되어 stop_reason=end_turn(정상 종료)인데도 PARSE_FAILED 로 끝난다.
    //
    // 검색 중간의 모델 코멘트까지 같이 붙이면 그 안의 중괄호가 JSON 시작으로 오인될 수
    // 있으므로, 마지막 도구 블록(tool_use·server_tool_use·web_search_tool_result) 이후의
    // text 블록만 이어 붙인다. 도구를 한 번도 안 썼으면 전체를 잇는다.
    const lastToolIdx = msg.content.reduce((acc, b, i) => (b.type !== "text" ? i : acc), -1);
    const textBlocks = msg.content.slice(lastToolIdx + 1).filter(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    const lastText = textBlocks.map((b) => b.text).join("");
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
          thinkingTokens: (msg.usage as any)?.output_tokens_details?.thinking_tokens ?? null,
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

    const { headline, html_body, sources } = parsed;
    if (!headline || !html_body) {
      return NextResponse.json(
        { ok: false, code: "PARSE_FAILED", error: "리포트 생성 결과에 필수 필드가 없습니다. 다시 시도하세요." },
        { status: 200 },
      );
    }

    // text_body 는 모델에게 시키지 않고 여기서 만든다 — 같은 내용을 두 번 쓰게 하면
    // 출력 토큰이 3,000 가까이 늘고, 이 호출은 출력 속도에 묶여 있어 그게 곧 시간이다.
    const textBody = htmlToText(String(html_body));

    const usage: any = msg.usage;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const webSearchCount = usage.server_tool_use?.web_search_requests ?? 0;
    // 출력 토큰 중 사고(thinking)에 쓰인 몫. effort 를 조정할 때 무엇이 줄었는지
    // 이 값 없이는 알 수 없어서 남긴다 — daily_reports 에 컬럼을 늘리지 않으려고
    // 저장하지 않고 로그와 응답에만 싣는다.
    const thinkingTokens = usage.output_tokens_details?.thinking_tokens ?? null;
    const costUsd =
      (inputTokens / 1_000_000) * PRICE_INPUT_PER_MTOK +
      (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_MTOK +
      webSearchCount * PRICE_PER_WEB_SEARCH;

    const row = {
      report_date: reportDate,
      headline: String(headline),
      html_body: String(html_body),
      text_body: textBody,
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

    console.log("[/api/briefing/generate] done", {
      durationSec: row.duration_sec,
      inputTokens,
      outputTokens,
      thinkingTokens,
      webSearchCount,
      costUsd: row.cost_usd,
    });

    return NextResponse.json({ ok: true, report: saved, thinkingTokens });
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
