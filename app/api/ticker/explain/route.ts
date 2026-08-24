import { NextResponse } from "next/server";
import type { TickerProfile, TickerSnapshot } from "@/lib/advisory/types";
import { sha256Hex, stableStringify } from "@/lib/advisory/control";
import { validateTickerExplanation } from "@/lib/advisory/tickerExplanationSafety";

export const runtime = "nodejs";

function measuredLine(label: string, m: { value: number; unit: string; asOf: string; source: string; currency?: string } | null) {
  if (!m) return `${label}: 자료 없음 (임의값 없음)`;
  const ccy = m.currency ? ` ${m.currency}` : "";
  return `${label}: ${m.value}${m.unit}${ccy} (as-of ${m.asOf}, source ${m.source})`;
}

function compactProfileSummary(summary: string, maxLength = 360) {
  const normalized = summary.replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?。]+[.!?。]?/g) ?? [normalized];
  const firstTwo = sentences.slice(0, 2).join(" ").trim();
  const value = firstTwo || normalized;
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}…` : value;
}

function momentumFacts(snapshot: TickerSnapshot) {
  const momentum = snapshot.momentum;
  if (momentum.status === "unavailable" || momentum.status === "blocked") {
    return [
      `모멘텀 데이터 상태: ${momentum.status}`,
      `모멘텀 계산 결과: 자료 없음 — ${momentum.warnings.join(" / ") || "승인된 자료 없음"}`,
    ];
  }
  const printable = (value: number | null, suffix = "") => value == null ? "자료 없음" : `${value}${suffix}`;
  return [
    `모멘텀 데이터: ${momentum.label} / ${momentum.datasetId} / ${momentum.version}`,
    `모멘텀 기준일·출처: ${momentum.asOf} / ${momentum.source}`,
    `수정 기준: ${momentum.adjustmentStatus} / ${momentum.adjustmentBasis}`,
    `52주 상태: ${momentum.proximityState}; 오늘 수정고가 ${printable(momentum.currentAdjustedHigh)}; 직전 252거래일 수정고가 최댓값 ${printable(momentum.prior252High)}; 현재 수정종가 거리 ${printable(momentum.distanceToPriorHighPct, "%")}`,
    `거래일 수익률: 20일 ${printable(momentum.returnsPct.d20, "%")}; 60일 ${printable(momentum.returnsPct.d60, "%")}; 120일 ${printable(momentum.returnsPct.d120, "%")}; 252일 ${printable(momentum.returnsPct.d252, "%")}`,
    `수정종가 이동평균: SMA20 ${printable(momentum.movingAverages.sma20)}; SMA60 ${printable(momentum.movingAverages.sma60)}; SMA120 ${printable(momentum.movingAverages.sma120)}`,
    `거래량 배수: ${printable(momentum.volumeRatio20, "배")} (오늘 / 오늘 제외 직전 20거래일 평균)`,
    `모멘텀 경고: ${momentum.warnings.join(" / ") || "없음"}`,
  ];
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  let body: { snapshot?: TickerSnapshot; profile?: TickerProfile | null; mode?: "brief" | "full" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, status: "blocked", error: "JSON이 필요합니다." }, { status: 400 });
  }
  const snapshot = body.snapshot;
  const profile = body.profile ?? null;
  const mode = body.mode === "brief" ? "brief" : "full";
  if (!snapshot?.resolvedSymbol || !snapshot.lastPrice) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      error: "결정론 스냅샷이 필요합니다. 시세 실패 시 설명을 만들지 않습니다.",
    }, { status: 400 });
  }

  const facts = [
    `종목명: ${snapshot.name}`,
    `심볼: ${snapshot.resolvedSymbol} (${snapshot.exchange})`,
    measuredLine("현재가", snapshot.lastPrice),
    measuredLine("1일 수익률", snapshot.periodReturns.d1),
    measuredLine("1개월 수익률", snapshot.periodReturns.m1),
    measuredLine("6개월 수익률", snapshot.periodReturns.m6),
    measuredLine("1년 수익률", snapshot.periodReturns.y1),
    measuredLine("20일 연환산 변동성", snapshot.volatility.d20),
    measuredLine("MDD", snapshot.mdd),
    measuredLine("SMA5", snapshot.movingAverages.sma5),
    measuredLine("SMA20", snapshot.movingAverages.sma20),
    measuredLine("SMA60", snapshot.movingAverages.sma60),
    measuredLine("SMA120", snapshot.movingAverages.sma120),
    measuredLine("RSI14", snapshot.rsi14),
    measuredLine("MACD histogram", snapshot.macd.histogram),
    `엔진 기술상태: ${snapshot.technicalState.summary}`,
    ...momentumFacts(snapshot),
    `업종: ${profile?.sector ?? "자료 없음"} / ${profile?.industry ?? "자료 없음"}`,
    `회사개요 (${profile?.source ?? "출처 없음"}): ${profile?.longBusinessSummary ? profile.longBusinessSummary.slice(0, 1200) : "없음 — 회사를 추측하지 말 것"}`,
  ].join("\n");

  const briefFallback = profile?.longBusinessSummary
    ? compactProfileSummary(profile.longBusinessSummary)
    : `${snapshot.name}(${snapshot.resolvedSymbol})의 회사 개요 원문을 받지 못해 임의 설명을 하지 않습니다.`;

  const fullFallback = [
    briefFallback,
    `최근 추세(엔진): ${snapshot.technicalState.trend}.`,
    `기술지표(엔진): ${snapshot.technicalState.rsiState}. ${snapshot.technicalState.macdState}.`,
    snapshot.momentum.status === "ok" || snapshot.momentum.status === "warning"
      ? `52주 근거(엔진): ${snapshot.momentum.proximityState}, 직전 고가 대비 현재 수정종가 거리 ${snapshot.momentum.distanceToPriorHighPct ?? "계산 불가"}%.`
      : "52주 근거(엔진): 승인된 자료가 없어 계산하지 않았습니다.",
    "숫자는 엔진 계산값이며 투자 권유가 아닙니다.",
  ].join(" ");

  const fallback = mode === "brief" ? briefFallback : fullFallback;
  const explainInput = stableStringify({ mode, facts });

  const system = mode === "brief"
    ? `당신은 종목 회사 개요만 한국어 2~3문장으로 요약한다.
