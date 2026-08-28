import { NextResponse } from "next/server";
import {
  fetchKoreanTopGainers,
  fetchKisOhlcBars,
  mapPool,
  MIN_KR_MARKET_CAP_WON,
} from "@/lib/advisory/krGainers";
import { evaluateTechnicalFilters } from "@/lib/advisory/krTrendFilter";
import { selectTopKrStocksByMarketCap } from "@/lib/advisory/selectTopKrStocks";
import { MAX_SELECTED_KR_STOCKS } from "@/lib/advisory/krConstants";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface KrTrendCandidate {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradingValueWon: number | null;
  marketCapWon: number | null;
  marketCapLabel: string;
  marketCapAsOf: string;
  marketCapSource: string;
  marketCapStatus: "ok" | "below_floor" | "unverifiable";
  market: "KOSPI" | "KOSDAQ";
  rank: number;
  asOf: string;
  source: string;
  currency: "KRW";
  technical: ReturnType<typeof evaluateTechnicalFilters> | null;
  technicalError: string | null;
  theme: {
    passed: boolean;
    themeName: string;
    evidence: string;
    source: string;
    asOf: string;
    status: "pass" | "review" | "blocked";
    reportCount?: number;
    summaryLabel?: string;
    sources?: Array<{ title: string; publisher: string; publishedAt: string; url: string }>;
  } | null;
  isFinalCandidate: boolean;
  finalRank?: number | null;
  selectedForRecommend?: boolean;
  excludeReason?: string | null;
}

function baseCandidateFields(g: Awaited<ReturnType<typeof fetchKoreanTopGainers>>["gainers"][number]) {
  return {
    ticker: g.ticker,
    name: g.name,
    price: g.price,
    changePct: g.changePct,
    volume: g.volume,
    tradingValueWon: g.tradingValueWon,
    marketCapWon: g.marketCapWon,
    marketCapLabel: g.marketCapLabel,
    marketCapAsOf: g.marketCapAsOf,
    marketCapSource: g.marketCapSource,
    marketCapStatus: g.marketCapStatus,
    market: g.market,
    rank: g.rank,
    asOf: g.asOf,
    source: g.source,
    currency: "KRW" as const,
  };
}


export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(70, Math.max(10, Number(url.searchParams.get("limit") || 70)));
  const screen = url.searchParams.get("screen") !== "0";

  try {
    const result = await fetchKoreanTopGainers(limit);

    if (result.status === "config_required" || result.status === "error") {
      return NextResponse.json({
        ok: result.status !== "error",
        status: result.status,
        message: result.message,
        asOf: result.asOf,
        source: result.source,
        currency: "KRW",
        marketCapFloorWon: result.floorWon,
        maxSelected: MAX_SELECTED_KR_STOCKS,
        universeSize: result.universeSize,
        count: 0,
        finalCount: 0,
        candidates: [],
        unverifiable: [],
        recommendable: [],
        excludedByCap: [],
      });
    }

    const { gainers, unverifiable, universeSize, floorWon, asOf, source } = result;

    if (!screen) {
      return NextResponse.json({
        ok: true,
        status: "ok",
        asOf,
        source,
        message: result.message,
        currency: "KRW",
        marketCapFloorWon: floorWon,
        maxSelected: MAX_SELECTED_KR_STOCKS,
        universeSize,
        count: gainers.length,
        candidates: gainers.map((g) => ({
          ...baseCandidateFields(g),
          technical: null,
          technicalError: null,
          theme: null,
          isFinalCandidate: false,
        })),
        unverifiable,
      });
    }

    const screened = await mapPool(gainers, 3, async (g) => {
      const base = baseCandidateFields(g);
      if (g.marketCapStatus !== "ok") {
        return {
          ...base,
          technical: null,
          technicalError:
            g.marketCapStatus === "unverifiable" ? "시총 검증 불가" : "시가총액 1조 원 미만",
          theme: null,
          isFinalCandidate: false,
        } satisfies KrTrendCandidate;
      }
      try {
        const { bars, asOf: barAsOf, source: barSource } = await fetchKisOhlcBars(g.ticker);
        const technical = evaluateTechnicalFilters(bars);
        // 테마/리포트 필터 제거 — 시총 + 기술조건만
        const isFinalCandidate = Boolean(g.marketCapStatus === "ok" && technical.passed);
        return {
          ...base,
          asOf: barAsOf || g.asOf,
          source: `${g.source} · ${barSource}`,
          technical,
          technicalError: null,
          theme: null,
          isFinalCandidate,
        } satisfies KrTrendCandidate;
      } catch (e: unknown) {
        return {
          ...base,
          technical: null,
          technicalError: e instanceof Error ? e.message : "기술 필터 실패",
          theme: null,
          isFinalCandidate: false,
        } satisfies KrTrendCandidate;
      }
    });

    const finals = screened.filter((c) => c.isFinalCandidate);
    const { selected, excluded } = selectTopKrStocksByMarketCap(finals, MAX_SELECTED_KR_STOCKS);
    const selectedTickers = new Set(selected.map((s) => s.ticker));
    const excludedTickers = new Map(excluded.map((e) => [e.ticker, e]));

    const annotated = screened.map((c) => {
      if (!c.isFinalCandidate) {
        return { ...c, finalRank: null, selectedForRecommend: false, excludeReason: null };
      }
      if (selectedTickers.has(c.ticker)) {
        const s = selected.find((x) => x.ticker === c.ticker)!;
        return {
          ...c,
          finalRank: s.finalRank,
          selectedForRecommend: true,
          excludeReason: null,
        };
      }
      const ex = excludedTickers.get(c.ticker);
      return {
        ...c,
        finalRank: ex?.finalRank ?? null,
        selectedForRecommend: false,
        excludeReason: ex?.excludeReason ?? `최대 ${MAX_SELECTED_KR_STOCKS}종목 제한으로 제외`,
      };
    });

    return NextResponse.json({
      ok: true,
      status: "ok",
      asOf: asOf || new Date().toISOString(),
      source,
      message: result.message,
      currency: "KRW",
      marketCapFloorWon: MIN_KR_MARKET_CAP_WON,
      maxSelected: MAX_SELECTED_KR_STOCKS,
      universeSize,
      count: annotated.length,
      finalCount: finals.length,
      recommendableCount: selected.length,
      candidates: annotated,
      recommendable: selected,
      excludedByCap: excluded,
      unverifiable: unverifiable.map((g) => ({
        ...baseCandidateFields(g),
        technical: null,
        technicalError: "시총 검증 불가",
        theme: null,
        isFinalCandidate: false,
      })),
      note: "등락률 상위 70 후 시총·기술조건. 테마/리포트 필터 없음. 최종 추천은 시총 상위 3종목.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "국장 추세 필터 실패" },
      { status: 500 },
    );
  }
}
