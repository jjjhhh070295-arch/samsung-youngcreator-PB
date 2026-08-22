import { NextResponse } from "next/server";
import { fetchKoreanTopGainers, fetchNaverOhlcBars, mapPool, MIN_KR_MARKET_CAP_WON } from "@/lib/advisory/krGainers";
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
  return {
    passed: true,
    themeName: `${name} 사업개요 기반 참고`,
    evidence: text,
    source: "naver-finance:item-main:fnguide",
    asOf,
    status: "pass",
  };
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
    const { gainers, unverifiable, universeSize, floorWon } = await fetchKoreanTopGainers(limit);

    if (!screen) {
      return NextResponse.json({
        ok: true,
        asOf: new Date().toISOString(),
        source: "naver-finance:marketValue+changePct",
        currency: "KRW",
        marketCapFloorWon: floorWon,
        universeSize,
        count: gainers.length,
        candidates: gainers.map((g) => ({
          ...baseCandidateFields(g),
          technical: null,
          technicalError: null,
          theme: null,
          isFinalCandidate: false,
        })),
        unverifiable: unverifiable.map((g) => ({
          ...baseCandidateFields(g),
          technical: null,
          technicalError: "시총 검증 불가",
          theme: null,
          isFinalCandidate: false,
        })),
      });
    }

    const screened = await mapPool(gainers, 6, async (g) => {
      const base = baseCandidateFields(g);
      if (g.marketCapStatus !== "ok") {
        return {
          ...base,
          technical: null,
          technicalError: g.marketCapStatus === "unverifiable" ? "시총 검증 불가" : "시가총액 5,000억 미만",
          theme: null,
          isFinalCandidate: false,
        } satisfies KrTrendCandidate;
      }
      try {
        const { bars, asOf, source } = await fetchNaverOhlcBars(g.ticker);
        const technical = evaluateTechnicalFilters(bars);
        let theme: KrTrendCandidate["theme"] = null;
        if (technical.passed) {
          const profile = await fetchNaverProfile(g.ticker).catch(() => null);
          theme = heuristicTheme(profile?.longBusinessSummary ?? null, g.name);
        }
        const isFinalCandidate = Boolean(
          g.marketCapStatus === "ok" &&
            technical.passed &&
            theme?.passed,
        );
        return {
          ...base,
          asOf: asOf || g.asOf,
          source: `${g.source} · ${source}`,
          technical,
          technicalError: null,
          theme,
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

    return NextResponse.json({
      ok: true,
      asOf: new Date().toISOString(),
      source: "naver-finance:marketValue+chart",
      currency: "KRW",
      marketCapFloorWon: MIN_KR_MARKET_CAP_WON,
      universeSize,
      count: screened.length,
      finalCount: screened.filter((c) => c.isFinalCandidate).length,
      candidates: screened,
      unverifiable: unverifiable.map((g) => ({
        ...baseCandidateFields(g),
        technical: null,
        technicalError: "시총 검증 불가",
        theme: null,
        isFinalCandidate: false,
      })),
      note: "시총 5,000억 이상만 상위 70 후보. 가격·이동평균·양봉은 결정론. 테마는 출처 기반.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "국장 추세 필터 실패" },
      { status: 500 },
    );
  }
}
