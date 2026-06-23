import type { CashFlow } from "@/lib/types";

export type TaxDataSource = "cashflow" | "manual" | "inferred" | "estimated" | "ignored";

export type ScheduledTaxBucket =
  | "gift"
  | "inheritance"
  | "capitalGain"
  | "corporate"
  | "property"
  | "other";

export interface CashflowTaxItem {
  flowId: string;
  label: string;
  period: string;
  amountWon: number;
  bucket: ScheduledTaxBucket;
  dedupeKey: string;
  sourceText: string;
}

export interface CashflowFinancialIncomeItem {
  flowId: string;
  label: string;
  annualWon: number;
  interestWon: number;
  dividendWon: number;
  sourceText: string;
}

export interface CashflowTaxSummary {
  horizonYears: number;
  annualInterestIncomeWon: number;
  annualDividendIncomeWon: number;
  projectedInterestIncomeWon: number;
  projectedDividendIncomeWon: number;
  financialIncomeItems: CashflowFinancialIncomeItem[];
  scheduledTaxes: {
    byBucket: Record<ScheduledTaxBucket, number>;
    totalTaxWon: number;
    items: CashflowTaxItem[];
    ignoredDuplicates: CashflowTaxItem[];
  };
  entityHints: {
    corporateFlowPct: number;
    corporateFlowCount: number;
    corporateTaxFlowWon: number;
    isCorporateLikely: boolean;
    totalAbsFlowWon: number;
  };
  sources: string[];
}

const SCHEDULED_TAX_BUCKETS: ScheduledTaxBucket[] = [
  "gift",
  "inheritance",
  "capitalGain",
  "corporate",
  "property",
  "other",
];

const FINANCIAL_EXCLUDE_PATTERN =
  /급여|월급|근로|사업소득|사업수입|매출|임대|월세|용돈|대여|상환|loan|salary|wage|business|revenue|sales|rent/i;
const INTEREST_PATTERN = /이자|interest|mmf|rp|cma|채권|bond|예금|적금|금융소득|이자배당/i;
const DIVIDEND_PATTERN = /배당|dividend|distribution/i;
const TAX_PATTERN = /세|증여|상속|양도|법인세|종부|재산|tax|inheritance|gift/i;

function roundWon(value: number) {
  return Math.round(Number.isFinite(value) ? value : 0);
}

export function normalizeCashflowTaxText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()[\]{}·.,:/_%\-]/g, "");
}

function flowText(flow: CashFlow) {
  return `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""} ${flow.accountType ?? ""}`;
}

