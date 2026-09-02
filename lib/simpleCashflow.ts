import type { CashFlow } from "./types";
import {
  PERIOD_CASHFLOW_CATEGORY_PREFIX,
  buildPeriodCashflowSeries,
  buildMonthlyCashflowSummarySeries,
  isPeriodCashFlow,
} from "./periodCashflow";

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
export function simpleRowsToCashFlows(rows: SimpleCashflowRow[], existing: CashFlow[]): CashFlow[] {
  const legacy = existing.filter((flow) => !isPeriodCashFlow(flow));
  const nextPeriodFlows: CashFlow[] = [];

  rows.forEach((row) => {
    const period = row.period.trim();
    if (!period) return;

    if (row.netInflow > 0) {
      nextPeriodFlows.push({
        id: uid("in"),
        label: "월별 순유입",
        amount: row.netInflow,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:유입`,
      });
    }
    if (row.netOutflowExTax > 0) {
      nextPeriodFlows.push({
        id: uid("out"),
        label: "월별 순유출",
        amount: -row.netOutflowExTax,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:유출`,
      });
    }
    if (row.totalTax > 0) {
      nextPeriodFlows.push({
        id: uid("tax"),
        label: "월별 총세금",
        amount: -row.totalTax,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:세금`,
      });
    }
  });

  return [...legacy, ...nextPeriodFlows];
}

export function nextSimpleCashflowPeriod(rows: SimpleCashflowRow[]): string {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (rows.length === 0) return fallback;

  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted[sorted.length - 1]?.period ?? fallback;
  const [year, month] = last.split("-").map(Number);
  const date = new Date(year, (month || 1), 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function rowsToPeriodSeries(rows: SimpleCashflowRow[]) {
  let cumulative = 0;
  return [...rows]
    .sort((a, b) => a.period.localeCompare(b.period))
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
