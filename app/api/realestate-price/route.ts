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

  if (!legalDongCode || !complexName || !areaM2) {
    return NextResponse.json(
      { error: "legalDongCode, complexName, areaM2 필수" },
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
    areaM2:        Number(areaM2),
    monthsBack:    monthsBack != null ? Number(monthsBack) : 24, // 시점보정 범위 24개월
  });

  return NextResponse.json(result);
}
