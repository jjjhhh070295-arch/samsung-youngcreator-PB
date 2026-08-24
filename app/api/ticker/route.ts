import { NextResponse } from "next/server";
import { buildTickerSnapshot } from "@/lib/advisory/tickerSnapshot";
import { dailyToLiveQuote, fetchTickerDaily, fetchTickerProfile, resolveTickerInput } from "@/lib/advisory/tickerData";
import { judgeTicker, sha256Hex, stableStringify } from "@/lib/advisory/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("symbol") || url.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      error: "symbol 파라미터가 필요합니다.",
      snapshot: null,
      profile: null,
    }, { status: 400 });
  }
  try {
    const resolved = await resolveTickerInput(q);
    const [daily, profile] = await Promise.all([
      fetchTickerDaily(resolved),
      fetchTickerProfile(resolved),
    ]);
    const snapshot = buildTickerSnapshot(daily, q.trim());
    if (profile.warning) snapshot.warnings = [...snapshot.warnings, profile.warning];
    const judge = judgeTicker(snapshot);
    const status = judge.passed ? (snapshot.warnings.length ? "warning" : "ok") : "blocked";
    const inputHash = await sha256Hex(stableStringify({ q, resolved: resolved.symbol }));
    const outputHash = await sha256Hex(stableStringify({
      symbol: snapshot.resolvedSymbol,
      asOf: snapshot.asOf,
      last: snapshot.lastPrice.value,
      rsi: snapshot.rsi14?.value ?? null,
    }));
    return NextResponse.json({
      ok: status !== "blocked",
      status,
      snapshot,
      quote: dailyToLiveQuote(daily),
      profile,
      judge,
      evidence: {
        inputHash,
        outputHash,
        engine: "deterministic-indicators+market-data-providers",
      },
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status: "blocked",
      error: e?.message ?? "시세 분석에 실패했습니다.",
      snapshot: null,
      profile: null,
      judge: {
        at: new Date().toISOString(),
        passed: false,
        findings: [{ code: "FETCH", severity: "fail", message: e?.message ?? "시세 조회 실패" }],
      },
    }, { status: 502 });
  }
}
