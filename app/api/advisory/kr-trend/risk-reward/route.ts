import { NextResponse } from "next/server";
import { calculateRiskReward } from "@/lib/advisory/krTrendFilter";

export const runtime = "nodejs";

/** 손익비 결정론 계산 (LLM 없음). */
export async function POST(req: Request) {
  let body: {
    seedWon?: number;
    currentPrice?: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    bullishDays20?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }

  const result = calculateRiskReward({
    seedWon: Number(body.seedWon) || 0,
    currentPrice: Number(body.currentPrice) || 0,
    stopLossPrice: Number(body.stopLossPrice) || 0,
    takeProfitPrice: Number(body.takeProfitPrice) || 0,
    bullishDays20: Number(body.bullishDays20) || 0,
  });

  return NextResponse.json({
    ok: true,
    result,
    asOf: new Date().toISOString(),
    source: "deterministic:krTrendFilter.calculateRiskReward",
    currency: "KRW",
  });
}
