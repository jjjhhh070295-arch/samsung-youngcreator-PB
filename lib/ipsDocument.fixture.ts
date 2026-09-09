import { emptyIPS, type Client } from "./types";

/** Fictional, deterministic data for document rendering. Never loads customer records. */
export function ipsDocumentFixture(instrumentCount = 4): Client {
  const ips = emptyIPS();
  const values = {
    return: "장기적인 자산 증식과 안정적인 투자 수익 추구",
    risk: "적극투자형 · 시장 변동에 따른 원금 손실 가능성 수용",
    timeHorizon: "3년 이상",
    tax: "금융소득 및 해외투자 관련 세무 검토 필요",
    liquidity: "예정된 생활자금과 납세자금을 별도 확보",
    legal: "국내 거주 개인 · 파생상품 직접투자 제외",
    unique: "가족의 교육자금 지출을 고려하여 운용",
  };
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    ips[key] = { ...ips[key], value: values[key], source: "manual", status: "explicit", reviewed: true };
  }
  const names = ["삼성전자", "KODEX 미국S&P500", "KODEX 국고채3년", "KODEX 미국달러단기채권액티브"];
  const symbols = ["005930.KS", "379800.KS", "114260.KS", "329750.KS"];
  const labels = ["국내주식", "해외주식", "국내채권", "해외채권"];
  const keys = ["domesticEquity", "globalEquity", "domesticBond", "globalBond"];
  return {
    id: "ips-design-fixture", code: "C-SAMPLE-001", name: "김고객", clientType: "individual",
    birthDate: "1975-05-20", assignedPbId: "sample-pb", assetSize: 3_000_000_000,
    createdAt: "2026-09-08T00:00:00Z", consultationNotes: "", ips,
    stages: { basic: true, factors: true, cashflow: true, portfolio: true, stress: true, ips: true },
    cashFlows: [{ id: "sample-cashflow", label: "현금흐름 비공개 테스트", amount: 5_000_000, date: "2026-09", recurring: true }],
    portfolios: [{
      id: "sample-portfolio", label: "맞춤 포트폴리오", editedByPb: true,
      confirmedAt: "2026-09-08T00:00:00Z", compositionRevision: "sample-private-revision",
      expectedReturn: 5.74, expectedRisk: 9.26, metricsStatus: "ok", taxNote: "", rationale: "",
      allocations: [{ assetClass: "국내주식", weight: 30 }, { assetClass: "해외주식", weight: 25 }, { assetClass: "국내채권", weight: 20 }, { assetClass: "해외채권", weight: 15 }, { assetClass: "현금성", weight: 10 }],
      instruments: Array.from({ length: instrumentCount }, (_, i) => ({
        symbol: i < 4 ? symbols[i] : `SAMPLE-${i}`, name: i < 4 ? names[i] : `추가 편입 상품 ${i + 1}`,
        assetClassKey: keys[i % 4], assetClassLabel: labels[i % 4], currency: "KRW",
        weightWithinClass: 100, totalWeightPct: instrumentCount === 4 ? [30, 25, 20, 15][i] : 90 / instrumentCount,
        allocationAmountWon: instrumentCount === 4 ? [900_000_000, 750_000_000, 600_000_000, 450_000_000][i] : 2_700_000_000 / instrumentCount,
        quantity: [12000, 20000, 4500, 8000][i % 4], priceSnapshot: null, bookkeepingNote: "",
      })),
    }],
  };
}
