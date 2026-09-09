/**
 * 예·적금 만기(연수) — 타임존 안전 달력 연산.
 * YYYY-MM-DD 를 UTC 시각이 아닌 그레고리력 연·월·일로만 다룬다.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCivilDate(iso: string | null | undefined): {
  y: number;
  m: number;
  d: number;
} | null {
  if (!iso) return null;
  const raw = iso.slice(0, 10);
  const m = ISO_DATE.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (daysInMonth(y, mo) < d) return null;
  return { y, m: mo, d };
}

export function formatCivilDate(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month1to12: number): number {
  // month1to12: 1=Jan … 12=Dec. day 0 of next month = last day of this month.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** openedAt + termYears → maturesAt (윤일·말일 클램프) */
export function addCalendarYears(isoDate: string, years: number): string | null {
  const base = parseCivilDate(isoDate);
  if (!base || !Number.isInteger(years) || years < 0) return null;
  const y = base.y + years;
  const dim = daysInMonth(y, base.m);
  const d = Math.min(base.d, dim);
  return formatCivilDate(y, base.m, d);
}

export type TermDerivation =
  | { status: "exact"; termYears: number }
  | { status: "ambiguous"; termYears: null }
  | { status: "missing"; termYears: null };

/**
 * 개시일·만기일이 정수 연수 기념일이면 termYears 를 도출.
 * 그 외(비정수·불일치)는 ambiguous — 기존 만기일 유지.
 */
export function deriveWholeYearTerm(
  openedAt: string | null | undefined,
  maturesAt: string | null | undefined,
): TermDerivation {
  const open = parseCivilDate(openedAt);
  const mat = parseCivilDate(maturesAt);
  if (!open || !mat) return { status: "missing", termYears: null };
  const years = mat.y - open.y;
  if (years < 1 || years > 100) return { status: "ambiguous", termYears: null };
  const expected = addCalendarYears(formatCivilDate(open.y, open.m, open.d), years);
  if (expected === formatCivilDate(mat.y, mat.m, mat.d)) {
    return { status: "exact", termYears: years };
  }
  return { status: "ambiguous", termYears: null };
}

export function resolveMaturesAt(product: {
  openedAt: string | null;
  termYears?: number | null;
  maturesAt: string | null;
}): { maturesAt: string | null; termYears: number | null; legacyMaturityNeedsReview: boolean } {
  if (product.termYears != null && Number.isInteger(product.termYears) && product.termYears >= 1) {
    const computed =
      product.openedAt != null ? addCalendarYears(product.openedAt, product.termYears) : null;
    return {
      maturesAt: computed,
      termYears: product.termYears,
      legacyMaturityNeedsReview: false,
    };
  }
  const derived = deriveWholeYearTerm(product.openedAt, product.maturesAt);
  if (derived.status === "exact") {
    return {
      maturesAt: product.maturesAt,
      termYears: derived.termYears,
      legacyMaturityNeedsReview: false,
    };
  }
  if (product.maturesAt) {
    return {
      maturesAt: product.maturesAt,
      termYears: null,
      legacyMaturityNeedsReview: true,
    };
  }
  return { maturesAt: null, termYears: null, legacyMaturityNeedsReview: false };
}

/** 개시일 기념일(또는 말일 클램프)부터 만기 직전까지의 미래 월납 일정 */
export function futureMonthlyContributionDates(input: {
  openedAt: string;
  maturesAt: string;
  asOf: string;
}): string[] {
  const open = parseCivilDate(input.openedAt);
  const mat = parseCivilDate(input.maturesAt);
  const asOf = parseCivilDate(input.asOf);
  if (!open || !mat || !asOf) return [];
  const out: string[] = [];
  // 개시월의 납입일부터 매월, asOf 이후·만기 이전만
  let y = open.y;
  let m = open.m;
  const payDay = open.d;
  // 최대 120회 안전장치
  for (let i = 0; i < 120; i++) {
    const dim = daysInMonth(y, m);
    const d = Math.min(payDay, dim);
    const iso = formatCivilDate(y, m, d);
    const civil = { y, m, d };
    if (compareCivil(civil, mat) >= 0) break;
    if (compareCivil(civil, asOf) > 0) out.push(iso);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function compareCivil(
  a: { y: number; m: number; d: number },
  b: { y: number; m: number; d: number },
): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

export function displayDepositLabel(
  productType: "deposit" | "installment",
  indexAmongType1Based: number,
): string {
  const base = productType === "installment" ? "적금" : "예금";
  return `${base} ${indexAmongType1Based}`;
}
