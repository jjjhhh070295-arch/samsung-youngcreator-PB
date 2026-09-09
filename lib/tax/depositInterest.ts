/**
 * 예·적금 이자 산출 — 단순화 UI 기준(잔액·연이율·개시·만기연수).
 * 예금: asOf → 만기 잔액 이자
 * 적금: asOf → 만기 현재잔액 이자 + 미래 월납 각 회차 이자 (과거 납입 이중계상 금지)
 */

import {
  interestWithholdingParts,
  roundWon,
} from "./koreanResidentTax2026";
import {
  futureMonthlyContributionDates,
  parseCivilDate,
  resolveMaturesAt,
} from "./depositMaturity";

export type DepositProductType = "deposit" | "installment";
export type DepositInterestConvention = "simple" | "compound_annual";
export type DepositTaxStatus = "taxable" | "exempt" | "preferential" | "unknown";
export type DepositContributionFrequency = "monthly" | "weekly" | "once";

export interface DepositProduct {
  id: string;
  /** 레거시 — UI에서 미사용 */
  institution: string;
  /** 레거시 — UI에서 미사용 */
  productName: string;
  productType: DepositProductType;
  currency: string;
  /** 현재 원금/잔액(asOf 기준). null = 미입력 */
  principalWon: number | null;
  annualRatePct: number | null;
  openedAt: string | null;
  /** 선택 만기 연수(1–10). null 이면 레거시 maturesAt 확인 */
  termYears?: number | null;
  maturesAt: string | null;
  interestSchedule: string | null;
  convention: DepositInterestConvention;
  taxStatus: DepositTaxStatus;
  contributionAmountWon?: number | null;
  contributionFrequency?: DepositContributionFrequency | null;
  /** 레거시 개별 납입일 — 신규 경로에서는 자동 생성 */
  contributionDates?: string[] | null;
  includeInManagedPreview: boolean;
  identifiedInCashBalance: boolean;
  source: string | null;
  asOf: string | null;
}

export interface DepositInterestResult {
  productId: string;
  status: "ok" | "incomplete" | "exempt" | "matured";
  grossInterestWon: number | null;
  withholdingNationalWon: number | null;
  withholdingLocalWon: number | null;
  withholdingTotalWon: number | null;
  byTaxYear: Record<string, number>;
  notes: string[];
  /** 해석된 만기일 */
  resolvedMaturesAt?: string | null;
  legacyMaturityNeedsReview?: boolean;
}

function yearFraction(fromIso: string, toIso: string): number {
  const from = parseCivilDate(fromIso);
  const to = parseCivilDate(toIso);
  if (!from || !to) return 0;
  const fromUtc = Date.UTC(from.y, from.m - 1, from.d);
  const toUtc = Date.UTC(to.y, to.m - 1, to.d);
  const ms = toUtc - fromUtc;
  if (ms <= 0) return 0;
  if (from.m === to.m && from.d === to.d && to.y !== from.y) {
    return to.y - from.y;
  }
  return ms / (365 * 24 * 3600 * 1000);
}

function allocateByCalendarYears(
  gross: number,
  startIso: string,
  endIso: string,
): Record<string, number> {
  const start = parseCivilDate(startIso);
  const end = parseCivilDate(endIso);
  if (!start || !end || gross <= 0) return {};
  const totalFrac = yearFraction(startIso, endIso);
  if (totalFrac <= 0) return {};
  const out: Record<string, number> = {};
  let y = start.y;
  let remaining = gross;
  while (y <= end.y && remaining !== 0) {
    const sliceStart = y === start.y ? startIso : `${y}-01-01`;
    const sliceEnd = y === end.y ? endIso : `${y}-12-31`;
    const frac = yearFraction(sliceStart, sliceEnd);
    if (frac > 0) {
      const portion = roundWon(gross * (frac / totalFrac));
      out[String(y)] = (out[String(y)] ?? 0) + portion;
      remaining -= portion;
    }
    y += 1;
  }
  if (remaining !== 0) {
    const key = String(end.y);
    out[key] = (out[key] ?? 0) + remaining;
  }
  return out;
}

function mergeByYear(
  into: Record<string, number>,
  add: Record<string, number>,
): Record<string, number> {
  const out = { ...into };
  for (const [y, v] of Object.entries(add)) {
    out[y] = (out[y] ?? 0) + v;
  }
  return out;
}

