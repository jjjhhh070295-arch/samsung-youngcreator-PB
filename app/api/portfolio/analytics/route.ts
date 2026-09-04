import { NextResponse } from "next/server";
import { validateRequest } from "@/lib/portfolioAnalytics/analytics";
import { portfolioAnalytics } from "@/lib/portfolioAnalytics/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  let body;
  try {
    const text = await request.text();
    if (text.length > 30000) throw new Error("분석 요청이 너무 큽니다.");
    body = JSON.parse(text);
    validateRequest(body?.holdings, body?.options);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "분석 입력을 확인하세요." }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, result: await portfolioAnalytics(body.holdings, body.options) });
  } catch {
    return NextResponse.json({ ok: false, error: "포트폴리오 분석에 실패했습니다. 잠시 후 다시 시도하세요." }, { status: 502 });
  }
}
