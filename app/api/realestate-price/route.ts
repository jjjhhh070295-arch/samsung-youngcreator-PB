import { NextRequest, NextResponse } from "next/server";
import { estimateMarketValue } from "@/lib/realestate/fetch-market-value";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    legalDongCode?: unknown;
    complexName?:   unknown;
    areaM2?:        unknown;
    monthsBack?:    unknown;
  };

  const { legalDongCode, complexName, areaM2, monthsBack } = body;

  // areaM2는 선택 — 없으면 "부동산 추가" 2단계(평형 선택 전) 조회로, 평형별 전체 목록만 낸다.
  if (!legalDongCode || !complexName) {
    return NextResponse.json(
      { error: "legalDongCode, complexName 필수" },
      { status: 400 },
    );
  }

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!serviceKey || serviceKey === "발급받은인증키여기에") {
    return NextResponse.json({
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: "DATA_GO_KR_SERVICE_KEY 미설정",
      connected: false,
      freshness: "참고용",
      areaBreakdown: [],
    });
  }

  const result = await estimateMarketValue({
    legalDongCode: String(legalDongCode),
    complexName:   String(complexName),
    areaM2:        areaM2 != null ? Number(areaM2) : undefined,
    monthsBack:    monthsBack != null ? Number(monthsBack) : 24, // 시점보정 범위 24개월
  });

  return NextResponse.json(result);
}