function incomplete(productId: string, note: string): DepositInterestResult {
  return {
    productId,
    status: "incomplete",
    grossInterestWon: null,
    withholdingNationalWon: null,
    withholdingLocalWon: null,
    withholdingTotalWon: null,
    byTaxYear: {},
    notes: [note],
  };
}

function simpleInterestOnBalance(input: {
  balanceWon: number;
  annualRatePct: number;
  fromIso: string;
  toIso: string;
}): { gross: number; byTaxYear: Record<string, number> } {
  const frac = yearFraction(input.fromIso, input.toIso);
  if (frac <= 0 || input.balanceWon <= 0) {
    return { gross: 0, byTaxYear: {} };
  }
  const gross = roundWon(input.balanceWon * (input.annualRatePct / 100) * frac);
  return {
    gross: Math.max(0, gross),
    byTaxYear: allocateByCalendarYears(Math.max(0, gross), input.fromIso, input.toIso),
  };
}

/**
 * 단일 상품 예상 이자(상담용).
 * asOf 가 만기 이후이면 matured + 0.
 */
export function calculateDepositInterest(
  product: DepositProduct,
  opts?: { asOf?: string | null; projectionYear?: number },
): DepositInterestResult {
  const notes: string[] = [];
  const resolved = resolveMaturesAt({
    openedAt: product.openedAt,
    termYears: product.termYears ?? null,
    maturesAt: product.maturesAt,
  });
  if (resolved.legacyMaturityNeedsReview) {
    notes.push("기존 만기일 확인 필요");
  }

  if (product.taxStatus === "exempt") {
    return {
      productId: product.id,
      status: "exempt",
      grossInterestWon: 0,
      withholdingNationalWon: 0,
      withholdingLocalWon: 0,
      withholdingTotalWon: 0,
      byTaxYear: {},
      notes: ["비과세 상품 — 원천징수 0 (증빙 필요)", ...notes],
      resolvedMaturesAt: resolved.maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }

  if (product.principalWon == null || product.annualRatePct == null) {
    return {
      ...incomplete(product.id, "잔액 또는 약정이율이 없어 이자를 산출하지 않았습니다."),
      notes: [
        "잔액 또는 약정이율이 없어 이자를 산출하지 않았습니다.",
        ...notes,
      ],
      resolvedMaturesAt: resolved.maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }
  if (product.principalWon < 0 || product.annualRatePct < 0) {
    return {
      ...incomplete(product.id, "잔액·이율은 0 이상이어야 합니다."),
      resolvedMaturesAt: resolved.maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }
  if (!product.openedAt || !resolved.maturesAt) {
    return {
      ...incomplete(product.id, "개시일과 만기(연수)가 필요합니다."),
      resolvedMaturesAt: resolved.maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }
  if (product.productType === "installment" && product.contributionAmountWon == null) {
    return {
      ...incomplete(product.id, "적금 회차 납입액이 필요합니다."),
      resolvedMaturesAt: resolved.maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }

  const asOfIso = (opts?.asOf ?? product.asOf ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const maturesAt = resolved.maturesAt;

  if (yearFraction(asOfIso, maturesAt) <= 0) {
    return {
      productId: product.id,
      status: "matured",
      grossInterestWon: 0,
      withholdingNationalWon: 0,
      withholdingLocalWon: 0,
      withholdingTotalWon: 0,
      byTaxYear: {},
      notes: ["만기 도래 — 향후 예상 이자 0", ...notes],
      resolvedMaturesAt: maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }

  let grossInterestWon = 0;
  let byTaxYear: Record<string, number> = {};

  // 현재 잔액: asOf → 만기
  const onBalance = simpleInterestOnBalance({
    balanceWon: product.principalWon,
    annualRatePct: product.annualRatePct,
    fromIso: asOfIso,
    toIso: maturesAt,
  });
  grossInterestWon += onBalance.gross;
  byTaxYear = mergeByYear(byTaxYear, onBalance.byTaxYear);

  if (product.productType === "installment") {
    const contrib = product.contributionAmountWon!;
    if (contrib < 0) {
      return {
        ...incomplete(product.id, "회차 납입액은 0 이상이어야 합니다."),
        resolvedMaturesAt: maturesAt,
        legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
      };
    }
    const futureDates = futureMonthlyContributionDates({
      openedAt: product.openedAt,
      maturesAt,
      asOf: asOfIso,
    });
    for (const date of futureDates) {
      const part = simpleInterestOnBalance({
        balanceWon: contrib,
        annualRatePct: product.annualRatePct,
        fromIso: date,
        toIso: maturesAt,
      });
      grossInterestWon += part.gross;
      byTaxYear = mergeByYear(byTaxYear, part.byTaxYear);
    }
  }

  grossInterestWon = Math.max(0, roundWon(grossInterestWon));

  if (product.taxStatus === "unknown") {
    notes.push("과세 여부 미확인 — 원천징수는 표시용 참고치입니다.");
  }
  if (product.taxStatus === "preferential") {
    notes.push("우대·분리과세 상품 — 표준 15.4% 참고치와 다를 수 있습니다. 확인 필요.");
  }

  const wh =
    product.taxStatus === "taxable" || product.taxStatus === "unknown"
      ? interestWithholdingParts(grossInterestWon)
      : { nationalWon: 0, localWon: 0, totalWon: 0 };

  if (opts?.projectionYear != null) {
    const y = String(opts.projectionYear);
    const yearGross = Math.max(0, byTaxYear[y] ?? 0);
    const yearWh = interestWithholdingParts(yearGross);
    return {
      productId: product.id,
      status: "ok",
      grossInterestWon: yearGross,
      withholdingNationalWon: yearWh.nationalWon,
      withholdingLocalWon: yearWh.localWon,
      withholdingTotalWon: yearWh.totalWon,
      byTaxYear,
      notes,
      resolvedMaturesAt: maturesAt,
      legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
    };
  }

  return {
    productId: product.id,
    status: "ok",
    grossInterestWon,
    withholdingNationalWon: wh.nationalWon,
    withholdingLocalWon: wh.localWon,
    withholdingTotalWon: wh.totalWon,
    byTaxYear,
    notes,
    resolvedMaturesAt: maturesAt,
    legacyMaturityNeedsReview: resolved.legacyMaturityNeedsReview,
  };
}

/** @deprecated 테스트·호환용 — 단순 예금 asOf=개시일로 전체 기간 */
export function termDepositSimpleInterest(input: {
  principalWon: number;
  annualRatePct: number;
  openedAt: string;
  maturesAt: string;
  asOf?: string | null;
}): { grossInterestWon: number; byTaxYear: Record<string, number> } {
  const product: DepositProduct = {
    id: "tmp",
    institution: "",
    productName: "",
    productType: "deposit",
    currency: "KRW",
    principalWon: input.principalWon,
    annualRatePct: input.annualRatePct,
    openedAt: input.openedAt,
    maturesAt: input.maturesAt,
    interestSchedule: null,
    convention: "simple",
    taxStatus: "taxable",
    includeInManagedPreview: true,
    identifiedInCashBalance: false,
    source: "test",
    asOf: input.asOf ?? input.openedAt,
  };
  const r = calculateDepositInterest(product);
  return {
    grossInterestWon: r.grossInterestWon ?? 0,
    byTaxYear: r.byTaxYear,
  };
}

export function sumDepositBalances(products: DepositProduct[]): {
  totalPrincipalWon: number | null;
  incomplete: boolean;
} {
  let sum = 0;
  let incompleteFlag = false;
  for (const p of products) {
    if (p.principalWon == null) {
      incompleteFlag = true;
      continue;
    }
    sum += p.principalWon;
  }
  return { totalPrincipalWon: products.length === 0 ? 0 : sum, incomplete: incompleteFlag };
}

/** 예·적금 집계 이자 — 외부 확정 이자와 별도 */
export function aggregateDerivedDepositInterest(
  products: DepositProduct[],
  opts?: { asOf?: string | null; projectionYear?: number },
): { totalGrossWon: number | null; incomplete: boolean; byProduct: DepositInterestResult[] } {
  const byProduct = products.map((p) => calculateDepositInterest(p, opts));
  let incompleteFlag = false;
  let sum = 0;
  for (const r of byProduct) {
    if (r.status === "incomplete") {
      incompleteFlag = true;
      continue;
    }
    sum += r.grossInterestWon ?? 0;
  }
  return {
    totalGrossWon: incompleteFlag && byProduct.every((r) => r.status === "incomplete") ? null : sum,
    incomplete: incompleteFlag,
    byProduct,
  };
}
