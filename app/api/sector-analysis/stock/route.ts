import { NextRequest, NextResponse } from "next/server";
import { getSectorAnalysis } from "@/lib/sectorMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sector-analysis/stock?q=SK하이닉스
 * GET /api/sector-analysis/stock?q=000660
 * 단일 종목 섹터 분석 (베타·변동성·R²·복수섹터·미커버 플래그 포함)
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q 파라미터가 필요합니다." }, { status: 400 });
  }

  try {
    const result = await getSectorAnalysis(q);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sector-analysis/stock] 오류:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "섹터 분석 실패" },
      { status: 500 },
    );
  }
}
