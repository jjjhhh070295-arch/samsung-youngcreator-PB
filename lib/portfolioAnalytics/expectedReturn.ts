import { cagr, daysBetween, finite } from "./calculations";
import type { ExpectedReturn, Holding, MarketData } from "./types";

// Explicit V1 assumptions, not live forecasts. Cash means uninvested deposits.
const CLASS_ASSUMPTIONS = { equity: 0.06, dividend: 0.06, bond: 0.0325, commodity: 0.03, cash: 0 };
export function expectedReturn(holding: Holding, data: MarketData, date: string): ExpectedReturn {
  const f = data.fundamentals ?? {};
  const make = (value: number, method: string, assumptions: string[], confidence: "low" | "medium" = "low", source = data.source): ExpectedReturn =>
    ({ value, method, assumptions, confidence, source, calculationDate: date });
  if (holding.assetType === "cash") return make(0, "cash_assumption", ["대기자금 이자율 0% 가정"], "low", ["V1:cash-assumption"]);
  if (holding.assetType === "stock") {
    const price = f.currentPrice, eps = f.forwardEPS;
    const pe = f.targetPE ?? f.currentForwardPE;
    if (finite(price) && price > 0 && finite(eps) && eps > 0 && finite(pe) && pe > 0) {
      const growth = finite(f.expectedEPSGrowth) && f.expectedEPSGrowth > -1 ? f.expectedEPSGrowth : 0;
      const dividend = finite(f.dividendYield) && f.dividendYield >= 0 ? f.dividendYield : 0;
      const value = Math.pow(eps * (1 + growth) ** 3 * pe / price, 1 / 3) - 1 + dividend;
      const complete = finite(f.expectedEPSGrowth) && f.expectedEPSGrowth > -1 && finite(f.targetPE) && finite(f.dividendYield);
      if (finite(value)) return make(value, complete ? "fundamental" : "simplified_fundamental", [
        "3년 EPS × 목표 PER의 가격 CAGR + 배당수익률",
        ...(!finite(f.expectedEPSGrowth) || f.expectedEPSGrowth <= -1 ? ["장기 성장 추정치 부재: EPS 성장률 0%"] : []),
        ...(!finite(f.targetPE) ? ["목표 PER 부재: 현재 forward PER 유지"] : []),
        ...(!finite(f.dividendYield) ? ["배당 데이터 부재: 배당 0%"] : []),
      ], complete ? "medium" : "low");
    }
    if (finite(f.expectedEPSGrowth) && f.expectedEPSGrowth > -1 && finite(f.dividendYield) && f.dividendYield >= 0) {
      const value = f.expectedEPSGrowth + f.dividendYield;
      if (finite(value)) return make(value, "simplified_fundamental", ["EPS 성장률 + 배당수익률, 밸류에이션 변화 0 가정"]);
    }
  }
  if (holding.assetType === "etf" && (holding.subType === "bond" || holding.subType === "cash")) {
    const yields = [["ytm", f.yieldToMaturity], ["sec_yield", f.secYield], ["distribution_yield", f.distributionYield]] as const;
    for (const [method, value] of yields) {
      if (!finite(value) || value < 0 || value > 1) continue;
      const fee = finite(f.expenseRatio) && f.expenseRatio >= 0 && f.expenseRatio <= 1 ? f.expenseRatio : null;
      // SEC/distribution yields are already fund-level income proxies; do not double deduct fees.
      return make(value - (method === "ytm" ? fee ?? 0 : 0), method, [
        method === "ytm" ? "YTM − 보수" : "펀드 공시 수익률 proxy: 보수 중복 차감 없음",
        ...(method === "ytm" && fee == null ? ["보수 데이터 미확보: 미차감"] : []),
      ], "low");
    }
  }
  const historical = cagr(data.prices);
  if (historical != null && data.prices.length >= 120 && daysBetween(data.prices[0].date, data.prices.at(-1)!.date) >= 365) {
    return make(historical, "historical_cagr_fallback", ["펀더멘털/수익률 데이터 부족: 과거 CAGR을 추정 대용치로 사용", "미래 성과를 보장하지 않음; ETF 보수는 가격에 반영되어 추가 차감하지 않음"]);
  }
  return make(CLASS_ASSUMPTIONS[holding.subType], "asset_class_fallback", ["관측 데이터 부족: V1 자산군 가정값, 시장 전망 아님"], "low", ["V1:asset-class-assumptions"]);
}
