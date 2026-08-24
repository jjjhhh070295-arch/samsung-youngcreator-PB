import { NextResponse } from "next/server";
import { calculateRiskReward } from "@/lib/advisory/krTrendFilter";

export const runtime = "nodejs";

/** 손익비 결정론 계산 (LLM 없음). 양봉비율 ≠ 상승확률. */
export async function POST(req: Request) {
  let body: {
    seedWon?: number;
    entryPrice?: number;
    currentPrice?: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    bullishDays20?: number;
    feeRate?: number;
    sellTaxRate?: number;
    slippageRate?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "JSON이 필요합니다." }, { status: 400 });
  }

  const result = calculateRiskReward({
    seedWon: Number(body.seedWon) || 0,
    entryPrice: Number(body.entryPrice ?? body.currentPrice) || 0,
    stopLossPrice: Number(body.stopLossPrice) || 0,
    takeProfitPrice: Number(body.takeProfitPrice) || 0,
    bullishDays20: Number(body.bullishDays20) || 0,
    feeRate: body.feeRate,
    sellTaxRate: body.sellTaxRate,
    slippageRate: body.slippageRate,
  });

  return NextResponse.json({
    ok: result.ok,
    result,
    asOf: new Date().toISOString(),
    source: "deterministic:krTrendFilter.calculateRiskReward",
    currency: "KRW",
  });
}
