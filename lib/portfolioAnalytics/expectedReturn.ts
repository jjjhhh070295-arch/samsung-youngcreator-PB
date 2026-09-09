import { cagr, daysBetween, finite } from "./calculations";
import { approximateBondEtfOneYearTotalReturn } from "./bondEtfScenario";
import type { ExpectedReturn, Holding, MarketData } from "./types";

export function expectedReturn(holding: Holding, data: MarketData, date: string): ExpectedReturn {
  const f = data.fundamentals ?? {};
  const make = (value: number | null, method: string, assumptions: string[], confidence: "low" | "medium" = "low", source = data.source): ExpectedReturn =>
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
    const config = holding.bondEtfScenario;
    const override = config?.override;
    const overrideIsUsable = Boolean(
      override &&
      finite(override.ytmPct) &&
      override.ytmPct >= -10 &&
      override.ytmPct <= 100 &&
      /^\d{4}-\d{2}-\d{2}$/.test(override.asOf) &&
      override.sourceLabel.trim(),
    );
    const ytm = overrideIsUsable ? override!.ytmPct! / 100 : f.yieldToMaturity;
    if (finite(ytm) && ytm >= -0.1 && ytm <= 1) {
      const expenseRatio = overrideIsUsable && finite(override?.expenseRatioPct)
        ? override.expenseRatioPct / 100
        : finite(f.expenseRatio) && f.expenseRatio >= 0 && f.expenseRatio <= 1
          ? f.expenseRatio
          : null;
      const effectiveDuration = overrideIsUsable && finite(override?.effectiveDurationYears)
        ? override.effectiveDurationYears
        : finite(f.duration)
          ? f.duration
          : null;
      const spreadDuration = overrideIsUsable && finite(override?.spreadDurationYears)
        ? override.spreadDurationYears
        : finite(f.spreadDuration)
          ? f.spreadDuration
          : null;
      const rateChangeBp = config?.rateChangeBp ?? 0;
      const spreadChangeBp = config?.spreadChangeBp ?? 0;
      const bond = approximateBondEtfOneYearTotalReturn({
        portfolioYtm: ytm,
        expenseNotAlreadyInYtm: expenseRatio,
        effectiveDuration,
        spreadDuration,
        rateChange: rateChangeBp / 10_000,
        spreadChange: spreadChangeBp / 10_000,
        allowMissingSpreadDuration: config?.allowMissingSpreadDuration ?? false,
      });
      const factsSourceLabel = overrideIsUsable
        ? override!.sourceLabel.trim()
        : f.factsSourceLabel ?? "펀드 공시 데이터";
      const factsSourceUrl = overrideIsUsable
        ? override!.sourceUrl?.trim() || null
        : f.factsSourceUrl ?? null;
      const factsAsOf = overrideIsUsable ? override!.asOf : f.factsAsOf ?? null;
      const bondScenario: NonNullable<ExpectedReturn["bondScenario"]> = {
        status: bond.status,
        ytm,
        expenseRatio,
        effectiveDuration,
        spreadDuration,
        rateChangeBp,
        spreadChangeBp,
        carryRoll: bond.carryRoll,
        expenseDrag: bond.expenseDrag,
        ratePriceEffect: bond.ratePriceEffect,
        spreadPriceEffect: bond.spreadPriceEffect,
        factsAsOf,
        factsSourceLabel,
        factsSourceUrl,
        sourceKind: overrideIsUsable ? "pb_override" : "official",
      };
      const source = overrideIsUsable
        ? [`PB 검증 입력:${factsSourceLabel}`, ...(factsSourceUrl ? [factsSourceUrl] : [])]
        : data.source;
      if (bond.totalReturn == null) {
        return {
          ...make(
            null,
            "bond_etf_scenario_unavailable",
            [...bond.assumptions, ...bond.missingReasons],
            "low",
            source,
          ),
          bondScenario,
        };
      }
      return {
        ...make(
          bond.totalReturn,
          "bond_etf_ytm_scenario",
          [
            "1년 근사: YTM − 보수 − 유효듀레이션×금리변화 − 스프레드듀레이션×스프레드변화",
            ...bond.assumptions,
            ...(factsAsOf ? [`공시 기준일 ${factsAsOf}`] : []),
          ],
          overrideIsUsable ? "low" : "medium",
          source,
        ),
        bondScenario,
      };
    }
    const yields = [["sec_yield", f.secYield], ["distribution_yield", f.distributionYield]] as const;
    for (const [method, value] of yields) {
      if (!finite(value) || value < 0 || value > 1) continue;
      // SEC/distribution yields are already fund-level income proxies; do not double deduct fees.
      return make(value, method, ["펀드 공시 수익률 proxy: 보수 중복 차감 없음", "YTM·듀레이션 미확보로 가격 민감도 시나리오는 적용하지 않음"], "low");
    }
  }
  const historical = cagr(data.prices);
  if (historical != null && data.prices.length >= 120 && daysBetween(data.prices[0].date, data.prices.at(-1)!.date) >= 365) {
    return make(historical, "historical_cagr_fallback", ["펀더멘털/수익률 데이터 부족: 과거 CAGR을 추정 대용치로 사용", "미래 성과를 보장하지 않음; ETF 보수는 가격에 반영되어 추가 차감하지 않음"]);
  }
  return make(null, "insufficient_evidence", ["펀더멘털·펀드 수익률 근거가 부족하고, 과거 CAGR 대용치에 필요한 최소 1년·120개 유효 가격 관측치도 확보하지 못했습니다. 임시 수익률을 적용하지 않습니다."]);
}
