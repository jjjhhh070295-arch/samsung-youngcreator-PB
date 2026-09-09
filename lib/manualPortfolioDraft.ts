/**
 * 포트폴리오(수동 배분) 초안 — localStorage 키(폴백)와 승인 전 검증.
 * DB 우선 저장/조회는 lib/store.ts의 savePortfolioDraft/getPortfolioDraft가 담당하고,
 * 이 파일의 함수들은 그 폴백(마이그레이션 미실행·데모 고객)으로만 쓰인다.
 */

import type { PbSelectedKoreanStock } from "./advisory/krTrendPortfolio";
import type { PortfolioAnalyticsSnapshot } from "./returnAssumptions";

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
  /** 지정가 — IPS 확정 시 가정 취득단가 (현지통화) */
  designatedPrice?: number | null;
  currency?: string;
  exchange?: string;
  kind?: string;
  /** share | bond_face | unit */
  quotationKind?: "share" | "bond_face" | "unit";
  quantityIncrement?: number;
  /** 채권 액면 */
  faceValue?: number | null;
  /** 외화 예산 환산에 사용한 FX */
  fxRate?: number | null;
  /** PB가 조정한 매수 수량(옵션) */
  plannedQuantity?: number | null;
  price?: number | null;
  asOf?: string | null;
  source?: string;
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
  /** KoreanStockTrendFilter의 체크 상태(티커 목록) — 이 초안 안에 함께 저장한다. */
  trendChecked?: string[];
  /** KoreanStockTrendFilter의 「후보 확정」 결과 — 이 초안 안에 함께 저장한다. */
  trendConfirmed?: PbSelectedKoreanStock[];
  /** 분석 스냅샷 — 승인·세금 산출에 사용 (decimal 수익률은 저장 시 %로 변환) */
  analyticsSnapshot?: PortfolioAnalyticsSnapshot;
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

/** DB 저장 실패(마이그레이션 미실행)·오프라인 폴백용. lib/store.ts의 savePortfolioDraft가 항상 함께 호출한다. */
export function saveManualPortfolioDraft(clientId: string, draft: ManualPortfolioDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(manualPortfolioStorageKey(clientId), JSON.stringify(draft));
  } catch {
    /* 용량 초과·프라이빗 모드 등 — 저장 실패해도 화면은 그대로 동작한다 */
  }
}

export function deleteManualPortfolioDraft(clientId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(manualPortfolioStorageKey(clientId));
  } catch {
    /* ignore */
  }
}

/**
 * 현금을 잔여 비중으로 취급한다.
 * 편집 중 비현금 합계가 100%를 넘어도 입력을 유지한다(저장 시에만 100% 검증).
 * 개별 자산군은 0~100%, 현금은 비현금<100% 일 때만 잔여, 그 외 0(음수 금지).
 */
export function updateAllocationWithCash(
  current: ManualAllocation,
  assetClass: Exclude<ManualAssetClass, "cash">,
  rawValue: number,
): ManualAllocation {
  const value = Math.min(100, Math.max(0, Number.isFinite(rawValue) ? rawValue : 0));
  const rounded = Math.round(value * 100) / 100;
  const otherNonCash = SEARCHABLE
    .filter((key) => key !== assetClass)
    .reduce((sum, key) => sum + (Number(current[key]) || 0), 0);
  const nonCashTotal = otherNonCash + rounded;
  const cash =
    nonCashTotal >= 100 ? 0 : Math.round((100 - nonCashTotal) * 100) / 100;
  return {
    ...current,
    [assetClass]: rounded,
    cash: Math.max(0, cash),
  };
}

export function allocationTotalPct(allocation: ManualAllocation): number {
  return (
    SEARCHABLE.reduce((sum, key) => sum + (Number(allocation[key]) || 0), 0) +
    (Number(allocation.cash) || 0)
  );
}

export function allocationExcessPctPoints(allocation: ManualAllocation): number {
  return Math.max(0, Math.round((allocationTotalPct(allocation) - 100) * 100) / 100);
}

/** 배분 확정 저장 전: 합계 100%(허용 오차 포함) */
export function isAllocationTotalExact100(
  allocation: ManualAllocation,
  tolerance = 0.001,
): boolean {
  return Math.abs(allocationTotalPct(allocation) - 100) < tolerance;
}

/** 전체 기준 목표 비중에서 기존 고정 보유분을 제외해 잔여자산 내부 비중으로 환산한다. */
export function remainingPctForFinalTarget(finalPct: number, fixedPct: number, allocationScale: number): number {
  if (!Number.isFinite(allocationScale) || allocationScale <= 0) return 0;
  return Math.max(0, finalPct - fixedPct) / allocationScale;
}

/** 포트폴리오 승인 전 점검 — 배분 100%·종목 내부 비중 완료 여부. */
export function validateManualPortfolioForApproval(
  clientId: string,
  draftOverride?: ManualPortfolioDraft | null,
): string[] {
  const draft =
    draftOverride !== undefined ? draftOverride : loadManualPortfolioDraft(clientId);
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
    for (const row of items) {
      const qk = row.quotationKind;
      const isDirectBond =
        (qk === "bond_face" || row.assetClass === "domesticBond" || row.assetClass === "globalBond") &&
        row.kind &&
        !String(row.kind).toLowerCase().includes("etf") &&
        !String(row.kind).toLowerCase().includes("etn");
      if (isDirectBond && (row.faceValue == null || row.faceValue <= 0)) {
        reasons.push(`${row.name || row.symbol}: 직접채권 액면가를 입력하세요.`);
      }
      // 상장 주식·ETF 지정가는 IPS 확정 시 KIS 스냅샷으로 대체 — 초안 검증에서 요구하지 않음.
    }
  }
  return reasons;
}
