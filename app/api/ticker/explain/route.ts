import { NextResponse } from "next/server";
import type { TickerSnapshot } from "@/lib/advisory/types";
import { sha256Hex, stableStringify } from "@/lib/advisory/control";

export const runtime = "nodejs";

function measuredLine(label: string, m: { value: number; unit: string; asOf: string; source: string; currency?: string } | null) {
  if (!m) return `${label}: 자료 없음`;
  const ccy = m.currency ? ` ${m.currency}` : "";
  return `${label}: ${m.value}${m.unit}${ccy} (as-of ${m.asOf}, source ${m.source})`;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  let body: { snapshot?: TickerSnapshot };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }
  const snapshot = body.snapshot;
  if (!snapshot?.resolvedSymbol || !snapshot.lastPrice) {
    return NextResponse.json({ ok: false, error: "결정론 스냅샷이 필요합니다." }, { status: 400 });
  }

  const facts = [
    `종목명: ${snapshot.name}`,
    `심볼: ${snapshot.resolvedSymbol} (${snapshot.exchange})`,
    measuredLine("현재가", snapshot.lastPrice),
    measuredLine("1개월 수익률", snapshot.periodReturns.m1),
    measuredLine("3개월 수익률", snapshot.periodReturns.m3),
    measuredLine("1년 수익률", snapshot.periodReturns.y1),
    measuredLine("YTD 수익률", snapshot.periodReturns.ytd),
    measuredLine("20일 연환산 변동성", snapshot.volatility.d20),
    measuredLine("60일 연환산 변동성", snapshot.volatility.d60),
    measuredLine("MDD", snapshot.mdd),
    measuredLine("SMA20", snapshot.movingAverages.sma20),
    measuredLine("SMA60", snapshot.movingAverages.sma60),
    measuredLine("RSI14", snapshot.rsi14),
    measuredLine("MACD", snapshot.macd.macd),
    measuredLine("MACD signal", snapshot.macd.signal),
    measuredLine("MACD histogram", snapshot.macd.histogram),
    `엔진 기술상태: ${snapshot.technicalState.summary}`,
  ].join("\n");

  const fallback = [
    `${snapshot.name}(${snapshot.resolvedSymbol})은 결정론 엔진 기준 ${snapshot.technicalState.summary}`,
    `최근 가격은 ${snapshot.lastPrice.value} ${snapshot.currency} (as-of ${snapshot.asOf}, ${snapshot.source}).`,
    snapshot.periodReturns.y1
      ? `1년 수익률 ${snapshot.periodReturns.y1.value}% , 변동성(20일) ${snapshot.volatility.d20?.value ?? "n/a"}%, MDD ${snapshot.mdd?.value ?? "n/a"}%.`
      : "장기 수익률 자료가 짧습니다.",
    "숫자는 엔진 계산값이며, 이 설명은 해석만 제공합니다. 투자 권유가 아닙니다.",
  ].join(" ");

  if (!apiKey) {
    const inputHash = await sha256Hex(stableStringify({ symbol: snapshot.resolvedSymbol, asOf: snapshot.asOf }));
    const outputHash = await sha256Hex(fallback);
    return NextResponse.json({
      ok: true,
      explanation: fallback,
      model: "fallback-template",
      evidence: { inputHash, outputHash, engine: "explain-fallback" },
    });
  }

  const system = `당신은 PB가 고객에게 종목을 쉽게 설명하도록 돕는 보조 도구다.
규칙:
- 아래 FACTS의 숫자·as-of·출처를 그대로 사용한다. 새로운 수익률, 변동성, MDD, RSI, MACD, 목표가, 비중, 세금, VaR/CVaR를 만들지 마라.
- 쉬운 말로 (1) 무슨 회사/상품인지 (2) 최근 오르거나 내린 맥락을 FACTS 범위에서만 (3) 기술적 지표 상태를 설명한다.
- 투자 권유, 매수/매도 확정 표현 금지. 마지막에 "참고용이며 투자 권유가 아닙니다"를 넣는다.
- 3~6문장, 한국어.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system,
        messages: [{ role: "user", content: `FACTS\n${facts}` }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const data: any = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    const explanation = text || fallback;
    const inputHash = await sha256Hex(facts);
    const outputHash = await sha256Hex(explanation);
    return NextResponse.json({
      ok: true,
      explanation,
      model: data?.model ?? "claude",
      evidence: { inputHash, outputHash, engine: "ai-explain-only" },
    });
  } catch (e: any) {
    const inputHash = await sha256Hex(facts);
    const outputHash = await sha256Hex(fallback);
    return NextResponse.json({
      ok: true,
      explanation: fallback,
      model: "fallback-error",
      error: e?.message,
      evidence: { inputHash, outputHash, engine: "explain-fallback" },
    });
  }
}
