import { NextRequest, NextResponse } from "next/server";
import {
  MOLIT_KEY_MISSING_NOTE,
  estimateMarketValue,
  readMolitServiceKey,
} from "@/lib/realestate/fetch-market-value";

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

  // 자리표시자("[SENSITIVE]" 등)도 미설정으로 본다 — 판정은 라이브러리와 공유한다.
  if (!readMolitServiceKey()) {
    return NextResponse.json({
      value: null, low: null, high: null, confidence: "low",
      source: "molit_realtxn", sampleSize: 0,
      note: MOLIT_KEY_MISSING_NOTE,
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
