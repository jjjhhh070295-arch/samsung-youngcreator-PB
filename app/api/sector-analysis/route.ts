import { NextRequest, NextResponse } from "next/server";
import { analyzeHoldingsBySector, type HoldingInput } from "@/lib/holdingSectorAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let holdings: HoldingInput[];
  try {
    const body = await req.json();
    holdings = body.holdings;
    if (!Array.isArray(holdings) || holdings.length === 0) {
      return NextResponse.json({ error: "holdings 배열이 비어 있습니다." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "요청 파싱 실패" }, { status: 400 });
  }

  try {
    const result = await analyzeHoldingsBySector(holdings);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sector-analysis] 오류:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "섹터 분석 실패" },
      { status: 500 },
    );
  }
}
