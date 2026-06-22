import type { CashFlow } from "./types";
import {
  scoreReadinessEvents,
  type ReadinessResult,
  type ReadinessStatus,
} from "./taxReadinessScoring";
import { extractPeriodCashFlows } from "./periodCashflow";

type Row = string[];
type TemplateEntry = {
  label: string;
  rawValue: string;
  explicitDue?: string;
  explicitCategory?: string;
  valueHint?: string;
  rawDirection?: string;
  rawEntity?: string;
  rawAccountType?: string;
  rawRecurring?: string;
  rawNote?: string;
  appIncluded?: string;
};

type KnownCategory =
  | "income"
  | "expense"
  | "saving"
  | "tax"
  | "debt"
  | "asset"
  | "schedule";

type ScheduleKey =
  | "businessYearEnd"
  | "corporateTax"
  | "realEstateSaleDate"
  | "realEstateTax"
  | "overseasStockSaleYear"
  | "overseasStockTax"
  | "giftDate"
  | "giftAmount"
  | "giftTax"
  | "inheritanceDate"
  | "inheritanceTax"
  | "ipoLockupEndDate"
  | "mnaClosingDate"
  | "exitReserve";

export interface TaxPaymentEvent {
  id: string;
  label: string;
  amountWon: number;
  dueDate: string;
  cashReadyDate: string;
  status: ReadinessStatus;
  readiness: ReadinessResult;
  rule: string;
}

type TaxPaymentEventInput = Omit<TaxPaymentEvent, "status" | "readiness">;

export interface CashflowUploadSummary {
  fileName: string;
  matchedRows: number;
  monthlyIncomeWon: number;
  monthlyOutflowWon: number;
  annualTaxWon: number;
  currentCashWon: number;
  nextTaxNeedWon: number;
  liquidityCoveragePct: number;
  nearestEvent?: TaxPaymentEvent;
}

export interface CashflowUploadResult {
  summary: CashflowUploadSummary;
  cashFlows: CashFlow[];
  taxEvents: TaxPaymentEvent[];
  unmatchedLabels: string[];
}

const now = () => new Date();
const pad = (value: number) => String(value).padStart(2, "0");
const toDateInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toMonthInput = (dateInput: string) => dateInput.slice(0, 7);
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addMonths = (date: Date, months: number) => {
  const targetMonth = date.getMonth() + months;
  const lastTargetDay = new Date(date.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastTargetDay));
};
const lastDayOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0);

const normalize = (value: string) =>
  String(value ?? "").toLowerCase().replace(/\s+/g, "").replace(/[()[\]{}·.,:/_%\-]/g, "");

const uid = (prefix: string, label: string) =>
  `${prefix}-${normalize(label).slice(0, 12)}-${Math.random().toString(36).slice(2, 7)}`;

const parseInputDate = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const parseDateLike = (raw: string) => {
  const value = raw.trim();
  const month = value.match(/(20\d{2})[./-](\d{1,2})$/);
  if (month) return toDateInput(new Date(Number(month[1]), Number(month[2]) - 1, 1));

  const iso = value.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso) return toDateInput(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const korean = value.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일?/);
  if (korean) {
    return toDateInput(new Date(Number(korean[1]), Number(korean[2]) - 1, Number(korean[3])));
  }

  const serial = Number(value);
  if (Number.isFinite(serial) && serial > 25000 && serial < 70000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + serial);
    return toDateInput(excelEpoch);
  }

  return undefined;
};

const parseYear = (raw: string) => {
  const match = raw.match(/20\d{2}/);
  return match ? Number(match[0]) : undefined;
};

