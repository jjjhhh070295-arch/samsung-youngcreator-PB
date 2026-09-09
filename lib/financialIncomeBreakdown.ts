/**
 * 금융소득 분해 — 외부 확정 / 예·적금 파생 / 채권·배당 파생을 한 번만 합산.
 * missing(null) 과 진짜 0 을 구분한다.
 */

import type { FinancialIncomeProfile } from "./types";
import type { DepositProduct } from "./tax/depositInterest";
import { aggregateDerivedDepositInterest } from "./tax/depositInterest";

export type FinancialIncomeBreakdown = {
  externalInterestWon: number | null;
  derivedDepositInterestWon: number | null;
  derivedBondInterestWon: number | null;
  totalInterestWon: number | null;
  externalDividendWon: number | null;
  derivedDividendWon: number | null;
  totalDividendWon: number | null;
  totalFinancialIncomeWon: number | null;
  /** 예·적금만 전부 미완성 등으로 합계를 확정할 수 없을 때 */
  interestPending: boolean;
  dividendPending: boolean;
  incompleteReasons: string[];
};

function clampNonNeg(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(0, v);
}

function addNullable(parts: Array<number | null>, opts?: { pending?: boolean }): number | null {
  if (opts?.pending) return null;
  let any = false;
  let sum = 0;
  for (const p of parts) {
    if (p == null) continue;
    any = true;
    sum += p;
  }
  // 모든 성분이 null 이고 pending 아니면 — 입력이 전혀 없으면 0이 아니라 null?
  // 표시: 외부 null + 예적금 0 + 채권 null → 합계는 0(예적금이 확정 0) 또는 예적금만.
  // 규칙: 하나라도 확정 숫자면 합산, 전부 null이면 null.
  return any ? sum : null;
}

export type DepositInterestSnapshot = {
  totalGrossWon: number | null;
  incomplete: boolean;
  /** 전부 incomplete 이거나 제품이 있어 합계를 표시할 수 없음 */
  allIncomplete: boolean;
};

/** 예·적금 제품 → 파생 이자 스냅샷 (UI·캐시 공통) */
export function depositInterestSnapshotFromProducts(
  products: DepositProduct[],
  opts?: { asOf?: string | null; projectionYear?: number },
): DepositInterestSnapshot {
  if (!products.length) {
    return { totalGrossWon: 0, incomplete: false, allIncomplete: false };
  }
  const agg = aggregateDerivedDepositInterest(products, opts);
  const allIncomplete = agg.byProduct.length > 0 && agg.byProduct.every((r) => r.status === "incomplete");
  return {
    totalGrossWon: allIncomplete ? null : (agg.totalGrossWon ?? 0),
    incomplete: agg.incomplete,
    allIncomplete,
  };
}

/**
 * 승인·요약·임계값용 전체 금융소득 분해.
 * depositSnapshot 이 있으면 제품 산출이 profile.derivedDepositInterestWon 캐시보다 우선.
 */
export function buildFinancialIncomeBreakdown(
  profile: FinancialIncomeProfile,
  opts?: {
    depositSnapshot?: DepositInterestSnapshot | null;
  },
): FinancialIncomeBreakdown {
  const externalInterestWon = clampNonNeg(profile.interestIncomeWon);
  const externalDividendWon = clampNonNeg(profile.dividendIncomeWon);
  const derivedBondInterestWon = clampNonNeg(profile.derivedBondInterestWon ?? null);
  const derivedDividendWon = clampNonNeg(profile.derivedDividendWon ?? null);

  const snap = opts?.depositSnapshot;
  let derivedDepositInterestWon: number | null;
  let interestPending = false;
  const incompleteReasons: string[] = [];

  if (snap) {
    if (snap.allIncomplete) {
      derivedDepositInterestWon = null;
      interestPending = true;
      incompleteReasons.push("예·적금 잔액·이율·기간 입력이 필요합니다.");
    } else {
      derivedDepositInterestWon = snap.totalGrossWon;
      if (snap.incomplete) {
        incompleteReasons.push("일부 예·적금은 입력이 미완이라 합계에 포함되지 않았습니다.");
      }
    }
  } else if (profile.derivedDepositInterestWon != null && Number.isFinite(profile.derivedDepositInterestWon)) {
    derivedDepositInterestWon = clampNonNeg(profile.derivedDepositInterestWon);
  } else {
    derivedDepositInterestWon = null;
  }

  const totalInterestWon =
    interestPending && externalInterestWon == null && derivedBondInterestWon == null
      ? null
      : (() => {
          const parts = [
            externalInterestWon,
            interestPending ? null : derivedDepositInterestWon,
            derivedBondInterestWon,
          ];
          // pending 이지만 외부/채권이 있으면 예적금 제외한 부분 합
          if (interestPending) {
            return addNullable([externalInterestWon, derivedBondInterestWon]) ??
              (externalInterestWon == null && derivedBondInterestWon == null ? null : 0);
          }
          return addNullable(parts);
        })();

  const totalDividendWon = addNullable([externalDividendWon, derivedDividendWon]);
  const totalFinancialIncomeWon =
    totalInterestWon == null && totalDividendWon == null
      ? null
      : (totalInterestWon ?? 0) + (totalDividendWon ?? 0);

  return {
    externalInterestWon,
    derivedDepositInterestWon,
    derivedBondInterestWon,
    totalInterestWon,
    externalDividendWon,
    derivedDividendWon,
    totalDividendWon,
    totalFinancialIncomeWon,
    interestPending:
      interestPending && externalInterestWon == null && derivedBondInterestWon == null,
    dividendPending: false,
    incompleteReasons,
  };
}