규칙:
- 제공된 회사개요가 있으면 그 내용만 요약한다.
- 회사개요가 "없음"이면 업종 한 줄만 말하고, 사업을 추측하거나 숫자(가격·수익률·RSI 등)를 만들지 마라.
- FACTS의 수익률/가격을 개요에 넣지 마라.
- 투자 권유 금지.`
    : `당신은 PB가 고객에게 종목을 쉽게 설명하도록 돕는 보조 도구다.
규칙:
- FACTS의 숫자·as-of·출처를 그대로 사용한다. 새로운 수익률, 변동성, MDD, RSI, MACD, 목표가, 비중, 세금, VaR/CVaR를 만들지 마라.
- 52주 신고가·근접·수익률·이동평균·거래량은 FACTS의 결정론 결과만 설명하고 값을 다시 계산하거나 보완하지 마라.
- 쉬운 말로 (1) 회사 개요 (제공처 원문 범위만) (2) 최근 추세 (엔진 기술상태) (3) 기술적 지표 해석을 설명한다.
- 회사개요가 없으면 회사 설명을 지어내지 말고 "개요 자료 없음"이라고 한다.
- 미래 성과 확률이나 매수·매도·비중 변경을 권하는 표현 금지. 마지막에 "참고용이며 투자 권유가 아닙니다"를 넣는다.
- 한국어, 5~8문장.`;

  if (!apiKey) {
    const inputHash = await sha256Hex(explainInput);
    const outputHash = await sha256Hex(fallback);
    return NextResponse.json({
      ok: true,
      explanation: fallback,
      model: "fallback-template",
      evidence: { inputHash, outputHash, engine: "explain-fallback" },
    });
  }

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
        max_tokens: mode === "brief" ? 280 : 700,
        system,
        messages: [{ role: "user", content: `FACTS\n${facts}` }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const data: any = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    const safety = text ? validateTickerExplanation(text, facts) : { passed: false, reason: "모델 응답 없음" };
    const explanation = text && safety.passed ? text : fallback;
    const inputHash = await sha256Hex(explainInput);
    const outputHash = await sha256Hex(explanation);
    return NextResponse.json({
      ok: true,
      explanation,
      model: safety.passed ? (data?.model ?? "claude") : "fallback-safety",
      safety,
      evidence: { inputHash, outputHash, engine: "ai-explain-only" },
    });
  } catch (e: any) {
    const inputHash = await sha256Hex(explainInput);
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