function parsePeriod(date: string) {
  const value = String(date ?? "").trim();
  const iso = value.match(/(20\d{2})[./-](\d{1,2})(?:[./-]\d{1,2})?/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  const korean = value.match(/(20\d{2})년\s*(\d{1,2})월/);
  if (korean) return `${korean[1]}-${String(Number(korean[2])).padStart(2, "0")}`;
  return value.length >= 7 ? value.slice(0, 7) : "date-unknown";
}

function isWithinHorizon(flow: CashFlow, horizonYears: number) {
  if (!flow.date) return true;
  const now = new Date();
  const horizonEnd = new Date(now);
  horizonEnd.setMonth(horizonEnd.getMonth() + Math.max(1, horizonYears) * 12);
  const normalized = flow.date.length === 7 ? `${flow.date}-01` : flow.date;
  const flowDate = new Date(normalized);
  if (Number.isNaN(flowDate.getTime())) return true;
  return flowDate >= now && flowDate <= horizonEnd;
}

export function annualizeRecurring(flow: CashFlow) {
  if (!flow.recurring || flow.amount <= 0) return 0;
  return roundWon(flow.amount * 12);
}

function classifyScheduledTaxBucket(flow: CashFlow): ScheduledTaxBucket | null {
  const label = normalizeCashflowTaxText(flow.label);
  const text = normalizeCashflowTaxText(flowText(flow));
  if ((label.includes("증여실행") || label.includes("giftamount")) && !/세|tax/.test(label)) return null;
  if (!TAX_PATTERN.test(flowText(flow))) return null;
  if (/증여세|gifttax|gift/.test(text)) return "gift";
  if (/상속세|inheritance/.test(text)) return "inheritance";
  if (/법인세|corporatetax|corporate/.test(text)) return "corporate";
  if (/양도세|양도소득|capitalgain|capitalgains|stocktax|주식양도|부동산양도/.test(text)) return "capitalGain";
  if (/재산세|종부세|종합부동산세|property|realestate/.test(text)) return "property";
  return /세|tax/.test(text) ? "other" : null;
}

function emptyBucketTotals(): Record<ScheduledTaxBucket, number> {
  return SCHEDULED_TAX_BUCKETS.reduce(
    (totals, bucket) => ({ ...totals, [bucket]: 0 }),
    {} as Record<ScheduledTaxBucket, number>,
  );
}

function scheduledTaxDedupeKey(item: Pick<CashflowTaxItem, "label" | "period" | "amountWon">) {
  return `${normalizeCashflowTaxText(item.label)}|${item.period}|${roundWon(Math.abs(item.amountWon))}`;
}

function financialIncomeSplit(flow: CashFlow) {
  const text = flowText(flow);
  if (FINANCIAL_EXCLUDE_PATTERN.test(text)) return null;
  const annualWon = annualizeRecurring(flow);
  if (annualWon <= 0) return null;
  const hasInterest = INTEREST_PATTERN.test(text);
  const hasDividend = DIVIDEND_PATTERN.test(text);
  if (!hasInterest && !hasDividend) return null;
  if (hasInterest && hasDividend) {
    return { annualWon, interestWon: annualWon / 2, dividendWon: annualWon / 2 };
  }
  return {
    annualWon,
    interestWon: hasInterest ? annualWon : 0,
    dividendWon: hasDividend ? annualWon : 0,
  };
}

export function summarizeCashflowsForTax(cashFlows: CashFlow[], horizonYears: number): CashflowTaxSummary {
  const years = Math.max(1, horizonYears || 1);
  const scheduledByBucket = emptyBucketTotals();
  const scheduledItems: CashflowTaxItem[] = [];
  const ignoredDuplicates: CashflowTaxItem[] = [];
  const seenScheduledTaxKeys = new Set<string>();
  const financialIncomeItems: CashflowFinancialIncomeItem[] = [];
  let annualInterestIncomeWon = 0;
  let annualDividendIncomeWon = 0;
  let totalAbsFlowWon = 0;
  let corporateAbsFlowWon = 0;
  let corporateFlowCount = 0;
  let corporateTaxFlowWon = 0;

  cashFlows.forEach((flow) => {
    const absAmount = Math.abs(flow.amount || 0);
    totalAbsFlowWon += absAmount;
    if (flow.entity === "corporate" || /법인|corporate/i.test(`${flow.accountType ?? ""} ${flow.category ?? ""} ${flow.label}`)) {
      corporateAbsFlowWon += absAmount;
      corporateFlowCount += 1;
    }

    const split = financialIncomeSplit(flow);
    if (split) {
      annualInterestIncomeWon += split.interestWon;
      annualDividendIncomeWon += split.dividendWon;
      financialIncomeItems.push({
        flowId: flow.id,
        label: flow.label,
        annualWon: roundWon(split.annualWon),
        interestWon: roundWon(split.interestWon),
        dividendWon: roundWon(split.dividendWon),
        sourceText: flowText(flow).trim(),
      });
    }

    if (flow.amount >= 0 || !isWithinHorizon(flow, years)) return;
    const bucket = classifyScheduledTaxBucket(flow);
    if (!bucket) return;

    const item: CashflowTaxItem = {
      flowId: flow.id,
      label: flow.label,
      period: parsePeriod(flow.date),
      amountWon: roundWon(absAmount),
      bucket,
      dedupeKey: "",
      sourceText: flowText(flow).trim(),
    };
    item.dedupeKey = scheduledTaxDedupeKey(item);

    if (seenScheduledTaxKeys.has(item.dedupeKey)) {
      ignoredDuplicates.push(item);
      return;
    }

    seenScheduledTaxKeys.add(item.dedupeKey);
    scheduledByBucket[bucket] += item.amountWon;
    if (bucket === "corporate") corporateTaxFlowWon += item.amountWon;
    scheduledItems.push(item);
  });

  const totalTaxWon = SCHEDULED_TAX_BUCKETS.reduce((sum, bucket) => sum + scheduledByBucket[bucket], 0);
  const corporateFlowPct = totalAbsFlowWon > 0 ? (corporateAbsFlowWon / totalAbsFlowWon) * 100 : 0;
  const isCorporateLikely = corporateTaxFlowWon > 0 || corporateFlowPct >= 50;
  const sources = [
    financialIncomeItems.length > 0
      ? `반복 현금흐름 ${financialIncomeItems.length}건에서 연간 이자·배당 소득을 집계했습니다.`
      : "반복 현금흐름에서 이자·배당 소득 항목을 찾지 못했습니다.",
    scheduledItems.length > 0
      ? `현금흐름 세금 일정 ${scheduledItems.length}건을 세목별로 반영했습니다.`
      : "현금흐름 내 확정 세금 일정이 없어 운용 세금만 추정합니다.",
    ...(ignoredDuplicates.length > 0
      ? [`중복 세금 일정 ${ignoredDuplicates.length}건은 dedupeKey 기준으로 제외했습니다.`]
      : []),
  ];

  return {
    horizonYears: years,
    annualInterestIncomeWon: roundWon(annualInterestIncomeWon),
    annualDividendIncomeWon: roundWon(annualDividendIncomeWon),
    projectedInterestIncomeWon: roundWon(annualInterestIncomeWon * years),
    projectedDividendIncomeWon: roundWon(annualDividendIncomeWon * years),
    financialIncomeItems,
    scheduledTaxes: {
      byBucket: Object.fromEntries(
        SCHEDULED_TAX_BUCKETS.map((bucket) => [bucket, roundWon(scheduledByBucket[bucket])]),
      ) as Record<ScheduledTaxBucket, number>,
      totalTaxWon: roundWon(totalTaxWon),
      items: scheduledItems,
      ignoredDuplicates,
    },
    entityHints: {
      corporateFlowPct: Math.round(corporateFlowPct * 10) / 10,
      corporateFlowCount,
      corporateTaxFlowWon: roundWon(corporateTaxFlowWon),
      isCorporateLikely,
      totalAbsFlowWon: roundWon(totalAbsFlowWon),
    },
    sources,
  };
}
