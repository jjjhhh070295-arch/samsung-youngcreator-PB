import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { isKnownPbRequest } from "@/lib/pbRequestAuth";
import { runDailyTopPicks } from "@/lib/topPicks/dailyJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  try { return NextResponse.json({ ok: true, ...(await runDailyTopPicks(new URL(request.url).origin)) }); }
  catch (error: any) { console.error("[/api/top-picks/run]", error); return NextResponse.json({ ok: false, error: error?.message ?? "일일 Top Pick 실행 실패" }, { status: 500 }); }
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return run(request);
}

// 예약 시각 전 최초 분석이나 실패 재시도는 로그인한 PB가 화면에서 실행할 수 있다.
// 브라우저에 크론 시크릿을 노출하지 않고 기존 PB 요청 검증을 재사용한다.
export async function POST(request: Request) {
  if (!isAuthorizedCronRequest(request) && !(await isKnownPbRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return run(request);
}
