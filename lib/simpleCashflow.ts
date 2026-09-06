import type { CashFlow } from "./types";
import {
  PERIOD_CASHFLOW_CATEGORY_PREFIX,
  buildPeriodCashflowSeries,
  buildMonthlyCashflowSummarySeries,
  isPeriodCashFlow,
} from "./periodCashflow";
import {
  cashflowPeriodTypeMeta,
  compareCashflowPeriodKeys,
  currentCashflowPeriodKey,
  detectCashflowPeriodTypeFromKey,
  nextCashflowPeriodKey,
  normalizeCashflowPeriodKey,
  parseCashflowPeriodTypeMeta,
  type CashflowPeriodType,
} from "./cashflowPeriod";

export interface SimpleCashflowRow {
  id: string;
  period: string;
  netInflow: number;
  netOutflowExTax: number;
  totalTax: number;
}

export interface SimpleCashflowTotals {
  netInflow: number;
  netOutflowExTax: number;
  totalTax: number;
  netCash: number;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** 순자금 = 총유입 - 총유출(세금 제외) - 총세금 */
export function calcSimpleNetCash(row: Pick<SimpleCashflowRow, "netInflow" | "netOutflowExTax" | "totalTax">) {
  return row.netInflow - row.netOutflowExTax - row.totalTax;
}

export function summarizeSimpleCashflowRows(rows: SimpleCashflowRow[]): SimpleCashflowTotals {
  return rows.reduce(
    (acc, row) => ({
      netInflow: acc.netInflow + row.netInflow,
      netOutflowExTax: acc.netOutflowExTax + row.netOutflowExTax,
      totalTax: acc.totalTax + row.totalTax,
      netCash: acc.netCash + calcSimpleNetCash(row),
    }),
    { netInflow: 0, netOutflowExTax: 0, totalTax: 0, netCash: 0 },
  );
}

export function inferCashflowPeriodType(cashFlows: CashFlow[]): CashflowPeriodType {
  for (const flow of cashFlows) {
    if (!isPeriodCashFlow(flow)) continue;
    const fromMeta = parseCashflowPeriodTypeMeta(flow.accountType);
    if (fromMeta) return fromMeta;
  }
  for (const flow of cashFlows) {
    if (!isPeriodCashFlow(flow)) continue;
    const key = normalizeCashflowPeriodKey(flow.date);
    if (key) return detectCashflowPeriodTypeFromKey(key);
  }
  return "monthly";
}

/** Load simplified rows from period cashflows or legacy detailed cashflows. */
export function loadSimpleCashflowRows(cashFlows: CashFlow[]): SimpleCashflowRow[] {
  const periodSeries = buildPeriodCashflowSeries(cashFlows, { includeMainTaxEvents: false });
  const source =
    periodSeries.length > 0
      ? periodSeries
      : buildMonthlyCashflowSummarySeries(cashFlows);

  return source.map((point) => ({
    id: `simple-${point.period}`,
    period: point.period,
    netInflow: point.incomeWon,
    netOutflowExTax: point.outflowWon + point.savingWon,
    totalTax: point.taxWon,
  }));
}

/** Persist simplified rows as period cashflows while keeping legacy detailed rows. */
export function simpleRowsToCashFlows(
  rows: SimpleCashflowRow[],
  existing: CashFlow[],
  periodType: CashflowPeriodType = "monthly",
): CashFlow[] {
  const legacy = existing.filter((flow) => !isPeriodCashFlow(flow));
  const nextPeriodFlows: CashFlow[] = [];
  const meta = cashflowPeriodTypeMeta(periodType);

  rows.forEach((row) => {
    const period = normalizeCashflowPeriodKey(row.period.trim()) || row.period.trim();
    if (!period) return;

    if (row.netInflow > 0) {
      nextPeriodFlows.push({
        id: uid("in"),
        label: "기간별 총유입",
        amount: row.netInflow,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:유입`,
        accountType: meta,
      });
    }
    if (row.netOutflowExTax > 0) {
      nextPeriodFlows.push({
        id: uid("out"),
        label: "기간별 총유출",
        amount: -row.netOutflowExTax,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:유출`,
        accountType: meta,
      });
    }
    if (row.totalTax > 0) {
      nextPeriodFlows.push({
        id: uid("tax"),
        label: "기간별 총세금",
        amount: -row.totalTax,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:세금`,
        accountType: meta,
      });
    }
  });

  return [...legacy, ...nextPeriodFlows];
}

export function nextSimpleCashflowPeriod(
  rows: SimpleCashflowRow[],
  periodType: CashflowPeriodType = "monthly",
): string {
  if (rows.length === 0) return currentCashflowPeriodKey(periodType);
  const sorted = [...rows].sort((a, b) => compareCashflowPeriodKeys(a.period, b.period));
  const last = sorted[sorted.length - 1]?.period;
  return nextCashflowPeriodKey(last || currentCashflowPeriodKey(periodType), periodType);
}

export function rowsToPeriodSeries(rows: SimpleCashflowRow[]) {
  let cumulative = 0;
  return [...rows]
    .sort((a, b) => compareCashflowPeriodKeys(a.period, b.period))
    .map((row) => {
      const netWon = calcSimpleNetCash(row);
      cumulative += netWon;
      return {
        period: row.period,
        incomeWon: row.netInflow,
        outflowWon: row.netOutflowExTax,
        savingWon: 0,
        taxWon: row.totalTax,
        netWon,
        cumulativeNetWon: cumulative,
        memo: "",
      };
    });
}