const parseAmountManwon = (raw: string, headerHint = "") => {
  const compact = raw.replace(/,/g, "").trim();
  const match = compact.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;

  const value = Number(match[0]);
  if (!Number.isFinite(value)) return undefined;

  const header = normalize(headerHint);
  const unitText = compact.slice((match.index ?? 0) + match[0].length).trim();
  if (unitText.startsWith("억")) return value * 10000 * 10000;
  if (unitText.startsWith("만원") || /^만(?![가-힣])/.test(unitText)) return value * 10000;

  const looksLikeWon =
    unitText.startsWith("원") ||
    (header.includes("원") && !header.includes("만원") && !header.includes("만"));

  return looksLikeWon ? value : value * 10000;
};

const parseLikelyAmount = (raw: string, headerHint = "") => {
  const normalizedHeader = normalize(headerHint);
  const hasMoneyUnit = /-?\d+(?:\.\d+)?\s*(억|만원|만(?![가-힣])|원)/.test(raw);
  const isMoneyHeader = /값|금액|세액|자금|월저축|월적립|납입|평가|원금|적립액/.test(normalizedHeader);

  if (!hasMoneyUnit && !isMoneyHeader && (parseDateLike(raw) || /년|월|일|%/.test(raw))) {
    return undefined;
  }

  return parseAmountManwon(raw, headerHint);
};

export const cellToText = (value: unknown) => {
  if (value instanceof Date) return toDateInput(value);
  return String(value ?? "").trim();
};

export const parseCsvRows = (text: string) => {
  const rows: Row[] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === "," || char === "\t") && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};

const categoryAliases: Record<KnownCategory, string[]> = {
  income: ["월소득", "소득", "수입", "income"],
  expense: ["월지출", "지출", "소비", "연간이벤트", "연간지출", "expense"],
  saving: ["저축투자", "저축", "투자", "saving"],
  tax: ["세금", "tax"],
  debt: ["대출", "부채", "debt"],
  asset: ["자산", "현금", "asset"],
  schedule: ["세금일정", "일정", "납부", "schedule"],
};

const fieldAliases: Array<{ aliases: string[]; category: KnownCategory }> = [
  { aliases: ["근로소득", "월급", "월급여", "급여"], category: "income" },
  { aliases: ["상여및성과금", "상여", "성과금"], category: "income" },
  { aliases: ["사업소득", "사업수입", "사업소득기타소득"], category: "income" },
  { aliases: ["금융소득", "이자배당", "배당소득"], category: "income" },
  { aliases: ["월임대수입", "임대수입", "월세수입"], category: "income" },
  { aliases: ["부수입", "기타수입"], category: "income" },
  { aliases: ["월세전세이자", "월세대출", "관리비", "공과금", "보험료지출", "부모님용돈", "차량비", "통신비", "월고정지출", "생활비", "식비", "경조사비", "교통비", "운동및자기계발", "모임통장", "구독료", "휴가비용", "명절선물", "자동차보험", "기타계절성", "기타지출"], category: "expense" },
  { aliases: ["정기적금", "적금", "적금청년", "파킹통장", "주택청약", "적립식펀드", "적립식etf", "세제적격연금", "세제비적격연금", "보장성보험", "비상금", "isa", "국내주식", "해외주식", "연금저축", "irp", "cma"], category: "saving" },
  { aliases: ["재산세", "종부세", "종합소득세", "지방소득세", "건강보험정산", "자동차세", "기타세금"], category: "tax" },
  { aliases: ["대출잔액", "대출금리", "월원금상환"], category: "debt" },
  { aliases: ["현재현금성자산", "현금성자산", "현재현금"], category: "asset" },
];

