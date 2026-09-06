/**
 * 현금흐름 입력 주기(월별/분기별/반기별/연도별).
 * 기간 값은 해당 구간의 합계이며 월 환산하지 않는다.
 */

export type CashflowPeriodType = "monthly" | "quarterly" | "semiAnnual" | "yearly";

export const CASHFLOW_PERIOD_TYPE_OPTIONS: Array<{
  id: CashflowPeriodType;
  label: string;
}> = [
  { id: "monthly", label: "월별" },
  { id: "quarterly", label: "분기별" },
  { id: "semiAnnual", label: "반기별" },
  { id: "yearly", label: "연도별" },
];

export const CASHFLOW_PERIOD_TYPE_META_PREFIX = "periodType:";

export function isCashflowPeriodType(value: unknown): value is CashflowPeriodType {
  return value === "monthly" || value === "quarterly" || value === "semiAnnual" || value === "yearly";
}

/** CashFlow.accountType 등에 심어 둔 주기 메타에서 복원 */
export function parseCashflowPeriodTypeMeta(raw: string | null | undefined): CashflowPeriodType | null {
  const value = String(raw ?? "");
  const match = value.match(/periodType:(monthly|quarterly|semiAnnual|yearly)/);
  return match ? (match[1] as CashflowPeriodType) : null;
}

export function cashflowPeriodTypeMeta(periodType: CashflowPeriodType): string {
  return `${CASHFLOW_PERIOD_TYPE_META_PREFIX}${periodType}`;
}

/**
 * 저장용 기간 키 정규화.
 * monthly: 2026-09 / quarterly: 2026-Q3 / semiAnnual: 2026-H1|H2 / yearly: 2026
 */
export function normalizeCashflowPeriodKey(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  const quarterly = value.match(/^(20\d{2})-?Q([1-4])$/i) || value.match(/^(20\d{2})년\s*([1-4])분기$/);
  if (quarterly) return `${quarterly[1]}-Q${quarterly[2]}`;

  const half =
    value.match(/^(20\d{2})-?H([12])$/i) ||
    value.match(/^(20\d{2})년\s*(상반기|하반기)$/);
  if (half) {
    const part = half[2] === "상반기" ? "1" : half[2] === "하반기" ? "2" : half[2];
    return `${half[1]}-H${part}`;
  }

  const yearlyOnly = value.match(/^(20\d{2})$/) || value.match(/^(20\d{2})년$/);
  if (yearlyOnly) return yearlyOnly[1];

  const iso = value.match(/^(20\d{2})[./-](\d{1,2})(?:[./-]\d{1,2})?$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;

  const koreanMonth = value.match(/^(20\d{2})년\s*(\d{1,2})월$/);
  if (koreanMonth) return `${koreanMonth[1]}-${String(Number(koreanMonth[2])).padStart(2, "0")}`;

  return "";
}

export function detectCashflowPeriodTypeFromKey(period: string): CashflowPeriodType {
  const key = normalizeCashflowPeriodKey(period);
  if (/^20\d{2}-Q[1-4]$/.test(key)) return "quarterly";
  if (/^20\d{2}-H[12]$/.test(key)) return "semiAnnual";
  if (/^20\d{2}$/.test(key)) return "yearly";
  return "monthly";
}

/** 화면 표시용 기간 라벨 */
export function formatCashflowPeriodLabel(period: string, periodType?: CashflowPeriodType): string {
  const key = normalizeCashflowPeriodTypeAware(period, periodType);
  if (!key) return period;

  const type = periodType ?? detectCashflowPeriodTypeFromKey(key);
  if (type === "yearly" || /^20\d{2}$/.test(key)) {
    return `${key}년`;
  }
  if (type === "quarterly" || /-Q[1-4]$/.test(key)) {
    const [year, q] = key.split("-Q");
    return `${year}년 ${q}분기`;
  }
  if (type === "semiAnnual" || /-H[12]$/.test(key)) {
    const [year, h] = key.split("-H");
    return `${year}년 ${h === "1" ? "상반기" : "하반기"}`;
  }
  const [year, month] = key.split("-");
  return `${year}년 ${Number(month)}월`;
}

function normalizeCashflowPeriodTypeAware(period: string, periodType?: CashflowPeriodType): string {
  const key = normalizeCashflowPeriodKey(period);
  if (key) return key;
  if (periodType === "yearly" && /^(20\d{2})/.test(period)) return period.slice(0, 4);
  return "";
}

export function currentCashflowPeriodKey(periodType: CashflowPeriodType, now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (periodType === "yearly") return String(year);
  if (periodType === "semiAnnual") return `${year}-H${month <= 6 ? 1 : 2}`;
  if (periodType === "quarterly") return `${year}-Q${Math.ceil(month / 3)}`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function nextCashflowPeriodKey(period: string, periodType: CashflowPeriodType): string {
  const key = normalizeCashflowPeriodKey(period) || currentCashflowPeriodKey(periodType);
  if (periodType === "yearly") {
    return String(Number(key) + 1);
  }
  if (periodType === "semiAnnual") {
    const m = key.match(/^(20\d{2})-H([12])$/);
    if (!m) return currentCashflowPeriodKey(periodType);
    const year = Number(m[1]);
    const half = Number(m[2]);
    return half === 1 ? `${year}-H2` : `${year + 1}-H1`;
  }
  if (periodType === "quarterly") {
    const m = key.match(/^(20\d{2})-Q([1-4])$/);
    if (!m) return currentCashflowPeriodKey(periodType);
    const year = Number(m[1]);
    const q = Number(m[2]);
    return q < 4 ? `${year}-Q${q + 1}` : `${year + 1}-Q1`;
  }
  const m = key.match(/^(20\d{2})-(\d{2})$/);
  if (!m) return currentCashflowPeriodKey(periodType);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function compareCashflowPeriodKeys(a: string, b: string): number {
  return normalizeCashflowPeriodKey(a).localeCompare(normalizeCashflowPeriodKey(b));
}
