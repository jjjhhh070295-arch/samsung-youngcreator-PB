import { NextResponse } from "next/server";
import { fetchKoreanTopGainers, fetchNaverOhlcBars, mapPool } from "@/lib/advisory/krGainers";
import { evaluateTechnicalFilters } from "@/lib/advisory/krTrendFilter";
import { fetchNaverProfile } from "@/lib/advisory/naver";

export const runtime = "nodejs";
export const maxDuration = 60;

export interface KrTrendCandidate {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
  volume: number;
  tradingValueWon: number | null;
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
  } | null;
  isFinalCandidate: boolean;
}

function heuristicTheme(profileSummary: string | null, name: string): KrTrendCandidate["theme"] {
  const asOf = new Date().toISOString();
  if (!profileSummary || profileSummary.trim().length < 40) {
    return {
      passed: false,
      themeName: "테마 검증 부족",
      evidence: "회사개요/섹터 출처가 부족해 테마 추세를 확정하지 않습니다. 고객 확정 포트폴리오에 자동 반영하지 않습니다.",
      source: "none",
      asOf,
      status: "review",
    };
  }
  const text = profileSummary.slice(0, 400);
  // 휴리스틱: 개요가 있으면 review 통과가 아니라 PB 확인용 pass(설명만). 급등 단정 금지.
  return {
    passed: true,
    themeName: `${name} 사업개요 기반 참고`,
    evidence: text,
    source: "naver-finance:item-main:fnguide",
    asOf,
    status: "pass",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(70, Math.max(10, Number(url.searchParams.get("limit") || 70)));
  const screen = url.searchParams.get("screen") !== "0";

  try {
    const gainers = await fetchKoreanTopGainers(limit);
    if (!screen) {
      return NextResponse.json({
        ok: true,
        asOf: new Date().toISOString(),
        source: "naver-finance:sise_rise",
        currency: "KRW",
        count: gainers.length,
        candidates: gainers.map((g) => ({
          ...g,
          technical: null,
          technicalError: null,
          theme: null,
          isFinalCandidate: false,
        })),
      });
    }

    const screened = await mapPool(gainers, 6, async (g) => {
      try {
        const { bars, asOf, source } = await fetchNaverOhlcBars(g.ticker);
        const technical = evaluateTechnicalFilters(bars);
        let theme: KrTrendCandidate["theme"] = null;
        if (technical.passed) {
          const profile = await fetchNaverProfile(g.ticker).catch(() => null);
          theme = heuristicTheme(profile?.longBusinessSummary ?? null, g.name);
        }
        const isFinalCandidate = Boolean(technical.passed && theme?.passed);
        return {
          ticker: g.ticker,
          name: g.name,
          price: g.price,
          changePct: g.changePct,
          volume: g.volume,
          tradingValueWon: g.tradingValueWon,
          market: g.market,
          rank: g.rank,
          asOf: asOf || g.asOf,
          source: `${g.source} · ${source}`,
          currency: "KRW" as const,
          technical,
          technicalError: null,
          theme,
          isFinalCandidate,
        } satisfies KrTrendCandidate;
      } catch (e: unknown) {
        return {
          ticker: g.ticker,
          name: g.name,
          price: g.price,
          changePct: g.changePct,
          volume: g.volume,
          tradingValueWon: g.tradingValueWon,
          market: g.market,
          rank: g.rank,
          asOf: g.asOf,
          source: g.source,
          currency: "KRW" as const,
          technical: null,
          technicalError: e instanceof Error ? e.message : "기술 필터 실패",
          theme: null,
          isFinalCandidate: false,
        } satisfies KrTrendCandidate;
      }
    });

    return NextResponse.json({
      ok: true,
      asOf: new Date().toISOString(),
      source: "naver-finance:sise_rise+chart",
      currency: "KRW",
      count: screened.length,
      finalCount: screened.filter((c) => c.isFinalCandidate).length,
      candidates: screened,
      note: "가격·이동평균·양봉은 결정론 엔진. 테마는 개요 출처 기반이며 출처 부족 시 review.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "국장 추세 필터 실패" },
      { status: 500 },
    );
  }
}
