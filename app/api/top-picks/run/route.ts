import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { runDailyTopPicks } from "@/lib/topPicks/dailyJob";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await runDailyTopPicks(new URL(request.url).origin)) }); }
  catch (error: any) { console.error("[/api/top-picks/run]", error); return NextResponse.json({ ok: false, error: error?.message ?? "일일 Top Pick 실행 실패" }, { status: 500 }); }
}
