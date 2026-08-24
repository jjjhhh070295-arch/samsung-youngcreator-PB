import { NextResponse } from "next/server";
import { fetchKospiCompletedBars } from "@/lib/market/kospiBars";
import { detectMarketRegime, policyForRegime } from "@/lib/strategy/marketRegime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/regime — 런타임 KOSPI 국면 판정 */
export async function GET() {
  const { bars, source, error } = await fetchKospiCompletedBars();
  const detected = detectMarketRegime(bars);
  const policy = policyForRegime(detected.regime);
  return NextResponse.json({
    ok: !error || bars.length > 0,
    source,
    error: error ?? null,
    barCount: bars.length,
    detected,
    policy,
  });
}
