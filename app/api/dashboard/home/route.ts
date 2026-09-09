import { NextResponse } from "next/server";
import { getDashboardHome } from "@/lib/topPicks/repository";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await getDashboardHome(), { headers: { "Cache-Control": "private, max-age=60" } }); }
  catch (error: any) { return NextResponse.json({ ready: false, date: null, marketBrief: null, topPicks: [], error: error?.message ?? "홈 데이터를 불러오지 못했습니다." }, { status: 500 }); }
}
