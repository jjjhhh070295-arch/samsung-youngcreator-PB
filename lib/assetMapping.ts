/**
 * SET 6자산(etf/bond/mmf/gold/dollar/raw)을 시장 지수 기반 분류로 변환하는 통일 함수.
 *
 * 기존 코드(calculateSimulatedMetrics, buildBenchmarkChartData, macroStress)를
 * 수정하지 않고 추가만 한 파일. 단계적 통일 시 이 함수를 각 호출 지점에 연결.
 */

/** SET 6자산 비중 입력 (합계 100%) */
export interface SetWeights {
  etf: number;
  bond: number;
  mmf: number;
  gold: number;
  dollar: number;
  raw: number;
  els?: number; // ELS 있으면 bond×0.7 + mmf×0.3으로 흡수 (portfolio.ts 컨벤션)
}

/** ETF 버킷 내 보유 종목 (해외/국내 판별용) */
export interface EtfHolding {
  name: string;
  weight: number; // 상대 비중 (합계 무관, 비율만 사용)
}

/** 변환 결과 */
export interface IndexWeights {
  sp500: number;      // 해외주식 비중 %
  kospi: number;      // 국내주식 비중 %
  treasury: number;   // 채권 비중 %
  hedge: {
    gold: number;
    dollar: number;
    raw: number;
    mmf: number;
  };
  hedgeTotal: number; // hedge 4개 합계 %
}

/**
 * 해외 종목 판별 패턴.
 * buildSimplifiedBenchmarkChartData(PortfolioPanel.tsx:414)와 동일 — 변경 시 양쪽 동기화 필요.
 */
export const OVERSEAS_PATTERN =
  /S&P|NVIDIA|Microsoft|Apple|Broadcom|Eli Lilly|Nasdaq|Nifty|미국|해외|나스닥|인도/i;

/** ETF holdings 없을 때 기본 해외:국내 비율 (B1/B3 기준 S&P500 60% : KOSPI 40%) */
export const ETF_OVERSEAS_RATIO_DEFAULT = 0.6;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/**
 * SET 6자산 비중을 시장 지수 기반 분류로 변환한다.
 *
 * @param set          포트폴리오 SET 비중 {etf, bond, mmf, gold, dollar, raw}
 * @param etfHoldings  ETF 버킷 보유 종목 목록 (선택). 있으면 종목명으로 해외/국내 분리,
 *                     없으면 기본 sp500 60% : kospi 40% 폴백.
 *
 * 합계 보장:
 *   sp500 + kospi + treasury + hedgeTotal = sum(set 입력값)
 *   입력 합계가 100이면 출력 합계도 100 (반올림 오차 ±0.1% 이내)
 */
export function convertSetToIndices(
  set: SetWeights,
  etfHoldings?: EtfHolding[],
): IndexWeights {
  const els = set.els ?? 0;
  const effectiveBond = set.bond + els * 0.7;
  const effectiveMmf = set.mmf + els * 0.3;

  // ETF → sp500 / kospi 분리
  let sp500: number;
  let kospi: number;

  if (etfHoldings && etfHoldings.length > 0) {
    const etfTotal = etfHoldings.reduce((s, h) => s + h.weight, 0) || 1;
    const overseasWeight = etfHoldings.reduce(
      (s, h) => s + (OVERSEAS_PATTERN.test(h.name) ? h.weight : 0),
      0,
    );
    const overseasRatio = Math.min(1, Math.max(0, overseasWeight / etfTotal));
    sp500 = set.etf * overseasRatio;
    kospi = set.etf * (1 - overseasRatio);
  } else {
    sp500 = set.etf * ETF_OVERSEAS_RATIO_DEFAULT;
    kospi = set.etf * (1 - ETF_OVERSEAS_RATIO_DEFAULT);
  }

  const hedge = {
    gold: set.gold,
    dollar: set.dollar,
    raw: set.raw,
    mmf: effectiveMmf,
  };
  const hedgeTotal = hedge.gold + hedge.dollar + hedge.raw + hedge.mmf;

  return {
    sp500: round1(sp500),
    kospi: round1(kospi),
    treasury: round1(effectiveBond),
    hedge: {
      gold: round1(hedge.gold),
      dollar: round1(hedge.dollar),
      raw: round1(hedge.raw),
      mmf: round1(hedge.mmf),
    },
    hedgeTotal: round1(hedgeTotal),
  };
}
