/**
 * 회사채·국채 ETF 1년 총수익 시나리오 근사.
 * YTM·SEC yield·분배수익률·과거 CAGR을 서로 바꿔 쓰지 않는다.
 * 결과는 명시적 가정 하의 근사치이며 확정 수익·원금 보장이 아니다.
 */

export type BondEtfScenarioStatus = "ok" | "unavailable" | "partial";

export type BondEtfScenarioInput = {
  /** 포트폴리오 YTM (소수, 예: 0.05 = 5%). 총수익에 분배수익률을 다시 더하지 않음 */
  portfolioYtm: number | null;
  /** 아직 YTM에 반영되지 않은 펀드 보수 (소수). YTM이 이미 net이면 null/0 */
  expenseNotAlreadyInYtm: number | null;
  /** effective duration (년). 단위 확인 필요 */
  effectiveDuration: number | null;
  /** spread duration (년). 없으면 스프레드 충격을 적용하지 않음 */
  spreadDuration: number | null;
  /** 금리 변화 (소수, +1%p = 0.01). 베이스는 0(시장금리 유지) */
  rateChange: number;
  /** 신용스프레드 변화 (소수, +100bp = 0.01) */
  spreadChange: number;
  /** 스프레드 duration 부재 시 PB가 명시적으로 0 충격을 허용했는지 */
  allowMissingSpreadDuration: boolean;
};

export type BondEtfScenarioResult = {
  status: BondEtfScenarioStatus;
  totalReturn: number | null;
  carryRoll: number | null;
  expenseDrag: number | null;
  ratePriceEffect: number | null;
  spreadPriceEffect: number | null;
  assumptions: string[];
  missingReasons: string[];
};

/**
 * One-year total-return ≈ carry/roll − expenses_not_in_ytm
 *   − duration * Δrate − spreadDuration * Δspread
 * (convexity·옵션·선물 레버리지 미적용)
 */
export function approximateBondEtfOneYearTotalReturn(
  input: BondEtfScenarioInput,
): BondEtfScenarioResult {
  const assumptions: string[] = [
    "시장금리·신용스프레드 변화는 입력값 기준(기본 0 = 유지 가정)",
    "YTM 기반 캐리/롤 근사 — 확정 수익률·원금 보장 아님",
    "분배수익률을 YTM 총수익에 다시 가산하지 않음",
  ];
  const missingReasons: string[] = [];

  if (input.portfolioYtm == null || !Number.isFinite(input.portfolioYtm)) {
    return {
      status: "unavailable",
      totalReturn: null,
      carryRoll: null,
      expenseDrag: null,
      ratePriceEffect: null,
      spreadPriceEffect: null,
      assumptions,
      missingReasons: ["포트폴리오 YTM(또는 동등 캐리 근거) 미확보"],
    };
  }

  const carryRoll = input.portfolioYtm;
  const expenseDrag =
    input.expenseNotAlreadyInYtm != null && Number.isFinite(input.expenseNotAlreadyInYtm)
      ? Math.max(0, input.expenseNotAlreadyInYtm)
      : 0;
  if (input.expenseNotAlreadyInYtm == null) {
    assumptions.push("보수 별도 차감 근거 없음: 추가 차감 0 (이미 net일 수 있음)");
  }

  let ratePriceEffect = 0;
  if (input.rateChange !== 0) {
    if (input.effectiveDuration == null || !Number.isFinite(input.effectiveDuration)) {
      missingReasons.push("금리 충격 적용에 필요한 effective duration 미확보");
      return {
        status: "unavailable",
        totalReturn: null,
        carryRoll,
        expenseDrag,
        ratePriceEffect: null,
        spreadPriceEffect: null,
        assumptions,
        missingReasons,
      };
    }
    ratePriceEffect = -input.effectiveDuration * input.rateChange;
  }

  let spreadPriceEffect = 0;
  if (input.spreadChange !== 0) {
    if (input.spreadDuration == null || !Number.isFinite(input.spreadDuration)) {
      if (!input.allowMissingSpreadDuration) {
        missingReasons.push("스프레드 충격에 필요한 spread duration 미확보 — PB 가정이 필요함");
        return {
          status: "unavailable",
          totalReturn: null,
          carryRoll,
          expenseDrag,
          ratePriceEffect,
          spreadPriceEffect: null,
          assumptions,
          missingReasons,
        };
      }
      assumptions.push("spread duration 부재: 스프레드 충격을 0으로 둔 PB 가정");
      spreadPriceEffect = 0;
    } else {
      spreadPriceEffect = -input.spreadDuration * input.spreadChange;
    }
  }

  const totalReturn = carryRoll - expenseDrag + ratePriceEffect + spreadPriceEffect;
  return {
    status: missingReasons.length ? "partial" : "ok",
    totalReturn,
    carryRoll,
    expenseDrag,
    ratePriceEffect,
    spreadPriceEffect,
    assumptions,
    missingReasons,
  };
}

/**
 * 무재투자·현금분배 가정에서 총수익을 가격수익·분배로 분해.
 * 분배 근거가 없으면 총수익만 유지하고 분배/예상가를 미확정으로 둔다.
 */
export function decomposeBondEtfTotalReturn(opts: {
  totalReturn: number;
  cashDistributionRate: number | null;
}): {
  status: BondEtfScenarioStatus;
  priceReturn: number | null;
  distributionRate: number | null;
  missingReasons: string[];
} {
  if (opts.cashDistributionRate == null || !Number.isFinite(opts.cashDistributionRate)) {
    return {
      status: "partial",
      priceReturn: null,
      distributionRate: null,
      missingReasons: ["분배금 추정 근거 미확보 — 총수익만 유지, 가격·분배 분해 보류"],
    };
  }
  return {
    status: "ok",
    priceReturn: opts.totalReturn - opts.cashDistributionRate,
    distributionRate: opts.cashDistributionRate,
    missingReasons: [],
  };
}

export function projectedBondEtfTerminalPrice(opts: {
  currentPrice: number;
  shares: number;
  totalReturn: number;
  cashDistributionPerShare: number | null;
}): {
  projectedTotalProfit: number;
  projectedPricePnL: number | null;
  projectedTerminalPrice: number | null;
  missingReasons: string[];
} {
  const capital = opts.currentPrice * opts.shares;
  const projectedTotalProfit = capital * opts.totalReturn;
  if (opts.cashDistributionPerShare == null || !Number.isFinite(opts.cashDistributionPerShare)) {
    return {
      projectedTotalProfit,
      projectedPricePnL: null,
      projectedTerminalPrice: null,
      missingReasons: ["분배금 추정 불가 — 예상 종가 분해 보류"],
    };
  }
  const distCash = opts.cashDistributionPerShare * opts.shares;
  const projectedPricePnL = projectedTotalProfit - distCash;
  const projectedTerminalPrice =
    opts.shares > 0 ? opts.currentPrice + projectedPricePnL / opts.shares : null;
  return {
    projectedTotalProfit,
    projectedPricePnL,
    projectedTerminalPrice,
    missingReasons: [],
  };
}
