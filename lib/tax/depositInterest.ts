/**
 * 예·적금 이자 산출 — 단리 만기예금 / 적금 회차별 실제 예치기간.
 */

import {
  interestWithholdingParts,
  roundWon,
} from "./koreanResidentTax2026";

export type DepositProductType = "deposit" | "installment";
export type DepositInterestConvention = "simple" | "compound_annual";
export type DepositTaxStatus = "taxable" | "exempt" | "preferential" | "unknown";
export type DepositContributionFrequency = "monthly" | "weekly" | "once";

export interface DepositProduct {
  id: string;
  institution: string;
  productName: string;
  productType: DepositProductType;
  currency: string;
  /** 현재 원금/잔액. null = 미입력(0과 구분) */
  principalWon: number | null;
  /** 약정 연이율 %. null = 미입력 */
  annualRatePct: number | null;
  openedAt: string | null;
  maturesAt: string | null;
  interestSchedule: string | null;
  convention: DepositInterestConvention;
  taxStatus: DepositTaxStatus;
  /** 적금 납입액 */
  contributionAmountWon?: number | null;
  contributionFrequency?: DepositContributionFrequency | null;
  /** 실제/계획 납입일 YYYY-MM-DD */
  contributionDates?: string[] | null;
  /** 운용 preview에 포함할지 */
  includeInManagedPreview: boolean;
  /** 이미 고객 현금/자산에 포함돼 이중계상 금지 */
  identifiedInCashBalance: boolean;
  source: string | null;
  asOf: string | null;
}