const scheduleAliases: Array<{ key: ScheduleKey; aliases: string[] }> = [
  { key: "businessYearEnd", aliases: ["법인사업연도종료일", "사업연도종료일", "결산일"] },
  { key: "corporateTax", aliases: ["법인세예상액", "예상법인세"] },
  { key: "realEstateSaleDate", aliases: ["부동산매각일", "부동산양도일", "매각일"] },
  { key: "overseasStockSaleYear", aliases: ["해외주식매도연도", "해외주식양도연도"] },
  { key: "overseasStockTax", aliases: ["해외주식양도세예상액", "해외주식양도세"] },
  { key: "realEstateTax", aliases: ["부동산양도세예상액", "양도세예상액"] },
  { key: "giftDate", aliases: ["증여예정일", "증여일"] },
  { key: "giftAmount", aliases: ["증여실행금액", "증여금액"] },
  { key: "giftTax", aliases: ["증여세예상액", "예상증여세"] },
  { key: "inheritanceDate", aliases: ["상속개시일", "상속발생일", "피상속인사망일"] },
  { key: "inheritanceTax", aliases: ["상속세예상액", "예상상속세"] },
  { key: "ipoLockupEndDate", aliases: ["ipo보호예수해제일", "보호예수해제일", "락업해제일"] },
  { key: "mnaClosingDate", aliases: ["m&a클로징일", "mna클로징일", "회사매각일"] },
  { key: "exitReserve", aliases: ["엑싯현금화예비액", "보호예수현금화", "m&a예비액"] },
];

const findHeaderIndex = (rows: Row[]) =>
  rows.findIndex((row) => {
    const cells = row.map(normalize);
    return (
      cells.some((cell) => ["항목", "구분", "item", "name"].some((a) => cell.includes(a))) &&
      cells.some((cell) => ["값", "금액", "만원", "amount", "value"].some((a) => cell.includes(a)))
    );
  });

const findColumn = (header: Row, aliases: string[], fallback: number) => {
  const found = header.map(normalize).findIndex((cell) => aliases.some((a) => cell.includes(normalize(a))));
  return found >= 0 ? found : fallback;
};

const inferCategory = (label: string, explicitCategory: string) => {
  const normalizedCategory = normalize(explicitCategory);
  for (const [category, aliases] of Object.entries(categoryAliases) as Array<[KnownCategory, string[]]>) {
    if (aliases.some((alias) => normalizedCategory.includes(normalize(alias)))) return category;
  }

  const normalizedLabel = normalize(label);
  return fieldAliases.find((entry) =>
    entry.aliases.some((alias) => normalizedLabel.includes(normalize(alias))),
  )?.category;
};

const parseEntity = (raw: string): CashFlow["entity"] | undefined => {
  const normalized = normalize(raw);
  if (!normalized) return undefined;
  if (normalized.includes("개인사업") || normalized.includes("사업자")) return "sole_business";
  if (normalized.includes("혼용")) return "mixed";
  if (normalized.includes("법인")) return "corporate";
  if (normalized.includes("개인")) return "personal";
  return undefined;
};

const parseRecurring = (raw: string, fallback: boolean) => {
  const normalized = normalize(raw);
  if (!normalized) return fallback;
  if (/정기|월|매월|분기|연/.test(normalized)) return true;
  if (/일회|단발|비정기|1회/.test(normalized)) return false;
  return fallback;
};

const shouldIncludeInApp = (raw: string) => {
  const normalized = normalize(raw);
  if (!normalized) return true;
  return !["n", "no", "false", "미반영", "제외", "아니오"].some((token) => normalized.includes(normalize(token)));
};

const findScheduleKey = (label: string) => {
  const normalizedLabel = normalize(label);
  return scheduleAliases.find((entry) =>
    entry.aliases.some((alias) => normalizedLabel.includes(normalize(alias))),
  )?.key;
};

const upcomingDate = (monthIndex: number, day: number, from = now()) => {
  const target = new Date(from.getFullYear(), monthIndex, day);
  return target >= startOfDay(from) ? target : new Date(from.getFullYear() + 1, monthIndex, day);
};

const exitDateForDue = (due: Date, from = now()) => {
  const target = lastDayOfMonth(addMonths(due, -1));
  return toDateInput(target < startOfDay(from) && due >= startOfDay(from) ? from : target);
};

