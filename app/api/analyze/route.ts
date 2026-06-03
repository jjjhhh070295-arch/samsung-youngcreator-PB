import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { emptyIPS, FACTOR_KEYS, type IPS, type IPSFactor } from "@/lib/types";

export const runtime = "nodejs";

// 전문 텍스트 → RRTTLLU 7요인 (보수적 채점 · 근거 인용 · 공백 허용)

const SYSTEM_PROMPT = `당신은 PB(프라이빗뱅커)의 상담 기록을 분석해 고객의 RRTTLLU 7요인 투자성향을 구조화하는 보조 도구다.

[7요인]
- return: 목표 수익률
- risk: 위험 허용도
- timeHorizon: 투자 기간
- tax: 세금 요인
- liquidity: 유동성 필요 시기
- legal: 법적/규제 제약
- unique: 고객 고유 상황

[오류·과대계상 방지 규칙 — 매우 중요]
각 요인을 반드시 다음 셋 중 하나로 분류한다.
1) "explicit" (직접 근거 있음): 상담 원문에 명시적 근거가 있을 때만. 점수(1~5)를 매기고, 근거가 된 원문 구절을 evidence에 그대로 인용한다.
2) "inferred" (추론 단서만 있음): 직접 언급은 없으나 정황 단서가 있을 때. score는 반드시 null로 두고(점수 금지), 단서 설명을 inferenceHint에 적는다. (추론을 점수로 반영하지 말 것)
3) "empty" (근거·단서 없음): 아무 정보 없음. value/evidence/inferenceHint 모두 빈 문자열, score는 null.

[채점 원칙]
- 애매하면 낮게, 명시적 근거가 강할 때만 높게(보수적).
- 추정값을 점수로 박지 말 것. 공백을 허용하고 임의값으로 채우지 말 것.
- 점수 1~5: 높을수록 해당 요인 수준이 큼(위험 허용도↑, 투자기간↑, 세금 민감도↑ 등).

[출력 형식]
반드시 아래 JSON만 출력한다. 코드펜스·설명·인사말 금지. 모든 요인 키를 포함한다.
{
  "return":     {"status":"explicit|inferred|empty","value":"","score":null,"evidence":"","inferenceHint":""},
  "risk":       {...},
  "timeHorizon":{...},
  "tax":        {...},
  "liquidity":  {...},
  "legal":      {...},
  "unique":     {...}
}`;

// 코드펜스/군더더기 제거 후 JSON 추출
function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  // ```json ... ``` 펜스 제거
  t = t.replace(/```(?:json)?/gi, "").trim();
  // 첫 { 부터 마지막 } 까지
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// AI 원시 결과 → 안전한 IPS (방어적 정규화)
function normalizeToIPS(raw: any): IPS {
  const ips = emptyIPS("ai");
  if (!raw || typeof raw !== "object") return ips;

  for (const key of FACTOR_KEYS) {
    const r = raw[key];
    if (!r || typeof r !== "object") continue;

    const status: IPSFactor["status"] =
      r.status === "explicit" || r.status === "inferred" || r.status === "empty"
        ? r.status
        : "empty";

    let score: number | null = null;
    if (status === "explicit" && typeof r.score === "number") {
      score = Math.max(1, Math.min(5, Math.round(r.score)));
    }
    // inferred/empty 는 점수 강제로 null (과대계상 방지)

    ips[key] = {
      value: typeof r.value === "string" ? r.value : "",
      score,
      notes: "",
      source: "ai",
      status,
      evidence: status === "explicit" && typeof r.evidence === "string" ? r.evidence : "",
      inferenceHint:
        status === "inferred" && typeof r.inferenceHint === "string" ? r.inferenceHint : "",
      reviewed: false, // AI 결과는 draft
    };
  }
  return ips;
}

async function callClaude(client: Anthropic, notes: string, strict: boolean) {
  const userText = strict
    ? `다음 상담 기록을 분석하라. 반드시 JSON만 출력하고 다른 텍스트는 절대 쓰지 마라.\n\n상담 기록:\n${notes}`
    : `다음 상담 기록을 RRTTLLU 7요인으로 분석하라.\n\n상담 기록:\n${notes}`;

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const block = msg.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

export async function POST(req: Request) {
  try {
    const { notes } = await req.json().catch(() => ({ notes: "" }));
    if (!notes || typeof notes !== "string" || !notes.trim()) {
      return NextResponse.json(
        { ok: false, error: "분석할 상담 텍스트가 비어 있습니다." },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_KEY",
          error:
            "ANTHROPIC_API_KEY 가 설정되지 않았습니다. .env.local 에 키를 넣거나, '7요인 직접 입력' 탭에서 수동으로 입력하세요.",
        },
        { status: 200 },
      );
    }

    const client = new Anthropic({ apiKey });

    // ── 1차 시도 ──
    let text = await callClaude(client, notes, false);
    let parsed = extractJson(text);

    // ── 2차: "JSON만" 강조 재요청 ──
    if (!parsed) {
      text = await callClaude(client, notes, true);
      parsed = extractJson(text);
    }

    // ── 3차 실패: 수동 입력 유도 ──
    if (!parsed) {
      return NextResponse.json(
        {
          ok: false,
          code: "PARSE_FAILED",
          error:
            "자동 분석에 실패했습니다. '7요인 직접 입력' 탭에서 직접 입력하시겠어요?",
        },
        { status: 200 },
      );
    }

    const ips = normalizeToIPS(parsed);
    return NextResponse.json({ ok: true, ips });
  } catch (e: any) {
    console.error("[/api/analyze]", e);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error:
          "분석 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 직접 입력하세요. (" +
          (e?.message ?? "unknown") +
          ")",
      },
      { status: 200 },
    );
  }
}
