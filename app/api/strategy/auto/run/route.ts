import { NextResponse } from "next/server";
import { AuthError, requireTraderAuth } from "@/lib/trading/guards";
import { runAutoTradeCycle } from "@/lib/strategy/autoTrader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST — 자동매매 1사이클. { force?: true, ignoreSession?: true } */
export async function POST(req: Request) {
  try {
    await requireTraderAuth(req);
    let body: { force?: boolean; ignoreSession?: boolean } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      body = {};
    }
    const result = await runAutoTradeCycle({
      force: body.force !== false,
      ignoreSession: body.ignoreSession === true,
    });
    return NextResponse.json({ ok: result.ok, result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "run failed" },
      { status: 500 },
    );
  }
}
