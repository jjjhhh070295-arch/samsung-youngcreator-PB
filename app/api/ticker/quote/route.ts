import { NextResponse } from "next/server";
import { fetchTickerQuote, resolveTickerInput } from "@/lib/advisory/tickerData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = url.searchParams.get("symbol") || url.searchParams.get("q") || "";
  if (!query.trim()) {
    return NextResponse.json({ ok: false, error: "symbol 파라미터가 필요합니다." }, { status: 400 });
  }
  try {
    const resolved = await resolveTickerInput(query);
    const quote = await fetchTickerQuote(resolved);
    return NextResponse.json({ ok: true, quote });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error?.message ?? "현재가 갱신에 실패했습니다.",
    }, { status: 502 });
  }
}
