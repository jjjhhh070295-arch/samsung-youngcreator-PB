import { MAX_SELECTED_KR_STOCKS } from "./krConstants";

export interface RankableKrStock {
  ticker: string;
  name: string;
  marketCapWon: number | null;
  changePct: number;
}

export interface TopKrSelection<T extends RankableKrStock> {
  selected: Array<T & { finalRank: number; selected: true }>;
  excluded: Array<T & { finalRank: number; selected: false; excludeReason: string }>;
}

/**
 * 최종 후보 → 시총↓, 상승률↓, 코드↑ → 상위 MAX_SELECTED_KR_STOCKS만 선정.
 * 시총 검증 불가 종목은 순위에서 제외.
 */
export function selectTopKrStocksByMarketCap<T extends RankableKrStock>(
  finalCandidates: T[],
  max = MAX_SELECTED_KR_STOCKS,
): TopKrSelection<T> {
  const verifiable = finalCandidates.filter(
    (c) => c.marketCapWon != null && Number.isFinite(c.marketCapWon) && (c.marketCapWon as number) > 0,
  );
  const sorted = [...verifiable].sort((a, b) => {
    const capDiff = (b.marketCapWon as number) - (a.marketCapWon as number);
    if (capDiff !== 0) return capDiff;
    const chg = b.changePct - a.changePct;
    if (chg !== 0) return chg;
    return a.ticker.localeCompare(b.ticker);
  });

  const selected = sorted.slice(0, max).map((c, i) => ({
    ...c,
    finalRank: i + 1,
    selected: true as const,
  }));
  const excluded = sorted.slice(max).map((c, i) => ({
    ...c,
    finalRank: max + i + 1,
    selected: false as const,
    excludeReason: `최대 ${max}종목 제한으로 제외`,
  }));

  return { selected, excluded };
}

/**
 * 주식 버킷 비중을 n종목에 동일 배분. 소수점 잔여는 1위(시총)에 가산.
 */
export function allocateEqualEquityWeights(equityWeight: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [Math.round(equityWeight * 10) / 10];
  const raw = equityWeight / count;
  const floored = Array.from({ length: count }, () => Math.floor(raw * 10) / 10);
  const sum = floored.reduce((a, b) => a + b, 0);
  const remainder = Math.round((equityWeight - sum) * 10) / 10;
  floored[0] = Math.round((floored[0] + remainder) * 10) / 10;
  return floored;
}