const sectionCategory = (row: Row): KnownCategory | undefined => {
  const text = normalize(row.join(" "));
  if (text.includes("월소득")) return "income";
  if (text.includes("지출내역") || text.includes("월지출")) return "expense";
  if (text.includes("저축내역") || text.includes("저축투자")) return "saving";
  return undefined;
};

const looksLikeLabel = (value: string) => {
  const normalized = normalize(value);
  if (!normalized || /^\d+$/.test(normalized)) return false;
  return !["항목", "값만원", "납부일", "분류", "월적립액", "총적립액", "예상세액만원"].some((token) =>
    normalized.includes(token),
  );
};

function extractTemplateEntries(rows: Row[], maxColumnExclusive?: number): TemplateEntry[] {
  const entries: TemplateEntry[] = [];
  let currentCategory: KnownCategory | undefined;
  let inTaxSchedule = false;

  rows.forEach((row, rowIndex) => {
    const maxColumn = maxColumnExclusive ?? row.length;
    const rowText = normalize(row.join(" "));
    if (rowText.includes("고액자산가세금납부") || row.map(normalize).some((cell) => cell.includes("세금이벤트"))) {
      inTaxSchedule = true;
      currentCategory = undefined;
      return;
    }
    if (inTaxSchedule) return;

    currentCategory = sectionCategory(row) ?? currentCategory;

    for (let index = 0; index < Math.min(row.length - 1, maxColumn); index += 1) {
      const label = cellToText(row[index]);
      const rawValue = cellToText(row[index + 1]);
      if (!looksLikeLabel(label) || !rawValue) continue;
      if (!findScheduleKey(label) && parseLikelyAmount(rawValue) === undefined) continue;

      entries.push({
        label,
        rawValue,
        explicitCategory: currentCategory,
      });
    }

    const savingLabel = cellToText(row[1]);
    const monthlySaving = cellToText(row[3]);
    if (currentCategory === "saving" && looksLikeLabel(savingLabel) && monthlySaving) {
      entries.push({
        label: savingLabel,
        rawValue: monthlySaving,
        explicitCategory: "saving",
        valueHint: "월 적립액",
      });
    }

    const productLabel = cellToText(row[1]) || cellToText(row[0]);
    const productMonthly = cellToText(row[4]);
    if (looksLikeLabel(productLabel) && productMonthly && parseLikelyAmount(productMonthly) !== undefined) {
      const header = normalize(rows[Math.max(0, rowIndex - 1)]?.join(" ") ?? "");
      if (header.includes("월저축액") || header.includes("월적립액") || header.includes("월납입액")) {
        entries.push({
          label: productLabel,
          rawValue: productMonthly,
          explicitCategory: "saving",
          valueHint: "월 적립액",
        });
      }
    }
  });

  return entries;
}

const dueFromTaxSchedule = (label: string, basisText: string, dueText: string) => {
  const normalized = normalize(label);
  const basisDate = parseInputDate(parseDateLike(basisText));
  const dueDate = parseDateLike(dueText);
  if (dueDate) return parseInputDate(dueDate);

  if (normalized.includes("종합소득세")) {
    const year = parseYear(basisText) ?? now().getFullYear();
    return new Date(year + 1, 4, 31);
  }
  if (normalized.includes("종합부동산세") || normalized.includes("종부세")) return upcomingDate(11, 15);
  if (normalized.includes("부동산양도") && basisDate) return addMonths(lastDayOfMonth(basisDate), 2);
  if (normalized.includes("증여") && basisDate) return addMonths(lastDayOfMonth(basisDate), 3);
  if (normalized.includes("상속") && basisDate) return addMonths(lastDayOfMonth(basisDate), 6);
  if (normalized.includes("해외주식")) {
    const year = parseYear(basisText) ?? now().getFullYear();
    return new Date(year + 1, 4, 31);
  }
  if ((normalized.includes("법인세") || normalized.includes("오너법인")) && basisDate) {
    return addMonths(lastDayOfMonth(basisDate), 3);
  }
  if ((normalized.includes("ipo") || normalized.includes("ma") || normalized.includes("엑싯")) && basisDate) {
    return basisDate;
  }

  return undefined;
};

