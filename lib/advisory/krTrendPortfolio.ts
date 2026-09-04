import type { PortfolioDetailHolding, PortfolioOption } from "@/lib/portfolio";

export interface PbSelectedKoreanStock {
  ticker: string;
  name: string;
  /** Optional enrichment for instrument selection / preview */
  price?: number | null;
  asOf?: string | null;
  source?: string;
  currency?: string;
  exchange?: string;
}

/**
 * 기존 자산군 비중은 유지하고, etf(주식) 버킷만 PB가 「후보 확정」한 국내 주식으로 교체.
 * 확정 없으면 임의 종목 배분 금지 → "PB 확정 대기".
 */
export function applyPbSelectedKoreanStocks(
  holdings: PortfolioDetailHolding[],
  selected: PbSelectedKoreanStock[],
  equityWeight: number,
): { holdings: PortfolioDetailHolding[]; equityPending: boolean } {
  const nonEquity = holdings.filter((h) => h.bucket !== "etf");
  const weight = Math.max(0, equityWeight);

  if (weight <= 0) {
    return { holdings: nonEquity, equityPending: false };
  }

  if (selected.length === 0) {
    return {
      holdings: [
        {
          bucket: "etf",
          name: "PB 확정 대기",
          weight,
          role: "국장 추세 필터에서 체크 후 「후보 확정」해야 주식형이 반영됩니다",
          taxNote: "미확정 — 고객 확정 포트폴리오 자동 반영 금지",
          source: "pb-kr-trend-filter",
          sourceType: "representative_product",
        },
        ...nonEquity,
      ],
      equityPending: true,
    };
  }

  const each = weight / selected.length;
  const equity: PortfolioDetailHolding[] = selected.map((s) => ({
    bucket: "etf",
    name: `${s.name}(${s.ticker})`,
    weight: each,
    role: "PB 확정 국내 주식 · 국장 추세 필터 통과",
    taxNote: "국내 상장주식 장내거래 · 대주주·양도세 요건 확인",
    source: "pb-kr-trend-filter",
    sourceType: "representative_product",
  }));

  return { holdings: [...equity, ...nonEquity], equityPending: false };
}

/** IPS/확정 포트폴리오용: 상품·종목명 단위 배분 */
export function holdingsToIpsAllocations(
  holdings: PortfolioDetailHolding[],
): Array<{ assetClass: string; weight: number }> {
  return holdings
    .filter((h) => h.weight > 0)
    .map((h) => {
      const sleeve =
        h.bucket === "etf"
          ? "주식형"
          : h.bucket === "bond"
            ? "채권형"
            : h.bucket === "mmf"
              ? "현금성"
              : h.bucket === "gold" || h.bucket === "dollar" || h.bucket === "raw"
                ? "대체자산"
                : h.bucket;
      return {
        assetClass: `${sleeve}: ${h.name}`,
        weight: Math.round(h.weight * 10) / 10,
      };
    });
}

export function equityWeightFromOptionWeights(weights: PortfolioOption["weights"]): number {
  return weights.etf;
}
