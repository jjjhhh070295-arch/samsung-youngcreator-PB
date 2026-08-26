import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FACTOR_KEYS, FACTOR_META, type FactorKey } from "@/lib/types";
import { SCORE_RUBRIC, QUANT_FACTORS } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 정성 요인 채점 — PB가 직접 적은 값(value)을 기준표에 맞춰 1~5점으로 매긴다.
// 정량(return/risk/timeHorizon)은 규칙 자동채점(autoScoreFromValue)이라 여기서 제외한다.

function extractJson(text: string): any | null {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const s = t.indexOf("{");
  const e = t.lastIndexOf("}");
  if (s === -1 || e <= s) return null;
  try {
    return JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
}

function rubricFor(keys: FactorKey[]): string {
  return keys
    .map((k) => {
      const label = FACTOR_META.find((m) => m.key === k)?.label ?? k;
      const bands = SCORE_RUBRIC[k].map((d, i) => `${i + 1}점=${d}`).join(", ");
      return `- ${k} (${label}): ${bands}`;
    })
    .join("\n");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({ factors: [] }));
    const input: { key: FactorKey; value: string }[] = Array.isArray(body.factors) ? body.factors : [];

    // 정성 + 값 있음 + 유효 키만 채점 대상
    const targets = input.filter(
      (f) =>
        f &&
        typeof f.value === "string" &&
        f.value.trim() &&
        FACTOR_KEYS.includes(f.key) &&
        !QUANT_FACTORS.includes(f.key),
    );
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, scores: {} });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, code: "NO_KEY", error: "ANTHROPIC_API_KEY 미설정 — 점수를 수동으로 선택하세요." },
        { status: 200 },
      );
    }

    const keys = targets.map((t) => t.key);
    const system = `당신은 PB 상담의 정성 요인을 점수화하는 도구다.
아래 각 요인에 대해 PB가 적은 "값/설명"을 읽고, 주어진 기준표에 맞춰 1~5점을 매긴다.

[채점 기준표]
${rubricFor(keys)}

[규칙]
- 점수가 높을수록 그 요인의 수준/강도가 큼.
- 적힌 내용이 기준표의 어느 구간에 가장 가까운지 판단한다. 애매하면 보수적으로(낮게).
- evidence에는 그렇게 본 근거를 적힌 값에서 한 줄로 요약/인용한다. 입력된 값에 실제로 있는 내용만 쓰고, 없는 사실을 지어내지 말 것.
- 반드시 아래 JSON만 출력. 코드펜스·설명 금지.
{"<요인키>":{"score":3,"evidence":"..."}, ...}`;

    const userText = targets.map((t) => `- ${t.key}: ${t.value}`).join("\n");

    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: `다음 요인 값들을 채점하라:\n${userText}` }],
    });
    const block = msg.content.find((b) => b.type === "text");
    const parsed = extractJson(block && block.type === "text" ? block.text : "");
    if (!parsed) {
      return NextResponse.json(
        { ok: false, code: "PARSE_FAILED", error: "요인 채점 결과를 읽지 못했습니다. 점수를 수동으로 선택하세요." },
        { status: 200 },
      );
    }

    // 안전 정규화: 대상 키만, 1~5 클램프
    const scores: Record<string, { score: number; evidence: string }> = {};
    for (const key of keys) {
      const r = parsed[key];
      if (!r || typeof r.score !== "number") continue;
      scores[key] = {
        score: Math.max(1, Math.min(5, Math.round(r.score))),
        evidence: typeof r.evidence === "string" ? r.evidence.slice(0, 200) : "",
      };
    }

    return NextResponse.json({ ok: true, scores });
  } catch (e: any) {
    console.error("[/api/analyze/factors]", e);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: e?.message ?? "채점 실패" },
      { status: 200 },
    );
  }
}