function extractTaxScheduleEvents(rows: Row[]): TaxPaymentEventInput[] {
  const headerIndex = rows.findIndex((row) =>
    row.map(normalize).some((cell) => cell.includes("세금이벤트")),
  );
  if (headerIndex < 0) return [];

  const header = rows[headerIndex];
  const eventColumn = findColumn(header, ["세금", "이벤트"], 0);
  const basisColumn = findColumn(header, ["발생", "기준일"], 1);
  const dueColumn = findColumn(header, ["신고", "납부", "기한"], 2);
  const amountColumn = findColumn(header, ["예상세액", "금액", "만원"], 3);
  const cashColumn = findColumn(header, ["현금화", "목표"], 4);
  const amountHeader = header[amountColumn] ?? "예상세액(만원)";
  const events: TaxPaymentEventInput[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const label = cellToText(row[eventColumn]);
    if (!label || label.includes("작성 원칙")) break;

    const amount = parseLikelyAmount(cellToText(row[amountColumn]), amountHeader);
    if (!amount || amount <= 0) continue;

    const basisText = cellToText(row[basisColumn]);
    const dueText = cellToText(row[dueColumn]);
    const due = dueFromTaxSchedule(label, basisText, dueText) ?? upcomingDate(11, 31);
    const cashReadyDate = parseDateLike(cellToText(row[cashColumn])) ?? exitDateForDue(due);
    const normalized = normalize(label);

    if (normalized.includes("재산세")) {
      const first = upcomingDate(6, 31);
      const second = upcomingDate(8, 30);
      events.push({
        id: "tax-schedule-property-1",
        label: "재산세 1차",
        amountWon: amount / 2,
        dueDate: toDateInput(first),
        cashReadyDate: exitDateForDue(first),
        rule: "세금 일정표의 재산세 예상세액 기준",
      });
      events.push({
        id: "tax-schedule-property-2",
        label: "재산세 2차",
        amountWon: amount / 2,
        dueDate: toDateInput(second),
        cashReadyDate: exitDateForDue(second),
        rule: "세금 일정표의 재산세 예상세액 기준",
      });
      continue;
    }

    events.push({
      id: uid("tax-schedule", label),
      label,
      amountWon: amount,
      dueDate: toDateInput(due),
      cashReadyDate,
      rule: "고액자산가 세금 납부 및 현금화 일정표 기준",
    });
  }

  return events;
}

