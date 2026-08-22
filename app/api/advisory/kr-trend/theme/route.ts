import { NextResponse } from "next/server";
import { fetchNaverProfile } from "@/lib/advisory/naver";

export const runtime = "nodejs";

/**
 * 테마 설명 — LLM은 요약만. 숫자 생성 금지.
 * ANTHROPIC_API_KEY 없으면 개요 원문 기반 fallback.
 */
export async function POST(req: Request) {
  let body: { ticker?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, status: "blocked", error: "JSON이 필요합니다." }, { status: 400 });
  }
  const ticker = body.ticker?.trim();
  const name = body.name?.trim() || ticker || "";
  if (!ticker) {
    return NextResponse.json({ ok: false, status: "blocked", error: "ticker가 필요합니다." }, { status: 400 });
  }

  const profile = await fetchNaverProfile(ticker).catch(() => null);
  const summary = profile?.longBusinessSummary?.trim() || "";
  const asOf = new Date().toISOString();
  const source = profile?.source || "none";

  if (summary.length < 40) {
    return NextResponse.json({
      ok: true,
      status: "review",
      passed: false,
      themeName: "테마 검증 부족",
      evidence: "출처 부족 — 고객 확정 포트폴리오에 자동 반영하지 않습니다.",
      source,
      asOf,
      currency: "KRW",
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  let evidence = summary.slice(0, 500);
  let themeName = `${name} 사업개요 요약`;

  if (apiKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-haiku-20241022",
          max_tokens: 400,
          system: `당신은 국내 주식 테마 설명만 담당한다.
규칙:
- 제공된 회사개요 원문만 요약한다.
- 가격·수익률·이동평균·양봉·손익비를 만들지 마라.
- 단기 급등인지 단정하지 말고, 사업/섹터 테마를 2~3문장으로 설명한다.
- 투자 권유 금지.
- 첫 줄에 테마명(짧게), 이어서 근거 문장.`,
          messages: [
            {
              role: "user",
              content: `종목: ${name}(${ticker})\n회사개요 원문:\n${summary.slice(0, 1500)}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.content?.[0]?.text?.trim();
        if (text) {
          const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
          themeName = lines[0]?.replace(/^테마명[:：]\s*/, "") || themeName;
          evidence = lines.slice(1).join(" ") || text;
        }
      }
    } catch {
      /* fallback to raw summary */
    }
  }

  return NextResponse.json({
    ok: true,
    status: "pass",
    passed: true,
    themeName,
    evidence,
    source,
    asOf,
    currency: "KRW",
    note: "LLM은 설명만. 숫자는 엔진 계산값을 사용하세요.",
  });
}
