import type { CashFlow, Client } from "./types";

export type TaxPainId =
  | "financial-income"
  | "inheritance-gift"
  | "real-estate-tax"
  | "stock-capital-gain"
  | "tax-exempt-products";

export type TaxPainSeverity = "상" | "중" | "하";

export interface TaxPainScore {
  id: TaxPainId;
  label: string;
  severity: TaxPainSeverity;
  basis: string[];
  needsHeritageConsulting?: boolean;
}

export const TAX_PAIN_THRESHOLDS = {
  financialIncome: {
    highWon: 20_000_000,
    mediumWon: 15_000_000,
  },
  inheritanceGift: {
    highWon: 3_000_000_000,
    mediumWon: 1_000_000_000,
    keywordHighAssetWon: 10_000_000_000,
    businessSuccessionMediumAssetWon: 5_000_000_000,
  },
  realEstateTax: {
    highWon: 500_000_000,
    mediumWon: 100_000_000,
  },
  stockCapitalGain: {
    highWon: 300_000_000,
  },
  taxExemptProducts: {
    highTaxFactorScore: 4,
    mediumTaxFactorScore: 3,
  },
} as const;

const formatWonShort = (won: number) => {
  const abs = Math.abs(won);
  const sign = won < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${Math.round((abs / 100_000_000) * 10) / 10}억원`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

const textOf = (flow: CashFlow) =>
  `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""} ${flow.accountType ?? ""}`.trim();

function sumMatching(cashFlows: CashFlow[], pattern: RegExp, direction: "positive" | "negativeAbs" | "absolute") {
  return cashFlows
    .filter((flow) => pattern.test(textOf(flow)))
    .reduce((sum, flow) => {
      if (direction === "positive") return flow.amount > 0 ? sum + flow.amount : sum;
      if (direction === "negativeAbs") return flow.amount < 0 ? sum + Math.abs(flow.amount) : sum;
      return sum + Math.abs(flow.amount);
    }, 0);
}

function severityByThreshold(amountWon: number, highWon: number, mediumWon: number): TaxPainSeverity {
  if (amountWon >= highWon) return "상";
  if (amountWon >= mediumWon) return "중";
  return "하";
}

export function scoreTaxPainPoints({
  client,
  fullText,
  taxPriority,
  taxFactorScore,
  taxOutflowWon,
}: {
  client: Client;
  fullText: string;
  taxPriority: boolean;
  taxFactorScore: number;
  taxOutflowWon: number;
}): TaxPainScore[] {
  const text = fullText.toLowerCase();
  const assetSize = client.assetSize || 0;
  const cashFlows = client.cashFlows ?? [];

  const financialIncomeWon = sumMatching(cashFlows, /금융소득|이자|배당|coupon|dividend/i, "positive");
  const inheritanceGiftWon = sumMatching(
    cashFlows,
    /증여세예상액|상속세예상액|증여실행금액|증여 실행|증여세|상속세|가업승계|상속|증여|gift|inheritance/i,
    "absolute",
  );
  const realEstateTaxWon = Math.max(
    sumMatching(cashFlows, /부동산양도세예상액|부동산 양도|양도소득세|양도세|종부세|재산세|부동산|상가|토지|주택|real.?estate|property/i, "negativeAbs"),
    taxOutflowWon,
  );
  const stockTaxWon = sumMatching(cashFlows, /해외주식양도세|주식 양도|대주주|ipo|보호예수|락업|비상장|해외주식|stock|capital/i, "negativeAbs");

  const inheritanceKeyword = /증여|상속|가업승계|승계|오너|2세|자녀|gift|inheritance/i.test(text);
  const businessSuccessionKeyword = /가업승계|승계|오너|2세/i.test(text);
  const realEstateKeyword = /부동산|종부|재산세|상가|토지|주택|다주택|양도|매각|real.?estate|property/i.test(text);
  const realEstateHighKeyword = /다주택|부동산.{0,15}(양도|매각)|양도.{0,15}부동산|법인보유.{0,15}부동산/i.test(text);
  const stockHighKeyword = /ipo|보호예수|락업|대주주/i.test(text);
  const stockKeyword = /주식|해외주식|비상장|지분|stock|equity/i.test(text);

  const points: TaxPainScore[] = [];

  if (financialIncomeWon > 0 || taxPriority || assetSize >= 5_000_000_000) {
    const severity = severityByThreshold(
      financialIncomeWon,
      TAX_PAIN_THRESHOLDS.financialIncome.highWon,
      TAX_PAIN_THRESHOLDS.financialIncome.mediumWon,
    );
    points.push({
      id: "financial-income",
      label: "금융소득종합과세와 이자·배당 집중",
      severity,
      basis: [
        `연간 이자·배당 입력 ${formatWonShort(financialIncomeWon)}`,
        `상 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.financialIncome.highWon)}, 중 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.financialIncome.mediumWon)}`,
      ],
    });
  }

  if (inheritanceGiftWon > 0 || inheritanceKeyword) {
    let severity: TaxPainSeverity = "하";
    if (
      inheritanceGiftWon >= TAX_PAIN_THRESHOLDS.inheritanceGift.highWon ||
      (inheritanceKeyword && assetSize >= TAX_PAIN_THRESHOLDS.inheritanceGift.keywordHighAssetWon)
    ) {
      severity = "상";
    } else if (
      inheritanceGiftWon >= TAX_PAIN_THRESHOLDS.inheritanceGift.mediumWon ||
      (businessSuccessionKeyword && assetSize >= TAX_PAIN_THRESHOLDS.inheritanceGift.businessSuccessionMediumAssetWon)
    ) {
      severity = "중";
    }
    points.push({
      id: "inheritance-gift",
      label: "상속·증여세와 가업승계 재원",
      severity,
      needsHeritageConsulting: severity === "상" || severity === "중",
      basis: [
        `증여·상속 관련 입력 ${formatWonShort(inheritanceGiftWon)}`,
        `상 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.inheritanceGift.highWon)}, 중 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.inheritanceGift.mediumWon)}`,
        inheritanceKeyword ? `총자산/키워드 보조 신호 ${formatWonShort(assetSize)}` : "키워드 보조 신호 없음",
      ],
    });
  }

  if (realEstateTaxWon > 0 || realEstateKeyword) {
    const severity =
      realEstateTaxWon >= TAX_PAIN_THRESHOLDS.realEstateTax.highWon || realEstateHighKeyword
        ? "상"
        : realEstateTaxWon >= TAX_PAIN_THRESHOLDS.realEstateTax.mediumWon || realEstateKeyword
          ? "중"
          : "하";
    points.push({
      id: "real-estate-tax",
      label: "종부세·재산세·부동산 양도세",
      severity,
      basis: [
        `부동산 세금성 유출 ${formatWonShort(realEstateTaxWon)}`,
        `상 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.realEstateTax.highWon)}, 중 기준 ${formatWonShort(TAX_PAIN_THRESHOLDS.realEstateTax.mediumWon)}`,
        realEstateHighKeyword ? "다주택/양도/법인보유 키워드 감지" : realEstateKeyword ? "부동산 키워드 감지" : "키워드 보조 신호 없음",
      ],
    });
  }

  if (stockTaxWon > 0 || stockKeyword || stockHighKeyword) {
    const severity =
      stockHighKeyword && stockTaxWon >= TAX_PAIN_THRESHOLDS.stockCapitalGain.highWon
        ? "상"
        : stockTaxWon > 0 || stockKeyword
          ? "중"
          : "하";
    points.push({
      id: "stock-capital-gain",
      label: "대주주·해외주식 양도소득세",
      severity,
      basis: [
        `주식 양도 관련 유출 ${formatWonShort(stockTaxWon)}`,
        `상 기준: IPO/보호예수/대주주 신호 + ${formatWonShort(TAX_PAIN_THRESHOLDS.stockCapitalGain.highWon)} 이상`,
        stockHighKeyword ? "IPO/보호예수/대주주 키워드 감지" : stockKeyword ? "고액 주식 관련 키워드 감지" : "키워드 보조 신호 없음",
      ],
    });
  }

  if (taxFactorScore >= TAX_PAIN_THRESHOLDS.taxExemptProducts.mediumTaxFactorScore || taxPriority || taxOutflowWon > 0) {
    const severity =
      taxFactorScore >= TAX_PAIN_THRESHOLDS.taxExemptProducts.highTaxFactorScore
        ? "상"
        : taxFactorScore >= TAX_PAIN_THRESHOLDS.taxExemptProducts.mediumTaxFactorScore || taxPriority
          ? "중"
          : "하";
    points.push({
      id: "tax-exempt-products",
      label: "비과세·분리과세·과세이연 상품 선별",
      severity,
      basis: [
        `7요인 세금 점수 ${taxFactorScore}/5`,
        `상 기준 ${TAX_PAIN_THRESHOLDS.taxExemptProducts.highTaxFactorScore}점 이상, 중 기준 ${TAX_PAIN_THRESHOLDS.taxExemptProducts.mediumTaxFactorScore}점 이상`,
        `세금성 예정 유출 ${formatWonShort(taxOutflowWon)}`,
      ],
    });
  }

  const order: TaxPainId[] = [
    "inheritance-gift",
    "financial-income",
    "real-estate-tax",
    "stock-capital-gain",
    "tax-exempt-products",
  ];

  return points.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