export interface DepositInterestResult {
  productId: string;
  status: "ok" | "incomplete" | "exempt";
  grossInterestWon: number | null;
  withholdingNationalWon: number | null;
  withholdingLocalWon: number | null;
  withholdingTotalWon: number | null;
  /** 귀속 연도 → 과세대상 이자 */
  byTaxYear: Record<string, number>;
  notes: string[];
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yearFraction(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  // 동일 월·일 기념일(만기 1년)은 정수 연수로 처리 — 100m×3%×1년 = 정확히 3m
  if (
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate() &&
    to.getFullYear() !== from.getFullYear()
  ) {
    return to.getFullYear() - from.getFullYear();
  }
  // ACT/365 (상담용 단순일수)
  return ms / (365 * 24 * 3600 * 1000);
}

function allocateByCalendarYears(
  gross: number,
  start: Date,
  end: Date,
): Record<string, number> {
  if (gross <= 0 || end <= start) return {};
  const out: Record<string, number> = {};
  let cursor = new Date(start);
  let remaining = gross;
  while (cursor < end && remaining > 0) {
    const year = cursor.getFullYear();
    const yearEnd = new Date(`${year}-12-31T23:59:59`);
    const sliceEnd = yearEnd < end ? yearEnd : end;
    const frac = yearFraction(cursor, sliceEnd);
    const totalFrac = yearFraction(start, end) || 1;
    const portion = roundWon(gross * (frac / totalFrac));
    out[String(year)] = (out[String(year)] ?? 0) + portion;
    remaining -= portion;
    cursor = new Date(sliceEnd.getTime() + 1000);
  }
  if (remaining !== 0) {
    const y = String(end.getFullYear());
    out[y] = (out[y] ?? 0) + remaining;
  }
  return out;
}

/** 만기예금 단리: 원금 × 연이율 × 해당 기간 연환산 */
export function termDepositSimpleInterest(input: {
  principalWon: number;
  annualRatePct: number;
  openedAt: string;
  maturesAt: string;
  asOf?: string | null;
}): { grossInterestWon: number; byTaxYear: Record<string, number> } {
  const start = parseDate(input.openedAt)!;
  const maturity = parseDate(input.maturesAt)!;
  const asOf = parseDate(input.asOf ?? null);
  const end = asOf && asOf < maturity ? asOf : maturity;
  const frac = yearFraction(start, end);
  const grossInterestWon = roundWon(input.principalWon * (input.annualRatePct / 100) * frac);
  return {
    grossInterestWon,
    byTaxYear: allocateByCalendarYears(grossInterestWon, start, end),
  };
}

/**
 * 적금: 각 납입분의 실제 예치기간만 이자를 붙인다.
 * 만기 원금 전체에 연이율을 적용하지 않는다.
 */
export function installmentSavingsInterest(input: {
  contributionAmountWon: number;
  annualRatePct: number;
  contributionDates: string[];
  maturesAt: string;
  asOf?: string | null;
}): { grossInterestWon: number; byTaxYear: Record<string, number> } {
  const maturity = parseDate(input.maturesAt)!;
  const asOf = parseDate(input.asOf ?? null);
  const end = asOf && asOf < maturity ? asOf : maturity;
  let gross = 0;
  const byTaxYear: Record<string, number> = {};
  for (const raw of input.contributionDates) {
    const start = parseDate(raw);
    if (!start || start >= end) continue;
    const frac = yearFraction(start, end);
    const part = roundWon(input.contributionAmountWon * (input.annualRatePct / 100) * frac);
    gross += part;
    const alloc = allocateByCalendarYears(part, start, end);
    for (const [y, v] of Object.entries(alloc)) {
      byTaxYear[y] = (byTaxYear[y] ?? 0) + v;
    }
  }
  return { grossInterestWon: gross, byTaxYear };
}

export function calculateDepositInterest(
  product: DepositProduct,
  opts?: { asOf?: string | null; projectionYear?: number },
): DepositInterestResult {
  const notes: string[] = [];
  if (product.taxStatus === "exempt") {
    return {
      productId: product.id,
      status: "exempt",
      grossInterestWon: 0,
      withholdingNationalWon: 0,
      withholdingLocalWon: 0,
      withholdingTotalWon: 0,
      byTaxYear: {},
      notes: ["비과세 상품 — 원천징수 0 (증빙 필요)"],
    };
  }
  if (product.principalWon == null || product.annualRatePct == null) {
    return {
      productId: product.id,
      status: "incomplete",
      grossInterestWon: null,
      withholdingNationalWon: null,
      withholdingLocalWon: null,
      withholdingTotalWon: null,
      byTaxYear: {},
      notes: ["원금 또는 약정이율이 없어 이자를 산출하지 않았습니다."],
    };
  }
  if (product.principalWon < 0 || product.annualRatePct < 0) {
    return {
      productId: product.id,
      status: "incomplete",
      grossInterestWon: null,
      withholdingNationalWon: null,
      withholdingLocalWon: null,
      withholdingTotalWon: null,
      byTaxYear: {},
      notes: ["원금·이율은 0 이상이어야 합니다."],
    };
  }

  const asOf = opts?.asOf ?? product.asOf;
  let grossInterestWon = 0;
  let byTaxYear: Record<string, number> = {};

  if (product.productType === "deposit") {
    if (!product.openedAt || !product.maturesAt) {
      return {
        productId: product.id,
        status: "incomplete",
        grossInterestWon: null,
        withholdingNationalWon: null,
        withholdingLocalWon: null,
        withholdingTotalWon: null,
        byTaxYear: {},
        notes: ["예금 개시일·만기일이 필요합니다."],
      };
    }
    if (product.convention === "compound_annual") {
      notes.push("복리 약정은 연복리 근사로 계산합니다.");
      const start = parseDate(product.openedAt)!;
      const maturity = parseDate(product.maturesAt)!;
      const endDate = parseDate(asOf) && parseDate(asOf)! < maturity ? parseDate(asOf)! : maturity;
      const years = yearFraction(start, endDate);
      grossInterestWon = roundWon(
        product.principalWon * (Math.pow(1 + product.annualRatePct / 100, years) - 1),
      );
      byTaxYear = allocateByCalendarYears(grossInterestWon, start, endDate);
    } else {
      const r = termDepositSimpleInterest({
        principalWon: product.principalWon,
        annualRatePct: product.annualRatePct,
        openedAt: product.openedAt,
        maturesAt: product.maturesAt,
        asOf,
      });
      grossInterestWon = r.grossInterestWon;
      byTaxYear = r.byTaxYear;
    }
  } else {
    const dates = product.contributionDates?.filter(Boolean) ?? [];
    const contrib = product.contributionAmountWon;
    if (contrib == null || !product.maturesAt || dates.length === 0) {
      return {
        productId: product.id,
        status: "incomplete",
        grossInterestWon: null,
        withholdingNationalWon: null,
        withholdingLocalWon: null,
        withholdingTotalWon: null,
        byTaxYear: {},
        notes: ["적금은 납입액·납입일·만기일이 필요합니다."],
      };
    }
    const r = installmentSavingsInterest({
      contributionAmountWon: contrib,
      annualRatePct: product.annualRatePct,
      contributionDates: dates,
      maturesAt: product.maturesAt,
      asOf,
    });
    grossInterestWon = r.grossInterestWon;
    byTaxYear = r.byTaxYear;
  }

  if (product.taxStatus === "unknown") {
    notes.push("과세 여부 미확인 — 원천징수는 표시용 참고치입니다.");
  }
  if (product.taxStatus === "preferential") {
    notes.push("우대·분리과세 상품 — 표준 15.4%를 적용하지 않았을 수 있습니다. 확인 필요.");
  }

  const wh =
    product.taxStatus === "taxable" || product.taxStatus === "unknown"
      ? interestWithholdingParts(grossInterestWon)
      : { nationalWon: 0, localWon: 0, totalWon: 0 };

  if (opts?.projectionYear != null) {
    const y = String(opts.projectionYear);
    const yearGross = byTaxYear[y] ?? 0;
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
  };
}

export function sumDepositBalances(products: DepositProduct[]): {
  totalPrincipalWon: number | null;
  incomplete: boolean;
} {
  let sum = 0;
  let incomplete = false;
  for (const p of products) {
    if (p.principalWon == null) {
      incomplete = true;
      continue;
    }
    sum += p.principalWon;
  }
  return { totalPrincipalWon: products.length === 0 ? 0 : sum, incomplete };
}
