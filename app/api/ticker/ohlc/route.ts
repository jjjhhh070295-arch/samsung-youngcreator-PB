import { NextResponse } from "next/server";
import {
  dailyToLiveQuote,
  fetchFinancialSnapshot,
  fetchTickerOhlcDaily,
  fetchTickerProfile,
  resolveTickerInput,
} from "@/lib/advisory/tickerOhlcData";
import { fetchKisInvestorFlow, isKisConfigured } from "@/lib/pricing/kis-chart";
import { enrichBars, streakMarkers, volumeProfile } from "@/lib/advisory/tickerIndicatorsExtended";
import { buildTickerSnapshotFromOhlc } from "@/lib/advisory/tickerSnapshotOhlc";
import { judgeTicker, sha256Hex, stableStringify } from "@/lib/advisory/control";
import type { InvestorFlowSeries } from "@/lib/advisory/ohlcTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("symbol") || url.searchParams.get("q") || "";
  if (!q.trim()) {
    return NextResponse.json(
      { ok: false, status: "blocked", error: "symbol 파라미터가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const resolved = await resolveTickerInput(q);
    const [ohlc, profile, financial] = await Promise.all([
      fetchTickerOhlcDaily(resolved),
      fetchTickerProfile(resolved),
      fetchFinancialSnapshot(resolved.symbol),
    ]);

    let investorFlow: InvestorFlowSeries = {
      asOf: new Date().toISOString(),
      source: "none",
      connected: false,
      bars: [],
      note: "국내 종목이 아니거나 수급 API 미연결",
    };
    if (resolved.domesticCode && isKisConfigured()) {
      investorFlow = await fetchKisInvestorFlow(resolved.domesticCode);
    }

    const enriched = enrichBars(ohlc.bars.slice(-260));
    const snapshot = buildTickerSnapshotFromOhlc(ohlc, q.trim(), enriched);
    if (profile.warning) snapshot.warnings = [...snapshot.warnings, profile.warning];

    const judge = judgeTicker(snapshot);
    const status = judge.passed ? (snapshot.warnings.length ? "warning" : "ok") : "blocked";
    const inputHash = await sha256Hex(stableStringify({ q, resolved: resolved.symbol }));
    const outputHash = await sha256Hex(
      stableStringify({
        symbol: snapshot.resolvedSymbol,
        asOf: snapshot.asOf,
        last: snapshot.lastPrice.value,
      }),
    );

    return NextResponse.json({
      ok: status !== "blocked",
      status,
      snapshot,
      ohlc: {
        ...ohlc,
        bars: enriched,
        volumeProfile: volumeProfile(enriched),
        streakMarkers: streakMarkers(enriched),
      },
      quote: dailyToLiveQuote(ohlc),
      profile,
      financial,
      investorFlow,
      kisConfigured: isKisConfigured(),
      judge,
      evidence: {
        inputHash,
        outputHash,
        engine: "deterministic-indicators+ohlc+kis-yahoo-naver",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        status: "blocked",
        error: e?.message ?? "시세 분석에 실패했습니다.",
        snapshot: null,
      },
      { status: 502 },
    );
  }
}
