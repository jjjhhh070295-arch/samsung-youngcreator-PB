import type { CashFlow } from "./types";
import { CASHFLOW_TAX_KEYWORDS, NON_TAX_EXPENSE_PATTERN } from "./cashflowTaxRules";

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

export interface PeriodCashflowChartPoint extends PeriodCashflowPoint {
  incomeManwon: number;
  outflowManwon: number;
  nonTaxOutflowManwon: number;
  savingManwon: number;
  taxManwon: number;
  netManwon: number;
  incomePlotManwon: number;
  outflowPlotManwon: number;
  nonTaxOutflowPlotManwon: number;
  savingPlotManwon: number;
  taxPlotManwon: number;
  netPlotManwon: number;
}

export interface BuildPeriodCashflowSeriesOptions {
  includeMainTaxEvents?: boolean;
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

const findTaxColumn = (header: Row, fallback: number) => {
  const normalized = header.map(normalize);
  const strict = normalized.findIndex((cell) =>
    ["총세금", "세금납부", "납부세금", "tax"].some((alias) => cell.includes(normalize(alias))),
  );
  if (strict >= 0) return strict;

  const loose = normalized.findIndex((cell) =>
    ["세금", "납부"].some((alias) => cell.includes(normalize(alias))) && !cell.includes("제외"),
  );
  return loose >= 0 ? loose : fallback;
};

const shouldIncludeInApp = (raw: string) => {
  const normalized = normalize(raw);
  if (!normalized) return true;
  return !["n", "no", "false", "미반영", "제외", "아니오"].some((token) => normalized.includes(normalize(token)));
};

export function isPeriodCashFlow(flow: CashFlow) {
  return String(flow.category ?? "").startsWith(PERIOD_CASHFLOW_CATEGORY_PREFIX);
}

const emptyPoint = (period: string): PeriodCashflowPoint => ({
  period,
  incomeWon: 0,
  outflowWon: 0,
  savingWon: 0,
  taxWon: 0,
  netWon: 0,
  cumulativeNetWon: 0,
  memo: "",
});

const appendMemo = (point: PeriodCashflowPoint, memo?: string) => {
  const clean = String(memo ?? "").trim();
  if (!clean || point.memo.includes(clean)) return;
  point.memo = [point.memo, clean].filter(Boolean).join(" / ");
};

const formatManwon = (won: number) => `${Math.round(Math.abs(won) / 10_000).toLocaleString()}만원`;

const taxAliases = [
  { label: "증여세", aliases: ["증여세예상액", "예상증여세", "증여세", "증여세납부"] },
  { label: "상속세", aliases: ["상속세예상액", "예상상속세", "상속세", "상속세납부"] },
  { label: "법인세", aliases: ["법인세예상액", "예상법인세", "법인세"] },
  { label: "부동산 양도세", aliases: ["부동산양도세예상액", "부동산양도세", "부동산양도소득세", "양도세예상액"] },
  { label: "해외주식 양도세", aliases: ["해외주식양도세예상액", "해외주식양도세", "해외주식양도소득세"] },
  { label: "종합부동산세", aliases: ["종합부동산세", "종부세"] },
  { label: "재산세", aliases: ["재산세"] },
  { label: "종합소득세", aliases: ["종합소득세", "지방소득세", "건강보험정산"] },
  { label: "부가세", aliases: ["부가세", "부가가치세"] },
  { label: "자동차세", aliases: ["자동차세"] },
];

const canonicalTaxLabel = (flow: CashFlow) => {
  const text = normalize(`${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""}`);
  return taxAliases.find((item) => item.aliases.some((alias) => text.includes(normalize(alias))))?.label;
};

const isMainTaxFlow = (flow: CashFlow) => {
  if (isPeriodCashFlow(flow) || flow.amount >= 0) return false;
  const label = normalize(flow.label);
  if (label.includes("증여실행") && label.includes("증여세")) return false;
  const category = normalize(String(flow.category ?? ""));
  return Boolean(canonicalTaxLabel(flow)) || category.includes("세금") || category.includes("tax");
};

const isTaxLikeOutflow = (flow: CashFlow) => {
  if (flow.amount >= 0) return false;
  const category = normalize(String(flow.category ?? ""));
  if (category.startsWith(normalize(PERIOD_CASHFLOW_CATEGORY_PREFIX)) && !category.includes("세금")) return false;
  const labelAndNote = `${flow.label} ${flow.taxAccountingNote ?? ""}`;
  if (NON_TAX_EXPENSE_PATTERN.test(labelAndNote)) return false;
  return Boolean(canonicalTaxLabel(flow)) || CASHFLOW_TAX_KEYWORDS.test(`${flow.category ?? ""} ${labelAndNote}`);
};

const addMonths = (period: string, offset: number) => {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

const monthsBetween = (start: string, end: string) => {
  const periods: string[] = [];
  let current = start;
  while (current <= end && periods.length < 24) {
    periods.push(current);
    current = addMonths(current, 1);
  }
  return periods;
};

const taxDedupeKeys = (label: string, period: string, amountWon: number) => {
  const amountKey = String(Math.round(Math.abs(amountWon)));
  return [`${normalize(label)}|${period}|${amountKey}`, `*|${period}|${amountKey}`];
};

export function extractPeriodCashFlows(rows: Row[], fileName = "기간별 현금흐름"): CashFlow[] {
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  const periodColumn = findColumn(header, ["기간", "월", "date", "period"], 0);
  const incomeColumn = findColumn(header, ["순유입", "유입", "수입", "소득", "income"], 1);
  const outflowColumn = findColumn(header, ["순유출", "유출", "지출", "비용", "expense", "outflow"], 2);
  const savingColumn = findColumn(header, ["저축", "투자", "saving", "investment"], -1);
  const taxColumn = findTaxColumn(header, -1);
  const memoColumn = findColumn(header, ["메모", "이벤트", "비고", "note"], -1);
  const appColumn = findColumn(header, ["앱반영", "app"], -1);
  const flows: CashFlow[] = [];
  const amountAt = (row: Row, column: number) => (column >= 0 ? parseAmountManwon(cellToText(row[column])) : 0);

  rows.slice(headerIndex + 1).forEach((row) => {
    const period = parsePeriod(cellToText(row[periodColumn]));
    if (!period) return;
    if (appColumn >= 0 && !shouldIncludeInApp(cellToText(row[appColumn]))) return;

    const memo = (memoColumn >= 0 ? cellToText(row[memoColumn]) : "") || fileName;
    const amounts = [
      { key: "유입", label: "기간별 유입", amount: amountAt(row, incomeColumn) },
      { key: "유출", label: "기간별 유출", amount: -amountAt(row, outflowColumn) },
      { key: "저축/투자", label: "기간별 저축/투자", amount: -amountAt(row, savingColumn) },
      { key: "세금", label: "기간별 세금납부", amount: -amountAt(row, taxColumn) },
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

export function buildPeriodCashflowSeries(
  cashFlows: CashFlow[],
  options: BuildPeriodCashflowSeriesOptions = {},
): PeriodCashflowPoint[] {
  const includeMainTaxEvents = options.includeMainTaxEvents ?? true;
  const periodFlows = cashFlows.filter(isPeriodCashFlow);
  const grouped = new Map<string, PeriodCashflowPoint>();
  const seenTax = new Set<string>();

  periodFlows.forEach((flow) => {
    const period = parsePeriod(flow.date);
    if (!period) return;
    const point = grouped.get(period) ?? emptyPoint(period);
    const category = String(flow.category ?? "");
    const amount = Math.abs(flow.amount);
    if (category.includes("유입")) point.incomeWon += amount;
    else if (category.includes("저축")) point.savingWon += amount;
    else if (category.includes("세금")) {
      point.taxWon += amount;
      taxDedupeKeys(flow.label, period, amount).forEach((key) => seenTax.add(key));
    }
    else point.outflowWon += amount;
    point.netWon += flow.amount;
    appendMemo(point, flow.taxAccountingNote);
    grouped.set(period, point);
  });

  if (includeMainTaxEvents) {
    cashFlows.filter(isMainTaxFlow).forEach((flow) => {
      const period = parsePeriod(flow.date);
      if (!period) return;
      const amount = Math.abs(flow.amount);
      const label = canonicalTaxLabel(flow) ?? flow.label ?? "세금";
      const keys = taxDedupeKeys(label, period, amount);
      if (keys.some((key) => seenTax.has(key))) return;

      const point = grouped.get(period) ?? emptyPoint(period);
      point.taxWon += amount;
      point.netWon += flow.amount;
      appendMemo(point, `${label} ${formatManwon(amount)}`);
      appendMemo(point, flow.taxAccountingNote);
      keys.forEach((key) => seenTax.add(key));
      grouped.set(period, point);
    });
  }

  let cumulative = 0;
  return Array.from(grouped.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((point) => {
      cumulative += point.netWon;
      return { ...point, cumulativeNetWon: cumulative };
    });
}

export function buildMonthlyCashflowSummarySeries(cashFlows: CashFlow[], monthCount = 12): PeriodCashflowPoint[] {
  const datedPeriods = cashFlows.map((flow) => parsePeriod(flow.date)).filter(Boolean);
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const start = datedPeriods.length ? datedPeriods.sort()[0] : currentPeriod;
  const lastDated = datedPeriods.length ? datedPeriods.sort()[datedPeriods.length - 1] : start;
  const end = [lastDated, addMonths(start, monthCount - 1)].sort().at(-1) ?? addMonths(start, monthCount - 1);
  const periods = monthsBetween(start, end);
  const grouped = new Map<string, PeriodCashflowPoint>();

  periods.forEach((period) => grouped.set(period, emptyPoint(period)));

  const applyFlow = (period: string, flow: CashFlow) => {
    const point = grouped.get(period) ?? emptyPoint(period);
    const amount = Number(flow.amount || 0);
    const abs = Math.abs(amount);
    const category = String(flow.category ?? "");

    if (amount > 0) point.incomeWon += amount;
    else if (category.includes("세금") || isTaxLikeOutflow(flow)) point.taxWon += abs;
    else point.outflowWon += abs;

    point.netWon = point.incomeWon - point.outflowWon - point.taxWon;
    appendMemo(point, flow.taxAccountingNote);
    grouped.set(period, point);
  };

  cashFlows.forEach((flow) => {
    const period = parsePeriod(flow.date) || start;
    if (flow.recurring) {
      periods.forEach((targetPeriod) => {
        if (targetPeriod >= period) applyFlow(targetPeriod, flow);
      });
      return;
    }
    if (!grouped.has(period)) grouped.set(period, emptyPoint(period));
    applyFlow(period, flow);
  });

  let cumulative = 0;
  return Array.from(grouped.values())
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((point) => {
      cumulative += point.netWon;
      return { ...point, cumulativeNetWon: cumulative };
    });
}

export function toPeriodCashflowChartData(series: PeriodCashflowPoint[]): PeriodCashflowChartPoint[] {
  return series.map((point) => ({
    ...point,
    incomeManwon: Math.round(point.incomeWon / 10_000),
    outflowManwon: Math.round(point.outflowWon / 10_000),
    nonTaxOutflowManwon: Math.round((point.outflowWon + point.savingWon) / 10_000),
    savingManwon: Math.round(point.savingWon / 10_000),
    taxManwon: Math.round(point.taxWon / 10_000),
    netManwon: Math.round(point.netWon / 10_000),
    incomePlotManwon: Math.round(Math.abs(point.incomeWon) / 10_000),
    outflowPlotManwon: Math.round(Math.abs(point.outflowWon) / 10_000),
    nonTaxOutflowPlotManwon: Math.round(Math.abs(point.outflowWon + point.savingWon) / 10_000),
    savingPlotManwon: Math.round(Math.abs(point.savingWon) / 10_000),
    taxPlotManwon: Math.round(Math.abs(point.taxWon) / 10_000),
    netPlotManwon: Math.round(point.netWon / 10_000),
  }));
}

export function hasPeriodCashflowData(cashFlows: CashFlow[]) {
  return buildPeriodCashflowSeries(cashFlows).length >= 2;
}
