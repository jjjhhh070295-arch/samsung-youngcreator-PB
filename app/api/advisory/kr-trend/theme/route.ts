import { NextResponse } from "next/server";
import { judgeThemeFromReports, type ThemeSourceDoc } from "@/lib/advisory/themeFromResearch";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * 테마 판정 — 리포트 출처 기반. LLM은 선택적 요약만(숫자 생성 금지).
 * heuristic(회사개요만 pass) 제거.
 */
export async function POST(req: Request) {
  let body: { ticker?: string; name?: string; sources?: ThemeSourceDoc[] };
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

  let sources: ThemeSourceDoc[] = Array.isArray(body.sources) ? body.sources : [];

  if (sources.length === 0 && isSupabaseConfigured && supabase) {
    try {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("research_reports")
        .select("title, source, published_at, url, summary, tickers")
        .gte("published_at", since)
        .limit(40);
      sources = ((data ?? []) as Array<Record<string, unknown>>)
        .filter((r) => {
          const hay = `${r.title ?? ""} ${r.summary ?? ""} ${JSON.stringify(r.tickers ?? [])}`;
          return hay.includes(ticker) || (name && hay.includes(name));
        })
        .map((r) => ({
          title: String(r.title ?? ""),
          publisher: String(r.source ?? "research"),
          publishedAt: String(r.published_at ?? ""),
          url: String(r.url ?? ""),
        }));
    } catch {
      /* ignore */
    }
  }

  let themeName = `${name} 테마`;
  let evidence = sources.map((s) => s.title);

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey && sources.length > 0) {
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
          system: `당신은 리포트 테마 추출만 담당한다.
규칙:
- 제공된 리포트 제목/출처만 사용한다.
- 가격·수익률·이동평균·확률을 만들지 마라.
- 단기 급등인지 단정하지 말고 중기 테마 근거만 요약한다.
- JSON만 반환: {"themeName":"...","evidence":["..."]}`,
          messages: [
            {
              role: "user",
              content: `종목 ${name}(${ticker})\n문서:\n${sources
                .slice(0, 8)
                .map((s) => `- ${s.title} | ${s.publisher} | ${s.publishedAt} | ${s.url}`)
                .join("\n")}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.content?.[0]?.text?.trim() ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as { themeName?: string; evidence?: string[] };
          if (parsed.themeName) themeName = parsed.themeName;
          if (parsed.evidence?.length) evidence = parsed.evidence;
        }
      }
    } catch {
      /* keep deterministic judge */
    }
  }

  const judged = judgeThemeFromReports({ themeName, evidence, sources });
  return NextResponse.json({
    ok: true,
    ...judged,
    passed: judged.status === "pass",
    currency: "KRW",
  });
}
