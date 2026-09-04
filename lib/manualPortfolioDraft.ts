/**
 * Portfolio 2(수동 배분) 초안 — localStorage 키와 승인 전 검증.
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
  allocation: ManualAllocation;
  selected: ManualSelectedInstrument[];
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

/** 포트폴리오 승인 전 점검 — 배분 100%·종목 내부 비중 완료 여부. */
export function validateManualPortfolioForApproval(clientId: string): string[] {
  const draft = loadManualPortfolioDraft(clientId);
  if (!draft) return ["포트폴리오 2 배분 초안이 없습니다. 자산군 비중을 100%로 맞춘 뒤 저장하세요."];

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
