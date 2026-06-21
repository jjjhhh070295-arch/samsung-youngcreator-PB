import { NextRequest, NextResponse } from "next/server";
import { lookupTicker } from "@/lib/pricing/ticker-map";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { names }: { names: string[] } = await req.json();
  if (!Array.isArray(names)) {
    return NextResponse.json({ error: "names 배열 필요" }, { status: 400 });
  }

  const result: Record<string, string | null> = {};
  for (const name of names) {
    result[name] = lookupTicker(name);
  }
  return NextResponse.json({ tickers: result });
}
