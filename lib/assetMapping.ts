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

// ─── macroStress API 연결 ────────────────────────────────────────────────────

/**
 * macroStress API(?us=&kr=&bond=) 입력 파라미터.
 * app/api/macro-stress/route.ts는 us+kr+bond 합계를 1.0으로 재정규화하므로
 * 여기서 반환하는 us/kr/bond의 합계가 정확히 1이 아니어도 무방.
 */
export interface MacroApiParams {
  /** S&P500 비중 (0–1), ?us= 에 해당 */
  us: number;
  /** KOSPI 비중 (0–1), ?kr= 에 해당 */
  kr: number;
  /** 미국채 비중 (0–1), ?bond= 에 해당 */
  bond: number;
  /**
   * SET 내 헤지자산(mmf+gold+dollar+raw) 합계 비중 %.
   * macroStress 결과(CVaR/MDD 등)는 주식+채권 슬리브(equityBondPct%) 기준.
   * 전체 포트폴리오 기준 손실 추정: 결과값 × (equityBondPct / 100)
   */
  hedgePct: number;
  equityBondPct: number;
  hedgeDetail: { gold: number; dollar: number; raw: number; mmf: number };
}

/**
 * SET 6자산 비중을 macroStress API 입력 파라미터로 변환.
 *
 * 헤지자산(mmf/gold/dollar/raw) 처리 방식:
 *   macroStress 모델은 sp500/kospi/treasury 세 자산만 이해한다.
 *   헤지자산은 스트레스 모델 밖 안전자산이므로 제외 후 주식+채권 부분만 재정규화.
 *
 *   예: etf45/bond30/hedge25 → sp500=27/kospi=18/treasury=30(합=75)
 *       → macroStress 입력: us=36%/kr=24%/bond=40%(합=100%)
 *       → 결과는 주식+채권 슬리브(75%) 기준. 전체 포트폴리오 = 결과 × 0.75
 *
 * route.ts가 내부에서도 정규화하므로 비정규화 값을 그대로 전달해도 동작은 같다.
 * 이 함수는 명시적으로 정규화하여 호출자가 비율을 직접 확인할 수 있게 한다.
 */
export function setToMacroApiParams(
  set: SetWeights,
  etfHoldings?: EtfHolding[],
): MacroApiParams {
  const idx = convertSetToIndices(set, etfHoldings);
  const equityBondTotal = idx.sp500 + idx.kospi + idx.treasury;
  const divisor = equityBondTotal > 0 ? equityBondTotal : 1;

  return {
    us: idx.sp500 / divisor,
    kr: idx.kospi / divisor,
    bond: idx.treasury / divisor,
    hedgePct: round1(idx.hedgeTotal),
    equityBondPct: round1(equityBondTotal),
    hedgeDetail: { ...idx.hedge },
  };
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