export function parseCashflowRows(rows: Row[], fileName = "업로드 파일"): CashflowUploadResult {
  const headerIndex = findHeaderIndex(rows);
  const header = headerIndex >= 0 ? rows[headerIndex] : [];
  const dataRows = headerIndex >= 0 ? rows.slice(headerIndex + 1) : rows;
  const itemColumn = findColumn(header, ["항목", "구분", "item", "name"], 0);
  const valueColumn = findColumn(header, ["값", "금액", "만원", "amount", "value"], 1);
  const dueColumn = findColumn(header, ["납부일", "예정일", "일자", "날짜", "date"], 2);
  const categoryColumn = findColumn(header, ["분류", "카테고리", "세무", "회계", "category"], 3);
  const directionColumn = findColumn(header, ["유입/유출", "유입유출", "입출금", "direction"], -1);
  const entityColumn = findColumn(header, ["자금주체", "주체", "entity", "owner"], -1);
  const accountColumn = findColumn(header, ["계좌유형", "계좌", "account"], -1);
  const recurringColumn = findColumn(header, ["정기/일회", "정기일회", "반복주기", "recurring"], -1);
  const noteColumn = findColumn(header, ["메모", "비고", "note"], -1);
  const appColumn = findColumn(header, ["앱반영", "app"], -1);
  const valueHeader = header[valueColumn] ?? "";

  const cashFlows: CashFlow[] = [];
  const unmatchedLabels: string[] = [];
  const schedule: Partial<Record<ScheduleKey, number | string>> = {};
  const periodCashFlows = extractPeriodCashFlows(rows, fileName);
  let matchedRows = 0;
  let monthlyIncomeWon = 0;
  let monthlyOutflowWon = 0;
  let annualTaxWon = 0;
  let currentCashWon = 0;

  const applyEntry = ({
    label,
    rawValue,
    explicitDue,
    explicitCategory = "",
    valueHint = valueHeader,
    rawDirection = "",
    rawEntity = "",
    rawAccountType = "",
    rawRecurring = "",
    rawNote = "",
    appIncluded = "",
  }: TemplateEntry) => {
    const cleanLabel = label.trim();
    const cleanValue = rawValue.trim();
    if (!cleanLabel || !cleanValue) return;
    if (!shouldIncludeInApp(appIncluded)) return;

    const category = inferCategory(cleanLabel, explicitCategory);
    const scheduleKey = findScheduleKey(cleanLabel);
    const amount = parseAmountManwon(cleanValue, valueHint);
    const direction = normalize(rawDirection);
    const directionSignedAmount =
      direction.includes("유입") || direction.includes("입금")
        ? amount
        : direction.includes("유출") || direction.includes("출금")
          ? amount == null ? undefined : -amount
          : undefined;

    if (scheduleKey) {
      if (["businessYearEnd", "realEstateSaleDate", "giftDate", "inheritanceDate", "ipoLockupEndDate", "mnaClosingDate"].includes(scheduleKey)) {
        const date = explicitDue ?? parseDateLike(cleanValue);
        if (date) {
          schedule[scheduleKey] = date;
          matchedRows += 1;
        }
      } else if (scheduleKey === "overseasStockSaleYear") {
        const year = parseYear(cleanValue);
        if (year) {
          schedule[scheduleKey] = year;
          matchedRows += 1;
        }
      } else if (amount !== undefined) {
        schedule[scheduleKey] = amount;
        matchedRows += 1;
      }
      return;
    }

    if (amount === undefined || (!category && directionSignedAmount === undefined)) {
      unmatchedLabels.push(cleanLabel);
      return;
    }

    matchedRows += 1;

    if (category === "asset") {
      currentCashWon += amount;
      return;
    }

    if (category === "debt") return;

    if (category === "tax" && directionSignedAmount === undefined) {
      annualTaxWon += amount;
      return;
    }

    const recurring = parseRecurring(rawRecurring, category !== "saving");
    const signedAmount = directionSignedAmount ?? (category === "income" ? amount : -amount);
    if (category === "income") monthlyIncomeWon += amount;
    if (category === "expense" || category === "saving") monthlyOutflowWon += amount;

    cashFlows.push({
      id: uid("upload", cleanLabel),
      label: cleanLabel,
      amount: signedAmount,
      date: explicitDue ? toMonthInput(explicitDue) : toDateInput(now()).slice(0, 7),
      recurring,
      entity: parseEntity(rawEntity),
      accountType: rawAccountType.trim() || undefined,
      category: explicitCategory.trim() || category,
      taxAccountingNote: rawNote.trim() || undefined,
    });
  };

  if (headerIndex >= 0) {
    for (const row of dataRows) {
      const label = cellToText(row[itemColumn]);
      const rawValue = cellToText(row[valueColumn]);
      const explicitDue = parseDateLike(cellToText(row[dueColumn]));
      applyEntry({
        label,
        rawValue,
        explicitDue,
        explicitCategory: cellToText(row[categoryColumn]),
        valueHint: valueHeader,
        rawDirection: directionColumn >= 0 ? cellToText(row[directionColumn]) : "",
        rawEntity: entityColumn >= 0 ? cellToText(row[entityColumn]) : "",
        rawAccountType: accountColumn >= 0 ? cellToText(row[accountColumn]) : "",
        rawRecurring: recurringColumn >= 0 ? cellToText(row[recurringColumn]) : "",
        rawNote: noteColumn >= 0 ? cellToText(row[noteColumn]) : "",
        appIncluded: appColumn >= 0 ? cellToText(row[appColumn]) : "",
      });
    }
  }

  const templateEntries = extractTemplateEntries(rows, headerIndex >= 0 ? itemColumn : undefined);
  templateEntries.forEach(applyEntry);
  if (periodCashFlows.length > 0) {
    cashFlows.push(...periodCashFlows);
    matchedRows += periodCashFlows.length;
  }

  const eventInputs: TaxPaymentEventInput[] = [];
  const addEvent = (event: TaxPaymentEventInput) => {
    if (event.amountWon <= 0) return;
    if (eventInputs.some((existing) => existing.label === event.label && existing.dueDate === event.dueDate)) return;
    eventInputs.push(event);
  };

  extractTaxScheduleEvents(rows).forEach(addEvent);

  const propertyTax = findTaxAmount(rows, "재산세", valueColumn, valueHeader);
  if (propertyTax > 0) {
    const first = upcomingDate(6, 31);
    const second = upcomingDate(8, 30);
    addEvent({ id: "property-1", label: "재산세 1차", amountWon: propertyTax / 2, dueDate: toDateInput(first), cashReadyDate: exitDateForDue(first), rule: "7월 말 납부 기준" });
    addEvent({ id: "property-2", label: "재산세 2차", amountWon: propertyTax / 2, dueDate: toDateInput(second), cashReadyDate: exitDateForDue(second), rule: "9월 말 납부 기준" });
  }

  const comprehensiveTax = findTaxAmount(rows, "종부세", valueColumn, valueHeader);
  if (comprehensiveTax > 0) {
    const due = upcomingDate(11, 15);
    addEvent({ id: "comprehensive", label: "종합부동산세", amountWon: comprehensiveTax, dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "12월 중순 납부 기준" });
  }

  const incomeTax =
    findTaxAmount(rows, "종합소득세", valueColumn, valueHeader) +
    findTaxAmount(rows, "지방소득세", valueColumn, valueHeader) +
    findTaxAmount(rows, "건강보험정산", valueColumn, valueHeader);
  if (incomeTax > 0) {
    const due = upcomingDate(4, 31);
    addEvent({ id: "income-tax", label: "종합소득세/지방세", amountWon: incomeTax, dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "5월 말 납부 기준" });
  }

  const realEstateSale = parseInputDate(schedule.realEstateSaleDate as string);
  if (realEstateSale && Number(schedule.realEstateTax)) {
    const due = addMonths(lastDayOfMonth(realEstateSale), 2);
    addEvent({ id: "real-estate-tax", label: "부동산 양도소득세", amountWon: Number(schedule.realEstateTax), dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "양도월 말일부터 2개월 이내" });
  }

  const giftDate = parseInputDate(schedule.giftDate as string);
  const giftReserve = Number(schedule.giftAmount ?? 0) + Number(schedule.giftTax ?? 0);
  if (giftReserve > 0) {
    const due = giftDate ? addMonths(lastDayOfMonth(giftDate), 3) : addMonths(now(), 3);
    addEvent({ id: "gift-tax", label: "증여 실행/증여세 예비", amountWon: giftReserve, dueDate: toDateInput(due), cashReadyDate: giftDate ? toDateInput(giftDate) : toDateInput(now()), rule: "증여일 기준 3개월 이내 신고·납부" });
  }

  const inheritanceDate = parseInputDate(schedule.inheritanceDate as string);
  if (inheritanceDate && Number(schedule.inheritanceTax)) {
    const due = addMonths(lastDayOfMonth(inheritanceDate), 6);
    addEvent({ id: "inheritance-tax", label: "상속세 납부 예비", amountWon: Number(schedule.inheritanceTax), dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "상속개시월 말일부터 6개월 이내" });
  }

  const businessEnd = parseInputDate(schedule.businessYearEnd as string);
  if (businessEnd && Number(schedule.corporateTax)) {
    const due = addMonths(lastDayOfMonth(businessEnd), 3);
    addEvent({ id: "corporate-tax", label: "법인세 납부 예비", amountWon: Number(schedule.corporateTax), dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "사업연도 종료월 말일부터 3개월 이내" });
  }

  if (Number(schedule.overseasStockSaleYear) && Number(schedule.overseasStockTax)) {
    const due = new Date(Number(schedule.overseasStockSaleYear) + 1, 4, 31);
    addEvent({ id: "overseas-stock-tax", label: "해외주식 양도소득세", amountWon: Number(schedule.overseasStockTax), dueDate: toDateInput(due), cashReadyDate: exitDateForDue(due), rule: "다음해 5월 확정신고" });
  }

  const taxEvents = scoreReadinessEvents({
    currentCashWon,
    monthlyNetWon: monthlyIncomeWon - monthlyOutflowWon,
    events: eventInputs,
  });
  const nextTaxNeedWon = taxEvents.reduce((sum, event) => sum + event.amountWon, 0);
  const liquidityCoveragePct = nextTaxNeedWon > 0 ? Math.round((currentCashWon / nextTaxNeedWon) * 100) : 999;

  const giftExecutionWon = Number(schedule.giftAmount ?? 0);
  if (giftExecutionWon > 0) {
    cashFlows.push({
      id: uid("gift", "증여 실행금액"),
      label: "증여 실행금액",
      amount: -giftExecutionWon,
      date: giftDate ? toMonthInput(toDateInput(giftDate)) : toDateInput(now()).slice(0, 7),
      recurring: false,
      category: "목적자금",
      taxAccountingNote: "증여 실행 원금 유출입니다. 증여세는 납부월에 별도 반영하며 세무 전문가 확인이 필요합니다.",
    });
  }

  taxEvents.forEach((event) => {
    const giftTaxWon = Number(schedule.giftTax ?? 0);
    const isGiftTaxEvent = event.id === "gift-tax";
    if (isGiftTaxEvent && giftTaxWon <= 0) return;
    const amountWon = isGiftTaxEvent ? giftTaxWon : event.amountWon;
    const label = isGiftTaxEvent ? "증여세 납부 예비" : event.label;
    cashFlows.push({
      id: uid("tax", label),
      label,
      amount: -amountWon,
      date: toMonthInput(event.dueDate),
      recurring: false,
      category: "세금",
      taxAccountingNote: `${event.rule}. 상담용 추정치이며 세무 전문가 확인 필요`,
    });
  });

  return {
    summary: {
      fileName,
      matchedRows,
      monthlyIncomeWon,
      monthlyOutflowWon,
      annualTaxWon,
      currentCashWon,
      nextTaxNeedWon,
      liquidityCoveragePct,
      nearestEvent: taxEvents[0],
    },
    cashFlows,
    taxEvents,
    unmatchedLabels,
  };
}

function findTaxAmount(rows: Row[], label: string, valueColumn: number, valueHeader: string) {
  const row = rows.find((candidate) => normalize(candidate.join(" ")).includes(normalize(label)));
  if (!row) return 0;

  const direct = parseLikelyAmount(cellToText(row[valueColumn]), valueHeader);
  if (direct) return direct;

  const labelIndex = row.findIndex((cell) => normalize(cellToText(cell)).includes(normalize(label)));
  for (const value of row.slice(Math.max(0, labelIndex + 1))) {
    const text = cellToText(value);
    if (!text || (/[년월일%]/.test(text) && !/[원만억]/.test(text)) || parseDateLike(text)) continue;
    const amount = parseAmountManwon(text, "값(만원)");
    if (amount) return amount;
  }

  return 0;
}
