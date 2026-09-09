import { NextResponse } from "next/server";
import { getTopPickDetail } from "@/lib/topPicks/repository";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: { ticker: string } }) {
  const ticker = decodeURIComponent(context.params.ticker).trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,15}$/.test(ticker)) return NextResponse.json({ error: "유효하지 않은 ticker입니다." }, { status: 400 });
  try {
    const detail = await getTopPickDetail(ticker);
    return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Top Pick 데이터가 없습니다." }, { status: 404 });
  } catch (error: any) { return NextResponse.json({ error: error?.message ?? "상세 데이터를 불러오지 못했습니다." }, { status: 500 }); }
}
