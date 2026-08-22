import type { PortfolioDetailHolding, PortfolioOption } from "@/lib/portfolio";

export interface PbSelectedKoreanStock {
  ticker: string;
  name: string;
}

/**
 * 기존 자산군 비중은 유지하고, etf(주식) 버킷만 PB가 체크한 국내 주식으로 교체.
 * 체크 없으면 임의 종목 배분 금지 → "주식 확정 대기".
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
          name: "주식 확정 대기",
          weight,
          role: "국장 추세 필터에서 PB가 종목을 체크해야 주식형이 확정됩니다",
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
    role: "PB 선택 국내 주식 · 국장 추세 필터 통과",
    taxNote: "국내 상장주식 장내거래 · 대주주·양도세 요건 확인",
    source: "pb-kr-trend-filter",
    sourceType: "representative_product",
  }));

  return { holdings: [...equity, ...nonEquity], equityPending: false };
}

export function equityWeightFromOptionWeights(weights: PortfolioOption["weights"]): number {
  return weights.etf;
}
