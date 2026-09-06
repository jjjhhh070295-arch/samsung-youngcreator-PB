/**
 * 포트폴리오(수동 배분) 초안 — localStorage 키와 승인 전 검증.
 */

export type ManualAssetClass =
  | "domesticEquity"
  | "globalEquity"
  | "domesticBond"
  | "globalBond"
  | "alternatives"
  | "cash";

export type ManualAllocation = Record<ManualAssetClass, number>;

export type ManualSelectedInstrument = {
  symbol: string;
  name: string;
  assetClass: ManualAssetClass;
  weightWithinClass: number;
};

export type ManualPortfolioDraft = {
  version?: 2;
  /** 신규로 배분할 수 있는 잔여 자산의 비중(합계 100%). */
  allocation: ManualAllocation;
  /** 기존 보유주식과 신규 배분을 합친 전체 투자가능자산 기준 비중. */
  finalAllocation?: ManualAllocation;
  selected: ManualSelectedInstrument[];
  investableWon?: number;
  allocatableWon?: number;
  savedAt?: string;
};

const SEARCHABLE: ManualAssetClass[] = [
  "domesticEquity",
  "globalEquity",
  "domesticBond",
  "globalBond",
  "alternatives",
];

export function manualPortfolioStorageKey(clientId: string) {
  return `pb-manual-portfolio-v1-${clientId}`;
}

export function loadManualPortfolioDraft(clientId: string): ManualPortfolioDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(manualPortfolioStorageKey(clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManualPortfolioDraft;
    if (!parsed?.allocation || !Array.isArray(parsed.selected)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 현금을 잔여 비중으로 취급한다. 비현금 자산을 바꿀 때마다 합계가 정확히 100%가 되며,
 * 비현금 합계가 100%를 넘지 않도록 마지막 입력값을 자동 제한한다.
 */
export function updateAllocationWithCash(
  current: ManualAllocation,
  assetClass: Exclude<ManualAssetClass, "cash">,
  rawValue: number,
): ManualAllocation {
  const otherNonCash = SEARCHABLE
    .filter((key) => key !== assetClass)
    .reduce((sum, key) => sum + (Number(current[key]) || 0), 0);
  const available = Math.max(0, 100 - otherNonCash);
  const value = Math.min(available, Math.max(0, Number.isFinite(rawValue) ? rawValue : 0));
  const nonCashTotal = otherNonCash + value;
  return {
    ...current,
    [assetClass]: Math.round(value * 100) / 100,
    cash: Math.round((100 - nonCashTotal) * 100) / 100,
  };
}

/** 전체 기준 목표 비중에서 기존 고정 보유분을 제외해 잔여자산 내부 비중으로 환산한다. */
export function remainingPctForFinalTarget(finalPct: number, fixedPct: number, allocationScale: number): number {
  if (!Number.isFinite(allocationScale) || allocationScale <= 0) return 0;
  return Math.max(0, finalPct - fixedPct) / allocationScale;
}

/** 포트폴리오 승인 전 점검 — 배분 100%·종목 내부 비중 완료 여부. */
export function validateManualPortfolioForApproval(clientId: string): string[] {
  const draft = loadManualPortfolioDraft(clientId);
  if (!draft) return ["포트폴리오 배분 초안이 없습니다. 자산군 비중을 확인한 뒤 저장하세요."];

  const total = SEARCHABLE.reduce((sum, key) => sum + (Number(draft.allocation[key]) || 0), 0)
    + (Number(draft.allocation.cash) || 0);
  if (Math.abs(total - 100) >= 0.001) {
    return [`자산군 비중 합계가 100%가 아닙니다. (현재 ${total.toFixed(1)}%)`];
  }

  const reasons: string[] = [];
  for (const assetClass of SEARCHABLE) {
    const classWeight = Number(draft.allocation[assetClass]) || 0;
    if (classWeight <= 0) continue;
    const items = draft.selected.filter((row) => row.assetClass === assetClass);
    if (items.length === 0) {
      reasons.push(`${assetClass} 자산군에 편입 종목이 없습니다.`);
      continue;
    }
    const within = items.reduce((sum, row) => sum + (Number(row.weightWithinClass) || 0), 0);
    if (Math.abs(within - 100) >= 0.001) {
      reasons.push(`${assetClass} 내 비중 합계가 100%가 아닙니다. (현재 ${within.toFixed(1)}%)`);
    }
  }
  return reasons;
}
