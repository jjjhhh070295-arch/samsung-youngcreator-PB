import type { CashFlow } from "./types";

export interface PeriodCashflowPoint {
  period: string;
  incomeWon: number;
  outflowWon: number;
  savingWon: number;
  taxWon: number;
  netWon: number;
  cumulativeNetWon: number;
  memo: string;
}

export const PERIOD_CASHFLOW_CATEGORY_PREFIX = "기간별현금흐름";

type Row = string[];

const normalize = (value: string) =>
  String(value ?? "").toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}·.,:/_%\-]/g, "");

const uid = (prefix: string, label: string) =>
  `${prefix}-${normalize(label).slice(0, 12)}-${Math.random().toString(36).slice(2, 7)}`;

const parseAmountManwon = (raw: string) => {
  const compact = raw.replace(/,/g, "").trim();
  const match = compact.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return 0;
  const unitText = compact.slice((match.index ?? 0) + match[0].length).trim();
  if (unitText.startsWith("억")) return value * 10000 * 10000;
  if (unitText.startsWith("만원") || /^만(?![가-힣])/.test(unitText)) return value * 10000;
  if (unitText.startsWith("원")) return value;
  return value * 10000;
};

const cellToText = (value: unknown) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "").trim();
};

const parsePeriod = (raw: string) => {
  const value = raw.trim();
  const iso = value.match(/(20\d{2})[./-](\d{1,2})(?:[./-]\d{1,2})?/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  const korean = value.match(/(20\d{2})년\s*(\d{1,2})월/);
  if (korean) return `${korean[1]}-${String(Number(korean[2])).padStart(2, "0")}`;
  return "";
};

const findHeaderIndex = (rows: Row[]) =>
  rows.findIndex((row) => {
    const cells = row.map(normalize);
    return cells.some((cell) => /기간|월|date/.test(cell)) && cells.some((cell) => /유입|수입|소득|income/.test(cell));
  });

const findColumn = (header: Row, aliases: string[], fallback: number) => {
  const found = header.map(normalize).findIndex((cell) => aliases.some((alias) => cell.includes(normalize(alias))));
  return found >= 0 ? found : fallback;
};

const shouldIncludeInApp = (raw: string) => {
  const normalized = normalize(raw);
  if (!normalized) return true;
  return !["n", "no", "false", "미반영", "제외", "아니오"].some((token) => normalized.includes(normalize(token)));
};

export function isPeriodCashFlow(flow: CashFlow) {
  return String(flow.category ?? "").startsWith(PERIOD_CASHFLOW_CATEGORY_PREFIX);
}

export function extractPeriodCashFlows(rows: Row[], fileName = "기간별 현금흐름"): CashFlow[] {
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  const periodColumn = findColumn(header, ["기간", "월", "date", "period"], 0);
  const incomeColumn = findColumn(header, ["유입", "수입", "소득", "income"], 1);
  const outflowColumn = findColumn(header, ["유출", "지출", "비용", "expense", "outflow"], 2);
  const savingColumn = findColumn(header, ["저축", "투자", "saving", "investment"], 3);
  const taxColumn = findColumn(header, ["세금", "납부", "tax"], 4);
  const memoColumn = findColumn(header, ["메모", "이벤트", "비고", "note"], 7);
  const appColumn = findColumn(header, ["앱반영", "app"], 8);
  const flows: CashFlow[] = [];

  rows.slice(headerIndex + 1).forEach((row) => {
    const period = parsePeriod(cellToText(row[periodColumn]));
    if (!period) return;
    if (!shouldIncludeInApp(cellToText(row[appColumn]))) return;

    const memo = cellToText(row[memoColumn]) || fileName;
    const amounts = [
      { key: "유입", label: "기간별 유입", amount: parseAmountManwon(cellToText(row[incomeColumn])) },
      { key: "유출", label: "기간별 유출", amount: -parseAmountManwon(cellToText(row[outflowColumn])) },
      { key: "저축/투자", label: "기간별 저축/투자", amount: -parseAmountManwon(cellToText(row[savingColumn])) },
      { key: "세금", label: "기간별 세금납부", amount: -parseAmountManwon(cellToText(row[taxColumn])) },
    ];

    amounts.forEach((item) => {
      if (!item.amount) return;
      flows.push({
        id: uid("period", `${period}-${item.key}`),
        label: item.label,
        amount: item.amount,
        date: period,
        recurring: false,
        category: `${PERIOD_CASHFLOW_CATEGORY_PREFIX}:${item.key}`,
        taxAccountingNote: memo,
      });
    });
  });

  return flows;
}

export function buildPeriodCashflowSeries(cashFlows: CashFlow[]): PeriodCashflowPoint[] {
  const periodFlows = cashFlows.filter(isPeriodCashFlow);
  const grouped = new Map<string, PeriodCashflowPoint>();

  periodFlows.forEach((flow) => {
    const period = parsePeriod(flow.date);
    if (!period) return;
    const point =
      grouped.get(period) ??
      {
        period,
        incomeWon: 0,
        outflowWon: 0,
        savingWon: 0,
        taxWon: 0,
        netWon: 0,
        cumulativeNetWon: 0,
        memo: "",
      };
    const category = String(flow.category ?? "");
    const amount = Math.abs(flow.amount);
    if (category.includes("유입")) point.incomeWon += amount;
    else if (category.includes("저축")) point.savingWon += amount;
    else if (category.includes("세금")) point.taxWon += amount;
    else point.outflowWon += amount;
    point.netWon += flow.amount;
    if (flow.taxAccountingNote && !point.memo.includes(flow.taxAccountingNote)) {
      point.memo = [point.memo, flow.taxAccountingNote].filter(Boolean).join(" / ");
    }
    grouped.set(period, point);
  });

  let cumulative = 0;
  return Array.from(grouped.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((point) => {
      cumulative += point.netWon;
      return { ...point, cumulativeNetWon: cumulative };
    });
}

export function hasPeriodCashflowData(cashFlows: CashFlow[]) {
  return buildPeriodCashflowSeries(cashFlows).length >= 2;
}
