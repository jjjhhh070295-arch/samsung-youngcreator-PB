/**
 * 채권 ETF 주가손익·보유기간 총손익 (실행 기록이 아닌 분석/미리보기용).
 * ETF 투자자는 기초채권 쿠폰이 아니라 ETF 분배금을 받는다.
 */

export type BondEtfHoldingPnL = {
  unrealizedPricePnL: number;
  holdingPeriodDistributions: number;
  holdingPeriodTotalPnLBeforeCosts: number;
  /** 실제 매도 없이는 실현손익이 아님 */
  isRealized: false;
};

/**
 * q * (current - avgCost) + holding-period distributions (already attributable).
 * Do not annualize without an explicit time basis.
 */
export function bondEtfUnrealizedHoldingPnL(opts: {
  shares: number;
  avgAcquisitionPrice: number;
  currentMarketPrice: number;
  /** 보유기간에 귀속된 주당 분배금 합(현지통화) */
  distributionsPerShareDuringHold: number;
}): BondEtfHoldingPnL {
  const q = opts.shares;
  const unrealizedPricePnL = q * (opts.currentMarketPrice - opts.avgAcquisitionPrice);
  const holdingPeriodDistributions = q * opts.distributionsPerShareDuringHold;
  return {
    unrealizedPricePnL,
    holdingPeriodDistributions,
    holdingPeriodTotalPnLBeforeCosts: unrealizedPricePnL + holdingPeriodDistributions,
    isRealized: false,
  };
}

export function bondEtfRealizedPricePnL(opts: {
  sharesSold: number;
  salePrice: number;
  acquisitionPriceAllocated: number;
}): { realizedPricePnL: number; isRealized: true } {
  return {
    realizedPricePnL:
      opts.sharesSold * (opts.salePrice - opts.acquisitionPriceAllocated),
    isRealized: true,
  };
}

/**
 * 가중 포트폴리오 기대수익. 결측 종목을 0%로 두거나 나머지를 100%로 재정규화하지 않는다.
 */
export function weightedPortfolioReturn(parts: Array<{ weight: number; returnRate: number | null }>): {
  status: "complete" | "partial" | "unavailable";
  portfolioReturn: number | null;
  coveredWeight: number;
  missingWeight: number;
} {
  let covered = 0;
  let missing = 0;
  let acc = 0;
  for (const p of parts) {
    if (!Number.isFinite(p.weight) || p.weight <= 0) continue;
    if (p.returnRate == null || !Number.isFinite(p.returnRate)) {
      missing += p.weight;
      continue;
    }
    covered += p.weight;
    acc += p.weight * p.returnRate;
  }
  if (covered <= 0) {
    return { status: "unavailable", portfolioReturn: null, coveredWeight: 0, missingWeight: missing };
  }
  return {
    status: missing > 0 ? "partial" : "complete",
    portfolioReturn: acc,
    coveredWeight: covered,
    missingWeight: missing,
  };
}