export function annualFinancialIncomeFromBreakdown(b: FinancialIncomeBreakdown): number {
  if (b.totalFinancialIncomeWon != null && Number.isFinite(b.totalFinancialIncomeWon)) {
    return Math.max(0, b.totalFinancialIncomeWon);
  }
  // pending: 확정된 부분만
  return (
    Math.max(0, b.externalInterestWon ?? 0) +
    Math.max(0, b.derivedDepositInterestWon ?? 0) +
    Math.max(0, b.derivedBondInterestWon ?? 0) +
    Math.max(0, b.externalDividendWon ?? 0) +
    Math.max(0, b.derivedDividendWon ?? 0)
  );
}

/**
 * Preview 이중계상 방지: includeInManagedPreview 인 제품 이자는 preview 경로에서만,
 * 나머지는 existing(baseline) 금융소득에 넣는다.
 */
export function partitionDepositInterestForTaxContext(
  products: DepositProduct[],
  opts?: { asOf?: string | null; projectionYear?: number },
): {
  nonPreviewInterestWon: number;
  previewProductIds: string[];
  incompleteNonPreview: boolean;
} {
  const preview: DepositProduct[] = [];
  const nonPreview: DepositProduct[] = [];
  for (const p of products) {
    if (p.includeInManagedPreview) preview.push(p);
    else nonPreview.push(p);
  }
  const nonSnap = depositInterestSnapshotFromProducts(nonPreview, opts);
  return {
    nonPreviewInterestWon: nonSnap.allIncomplete ? 0 : Math.max(0, nonSnap.totalGrossWon ?? 0),
    previewProductIds: preview.map((p) => p.id),
    incompleteNonPreview: nonSnap.incomplete,
  };
}

/** baseline existingInterest = 외부 확정 + 비-preview 예적금 + 채권 파생 */
export function baselineExistingInterestWon(
  profile: FinancialIncomeProfile,
  products: DepositProduct[] | null | undefined,
  opts?: { asOf?: string | null; projectionYear?: number },
): number | null {
  const external = clampNonNeg(profile.interestIncomeWon);
  const bond = clampNonNeg(profile.derivedBondInterestWon ?? null);
  const part = products?.length
    ? partitionDepositInterestForTaxContext(products, opts)
    : { nonPreviewInterestWon: 0, previewProductIds: [], incompleteNonPreview: false };

  // 캐시 전액(derivedDepositInterestWon)은 preview 분과 겹칠 수 있어 products 가 있을 때 쓰지 않음
  const parts = [external, part.nonPreviewInterestWon, bond];
  const anyKnown = external != null || bond != null || (products?.length ?? 0) > 0;
  if (!anyKnown) return external; // legacy: null
  return parts.reduce<number>((s, v) => s + (v ?? 0), 0);
}

export function baselineExistingDividendWon(profile: FinancialIncomeProfile): number | null {
  const external = clampNonNeg(profile.dividendIncomeWon);
  const derived = clampNonNeg(profile.derivedDividendWon ?? null);
  if (external == null && derived == null) return null;
  return (external ?? 0) + (derived ?? 0);
}
