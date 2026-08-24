export const FLOW_WINDOWS = [1, 5, 20] as const;

export type FlowWindowDays = typeof FLOW_WINDOWS[number];
export type FlowShortMetricStatus = "final" | "provisional" | "missing" | "unavailable";
export type FlowShortPublicationStatus = "final" | "provisional" | "not_applicable";
export type FlowShortFreshness = "fixture" | "current" | "delayed" | "stale";

export interface FlowShortMetricProvenance {
  source: string;
  publicationDate: string;
  publicationStatus: FlowShortPublicationStatus;
  freshness: FlowShortFreshness;
}

export type FlowShortDatum<T> =
  | { status: "final" | "provisional"; value: T; reason: null }
  | { status: "missing" | "unavailable"; value: null; reason: string };

export interface FlowShortMetadata {
  datasetId: string;
  version: string;
  label: "교육용 데모 데이터";
  dataMode: "demo";
  approvalStatus: "not_applicable";
  asOfTradeDate: string;
  publicationDate: string;
  source: string;
  sourceUrl: null;
  publicationStatus: "not_applicable";
  freshness: "fixture";
}

export type InstitutionCategory =
  | "securities"
  | "investment_trust"
  | "private_fund"
  | "bank"
  | "insurance"
  | "merchant_bank"
  | "pension_fund"
  | "other_institution";

export interface InstitutionFlow {
  totalNetBuyKrw: FlowShortDatum<number>;
  breakdownNetBuyKrw: Partial<Record<InstitutionCategory, FlowShortDatum<number>>>;
  aggregation: {
    mode: "source-total" | "sum-children";
    includedChildren: InstitutionCategory[];
    exhaustive: boolean;
    mutuallyExclusive: boolean;
  };
}

export interface InvestorFlowDay {
  kind: "investor-flow";
  tradeDate: string;
  totalTradingValueKrw: FlowShortDatum<number>;
  individualNetBuyKrw: FlowShortDatum<number>;
  foreignNetBuyKrw: FlowShortDatum<number>;
  institution: InstitutionFlow;
}

export interface ShortSaleTradingDay extends FlowShortMetricProvenance {
  kind: "short-sale-trading";
  tradeDate: string;
  shortSaleTradingValueKrw: FlowShortDatum<number>;
  totalTradingValueKrw: FlowShortDatum<number>;
  sourceReportedRatioPct: FlowShortDatum<number> | null;
}

export interface ShareDenominator {
  kind: "listed-shares";
  referenceDate: string;
  quantity: FlowShortDatum<number>;
}

export interface ReportableNetShortPositionDay extends FlowShortMetricProvenance {
  kind: "reportable-net-short-position";
  referenceDate: string;
  netShortPositionQuantity: FlowShortDatum<number>;
  denominator: ShareDenominator;
  sourceReportedRatioPct: FlowShortDatum<number> | null;
  coverageScope: "reportable-positions-only" | "market-aggregate" | "unknown";
}

export interface SecuritiesLendingBalanceDay extends FlowShortMetricProvenance {
  kind: "securities-lending";
  referenceDate: string;
  matchedQuantity: FlowShortDatum<number>;
  returnedQuantity: FlowShortDatum<number>;
  outstandingQuantity: FlowShortDatum<number>;
  outstandingValueKrw: FlowShortDatum<number>;
  denominator: ShareDenominator;
}

export interface TickerFlowShortDataset {
  symbol: string;
  displayName: string;
  metadata: FlowShortMetadata;
  tradingCalendar: string[];
  investorFlows: InvestorFlowDay[];
  shortSaleTrading: ShortSaleTradingDay;
  reportableNetShortPosition: ReportableNetShortPositionDay;
  securitiesLending: SecuritiesLendingBalanceDay;
}

export interface CalculatedMetric<T> {
  status: FlowShortMetricStatus;
  value: T | null;
  missingDates: string[];
  reason: string | null;
}

export interface InvestorGroupEvidence {
  netBuyKrw: CalculatedMetric<number>;
  shareOfTurnoverPct: CalculatedMetric<number>;
}

export interface InvestorWindowEvidence {
  days: FlowWindowDays;
  startDate: string | null;
  endDate: string | null;
  expectedDates: string[];
  individual: InvestorGroupEvidence;
  foreign: InvestorGroupEvidence;
  institution: InvestorGroupEvidence;
}

export interface RatioEvidence extends FlowShortMetricProvenance {
  status: FlowShortMetricStatus;
  ratioPct: number | null;
  numerator: number | null;
  denominator: number | null;
  formula: string;
  basisDate: string;
  label: string;
  sourceReportedRatioPct: number | null;
  coverageNote: string;
}

export interface InvestorFlowWindowsResult {
  windows: {
    d1: InvestorWindowEvidence;
    d5: InvestorWindowEvidence;
    d20: InvestorWindowEvidence;
  };
  duplicateDatesRemoved: number;
  errors: string[];
  warnings: string[];
}

export interface TickerFlowShortEvidence {
  status: "ok" | "warning" | "blocked";
  symbol: string;
  displayName: string;
  metadata: FlowShortMetadata;
  windows: InvestorFlowWindowsResult["windows"];
  shortSaleTrading: RatioEvidence;
  reportableNetShortPosition: RatioEvidence;
  securitiesLending: RatioEvidence;
  duplicateDatesRemoved: number;
  warnings: string[];
}

export const FLOW_SHORT_STATUS_LABELS: Record<FlowShortMetricStatus | "fixture", string> = {
  final: "확정",
  provisional: "잠정",
  missing: "누락",
  unavailable: "확인 필요",
  fixture: "교육용 데모 데이터",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATIO_DISPLAY_SCALE = 10_000;
const PERCENT_SCALED_INTEGER = 100 * RATIO_DISPLAY_SCALE;

export function finalDatum(value: number): FlowShortDatum<number> {
  return { status: "final", value, reason: null };
}

export function provisionalDatum(value: number): FlowShortDatum<number> {
  return { status: "provisional", value, reason: null };
}

export function missingDatum(reason: string): FlowShortDatum<number> {
  return { status: "missing", value: null, reason };
}

export function unavailableDatum(reason: string): FlowShortDatum<number> {
  return { status: "unavailable", value: null, reason };
}

function isValidIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isAvailableDatum<T>(
  datum: FlowShortDatum<T>,
): datum is Extract<FlowShortDatum<T>, { status: "final" | "provisional" }> {
  return datum.status === "final" || datum.status === "provisional";
}

function validateIntegerDatum(
  datum: FlowShortDatum<number>,
  label: string,
  options: { nonNegative?: boolean } = {},
) {
  if (!datum || typeof datum !== "object") return `${label} 값 구조가 없습니다.`;
  if (isAvailableDatum(datum)) {
    if (!Number.isSafeInteger(datum.value)) return `${label}은 안전한 정수여야 합니다.`;
    if (options.nonNegative && datum.value < 0) return `${label}은 음수일 수 없습니다.`;
    return null;
  }
  if (datum.value !== null || !datum.reason?.trim()) {
    return `${label}의 누락·미확인 상태에는 null과 사유가 필요합니다.`;
  }
  return null;
}

function validateRatioDatum(datum: FlowShortDatum<number> | null, label: string) {
  if (datum == null) return null;
  if (isAvailableDatum(datum)) {
    if (!Number.isFinite(datum.value) || datum.value < 0) return `${label}이 비정상입니다.`;
    return null;
  }
  if (datum.value !== null || !datum.reason?.trim()) {
    return `${label}의 누락·미확인 상태에는 null과 사유가 필요합니다.`;
  }
  return null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function sameObservation(a: InvestorFlowDay, b: InvestorFlowDay) {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

function validateInstitutionFlow(flow: InstitutionFlow, tradeDate: string) {
  const errors: string[] = [];
  const totalError = validateIntegerDatum(flow.totalNetBuyKrw, `${tradeDate} 기관계 순매수금액`);
  if (totalError) errors.push(totalError);
  for (const [category, datum] of Object.entries(flow.breakdownNetBuyKrw)) {
    if (!datum) continue;
    const error = validateIntegerDatum(datum, `${tradeDate} 기관 하위분류(${category}) 순매수금액`);
    if (error) errors.push(error);
  }
  if (flow.aggregation.mode === "sum-children") {
    if (!flow.aggregation.exhaustive || !flow.aggregation.mutuallyExclusive) {
      errors.push(`${tradeDate} 기관 하위분류는 완전포괄·상호배타 확인 전 합산할 수 없습니다.`);
    }
    if (!flow.aggregation.includedChildren.length) {
      errors.push(`${tradeDate} 기관 하위분류 합산 대상이 없습니다.`);
    }
    if (new Set(flow.aggregation.includedChildren).size !== flow.aggregation.includedChildren.length) {
      errors.push(`${tradeDate} 기관 하위분류 합산 대상이 중복되었습니다.`);
    }
  }
  return errors;
}

function validateInvestorFlow(day: InvestorFlowDay) {
  const errors: string[] = [];
  if (!isValidIsoDate(day.tradeDate)) errors.push(`거래일 형식 오류: ${day.tradeDate || "(빈 값)"}`);
  const checks: Array<[FlowShortDatum<number>, string, boolean]> = [
    [day.totalTradingValueKrw, `${day.tradeDate} 전체 거래대금`, true],
    [day.individualNetBuyKrw, `${day.tradeDate} 개인 순매수금액`, false],
    [day.foreignNetBuyKrw, `${day.tradeDate} 외국인 순매수금액`, false],
  ];
  for (const [datum, label, nonNegative] of checks) {
    const error = validateIntegerDatum(datum, label, { nonNegative });
    if (error) errors.push(error);
  }
  errors.push(...validateInstitutionFlow(day.institution, day.tradeDate));
  return errors;
}

function resolveInstitutionTotal(day: InvestorFlowDay): FlowShortDatum<number> {
  const institution = day.institution;
  if (institution.aggregation.mode === "source-total") {
    // 원천 총계가 있으면 하위분류는 설명용이며 다시 더하지 않는다.
    return institution.totalNetBuyKrw;
  }
  if (!institution.aggregation.exhaustive || !institution.aggregation.mutuallyExclusive) {
    return unavailableDatum("기관 하위분류의 완전포괄·상호배타성이 확인되지 않았습니다.");
  }
  const included = institution.aggregation.includedChildren;
  if (!included.length || new Set(included).size !== included.length) {
    return unavailableDatum("기관 하위분류 합산 목록이 비어 있거나 중복되었습니다.");
  }
  let sum = 0;
  let provisional = false;
  for (const category of included) {
    const datum = institution.breakdownNetBuyKrw[category];
    if (!datum) return missingDatum(`기관 하위분류 ${category} 값이 없습니다.`);
    if (!isAvailableDatum(datum)) return datum;
    sum += datum.value;
    provisional ||= datum.status === "provisional";
  }
  if (!Number.isSafeInteger(sum)) return unavailableDatum("기관 하위분류 합계가 안전한 정수 범위를 벗어났습니다.");
  return provisional ? provisionalDatum(sum) : finalDatum(sum);
}

function statusFromData(data: Array<FlowShortDatum<number>>) {
  return data.some((datum) => datum.status === "provisional") ? "provisional" as const : "final" as const;
}

function emptyMetric(
  status: "missing" | "unavailable",
  reason: string,
  missingDates: string[] = [],
): CalculatedMetric<number> {
  return { status, value: null, missingDates: [...missingDates], reason };
}

function availableMetric(
  status: "final" | "provisional",
  value: number,
): CalculatedMetric<number> {
  return { status, value, missingDates: [], reason: null };
}

function mergeMetricFailure(
  data: Array<{ date: string; datum: FlowShortDatum<number> | null }>,
  label: string,
) {
  const missingDates = data.filter(({ datum }) => datum == null || datum.status === "missing").map(({ date }) => date);
  const unavailable = data.find(({ datum }) => datum?.status === "unavailable");
  if (unavailable?.datum) {
    return emptyMetric("unavailable", `${label}: ${unavailable.datum.reason}`, missingDates);
  }
  if (missingDates.length) {
    const reason = data.find(({ datum }) => datum?.status === "missing")?.datum?.reason;
    return emptyMetric("missing", `${label}: ${reason ?? "거래일 관측값이 없습니다."}`, missingDates);
  }
  return null;
}

function sumWindowDatum(
  dates: string[],
  rows: Map<string, InvestorFlowDay>,
  selector: (row: InvestorFlowDay) => FlowShortDatum<number>,
  label: string,
) {
  const selected = dates.map((date) => ({ date, datum: rows.has(date) ? selector(rows.get(date)!) : null }));
  const failure = mergeMetricFailure(selected, label);
  if (failure) return failure;
  const available = selected.map(({ datum }) => datum!).filter(isAvailableDatum);
  const sum = available.reduce((total, datum) => total + datum.value, 0);
  if (!Number.isSafeInteger(sum)) return emptyMetric("unavailable", `${label}: 합계가 안전한 정수 범위를 벗어났습니다.`);
  return availableMetric(statusFromData(available), sum);
}

export function calculateRatioPctDeterministic(numerator: number, denominator: number): number | null {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
  const numeratorBig = BigInt(numerator);
  const denominatorBig = BigInt(denominator);
  const scaled = numeratorBig * BigInt(PERCENT_SCALED_INTEGER);
  let quotient = scaled / denominatorBig;
  const remainder = scaled % denominatorBig;
  const absRemainder = remainder < BigInt(0) ? -remainder : remainder;
  if (absRemainder * BigInt(2) >= denominatorBig) {
    quotient += numeratorBig < BigInt(0) ? -BigInt(1) : BigInt(1);
  }
  return Number(quotient) / RATIO_DISPLAY_SCALE;
}

function buildGroupEvidence(
  dates: string[],
  rows: Map<string, InvestorFlowDay>,
  selector: (row: InvestorFlowDay) => FlowShortDatum<number>,
  label: string,
): InvestorGroupEvidence {
  const netBuyKrw = sumWindowDatum(dates, rows, selector, `${label} 누적 순매수금액`);
  const turnover = sumWindowDatum(dates, rows, (row) => row.totalTradingValueKrw, "전체 거래대금");
  if (netBuyKrw.value == null) {
    return {
      netBuyKrw,
      shareOfTurnoverPct: emptyMetric(netBuyKrw.status === "unavailable" ? "unavailable" : "missing", netBuyKrw.reason ?? `${label} 순매수금액을 계산할 수 없습니다.`, netBuyKrw.missingDates),
    };
  }
  if (turnover.value == null) {
    return {
      netBuyKrw,
      shareOfTurnoverPct: emptyMetric(turnover.status === "unavailable" ? "unavailable" : "missing", turnover.reason ?? "전체 거래대금을 계산할 수 없습니다.", turnover.missingDates),
    };
  }
  const ratioPct = calculateRatioPctDeterministic(netBuyKrw.value, turnover.value);
  if (ratioPct == null) {
    return {
      netBuyKrw,
      shareOfTurnoverPct: emptyMetric("unavailable", "전체 거래대금 합계가 0 이하이거나 비정상입니다."),
    };
  }
  const ratioStatus = netBuyKrw.status === "provisional" || turnover.status === "provisional"
    ? "provisional"
    : "final";
  return { netBuyKrw, shareOfTurnoverPct: availableMetric(ratioStatus, ratioPct) };
}

function unavailableGroup(reason: string, dates: string[] = []): InvestorGroupEvidence {
  return {
    netBuyKrw: emptyMetric("unavailable", reason, dates),
    shareOfTurnoverPct: emptyMetric("unavailable", reason, dates),
  };
}

function unavailableWindow(days: FlowWindowDays, reason: string, dates: string[] = []): InvestorWindowEvidence {
  return {
    days,
    startDate: dates.at(0) ?? null,
    endDate: dates.at(-1) ?? null,
    expectedDates: [...dates],
    individual: unavailableGroup(reason, dates),
    foreign: unavailableGroup(reason, dates),
    institution: unavailableGroup(reason, dates),
  };
}

function normalizeCalendar(calendar: string[], asOfDate: string) {
  const errors: string[] = [];
  const unique = new Set<string>();
  for (const date of calendar) {
    if (!isValidIsoDate(date)) errors.push(`교육용 거래일 형식 오류: ${date || "(빈 값)"}`);
    if (unique.has(date)) errors.push(`교육용 거래일 달력에 중복 일자 ${date}가 있습니다.`);
    unique.add(date);
  }
  return {
    dates: Array.from(unique).filter((date) => date <= asOfDate).sort((a, b) => a.localeCompare(b)),
    errors,
  };
}

function normalizeInvestorFlows(input: InvestorFlowDay[]) {
  const errors: string[] = [];
  const byDate = new Map<string, InvestorFlowDay>();
  let duplicateDatesRemoved = 0;
  for (const day of input) {
    errors.push(...validateInvestorFlow(day));
    const existing = byDate.get(day.tradeDate);
    if (!existing) {
      byDate.set(day.tradeDate, day);
      continue;
    }
    if (!sameObservation(existing, day)) {
      errors.push(`${day.tradeDate}에 서로 다른 투자자별 수급 관측값이 있어 계산을 차단했습니다.`);
      continue;
    }
    duplicateDatesRemoved += 1;
  }
  return { byDate, duplicateDatesRemoved, errors };
}

export function calculateInvestorFlowWindows(dataset: TickerFlowShortDataset): InvestorFlowWindowsResult {
  const calendar = normalizeCalendar(dataset.tradingCalendar, dataset.metadata.asOfTradeDate);
  const normalized = normalizeInvestorFlows(dataset.investorFlows);
  const errors = [...calendar.errors, ...normalized.errors];
  const warnings: string[] = [];
  if (normalized.duplicateDatesRemoved) {
    warnings.push(`완전히 동일한 중복 수급 일자 ${normalized.duplicateDatesRemoved}건을 한 번만 사용했습니다.`);
  }

  const build = (days: FlowWindowDays): InvestorWindowEvidence => {
    const expectedDates = calendar.dates.slice(-days);
    if (errors.length) return unavailableWindow(days, errors[0], expectedDates);
    if (expectedDates.length !== days) {
      return unavailableWindow(days, `${days}거래일 계산에 필요한 교육용 거래일이 부족합니다.`, expectedDates);
    }
    return {
      days,
      startDate: expectedDates[0],
      endDate: expectedDates.at(-1)!,
      expectedDates,
      individual: buildGroupEvidence(expectedDates, normalized.byDate, (row) => row.individualNetBuyKrw, "개인"),
      foreign: buildGroupEvidence(expectedDates, normalized.byDate, (row) => row.foreignNetBuyKrw, "외국인"),
      institution: buildGroupEvidence(expectedDates, normalized.byDate, resolveInstitutionTotal, "기관계"),
    };
  };

  return {
    windows: { d1: build(1), d5: build(5), d20: build(20) },
    duplicateDatesRemoved: normalized.duplicateDatesRemoved,
    errors,
    warnings,
  };
}

function rawDatumValue(datum: FlowShortDatum<number>) {
  return isAvailableDatum(datum) && Number.isSafeInteger(datum.value) ? datum.value : null;
}

function ratioEvidence(input: {
  numerator: FlowShortDatum<number>;
  denominator: FlowShortDatum<number>;
  formula: string;
  basisDate: string;
  label: string;
  sourceReportedRatioPct: FlowShortDatum<number> | null;
  coverageNote: string;
} & FlowShortMetricProvenance): RatioEvidence {
  const numerator = rawDatumValue(input.numerator);
  const denominator = rawDatumValue(input.denominator);
  const reported = input.sourceReportedRatioPct && isAvailableDatum(input.sourceReportedRatioPct)
    && Number.isFinite(input.sourceReportedRatioPct.value)
    ? input.sourceReportedRatioPct.value
    : null;
  const unavailable = [input.numerator, input.denominator].find((datum) => datum.status === "unavailable");
  const missing = [input.numerator, input.denominator].find((datum) => datum.status === "missing");
  if (unavailable || missing || numerator == null || denominator == null) {
    const failed = unavailable ?? missing;
    return {
      status: unavailable ? "unavailable" : "missing",
      ratioPct: null,
      numerator,
      denominator,
      formula: input.formula,
      basisDate: input.basisDate,
      label: input.label,
      sourceReportedRatioPct: reported,
      coverageNote: `${input.coverageNote} ${failed?.reason ?? "필요한 값이 없습니다."}`.trim(),
      source: input.source,
      publicationDate: input.publicationDate,
      publicationStatus: input.publicationStatus,
      freshness: input.freshness,
    };
  }
  const ratioPct = calculateRatioPctDeterministic(numerator, denominator);
  return {
    status: ratioPct == null
      ? "unavailable"
      : input.numerator.status === "provisional" || input.denominator.status === "provisional"
        ? "provisional"
        : "final",
    ratioPct,
    numerator,
    denominator,
    formula: input.formula,
    basisDate: input.basisDate,
    label: input.label,
    sourceReportedRatioPct: reported,
    coverageNote: ratioPct == null
      ? `${input.coverageNote} 분모가 0 이하이거나 계산 가능한 정수가 아닙니다.`
      : input.coverageNote,
    source: input.source,
    publicationDate: input.publicationDate,
    publicationStatus: input.publicationStatus,
    freshness: input.freshness,
  };
}

export function calculateShortSaleTradingRatio(day: ShortSaleTradingDay): RatioEvidence {
  return ratioEvidence({
    numerator: day.shortSaleTradingValueKrw,
    denominator: day.totalTradingValueKrw,
    formula: "공매도 거래대금 ÷ 같은 거래일 전체 거래대금",
    basisDate: day.tradeDate,
    label: "공매도 거래대금비중",
    sourceReportedRatioPct: day.sourceReportedRatioPct,
    coverageNote: "공매도 거래 활동 지표이며 공매도 잔고가 아닙니다.",
    source: day.source,
    publicationDate: day.publicationDate,
    publicationStatus: day.publicationStatus,
    freshness: day.freshness,
  });
}

export function calculateReportableNetShortPositionRatio(
  day: ReportableNetShortPositionDay,
): RatioEvidence {
  if (day.referenceDate !== day.denominator.referenceDate) {
    return {
      status: "unavailable",
      ratioPct: null,
      numerator: rawDatumValue(day.netShortPositionQuantity),
      denominator: rawDatumValue(day.denominator.quantity),
      formula: "신고·공시 기준 순보유잔고 수량 ÷ 동일 기준일 상장주식수",
      basisDate: day.referenceDate,
      label: "신고·공시 기준 공매도 순보유잔고 비율",
      sourceReportedRatioPct: day.sourceReportedRatioPct && isAvailableDatum(day.sourceReportedRatioPct)
        ? day.sourceReportedRatioPct.value
        : null,
      coverageNote: "분자와 상장주식수의 기준일이 달라 계산을 차단했습니다.",
      source: day.source,
      publicationDate: day.publicationDate,
      publicationStatus: day.publicationStatus,
      freshness: day.freshness,
    };
  }
  const scope = day.coverageScope === "reportable-positions-only"
    ? "신고·공시 대상 범위이며 시장 전체 포지션과 동일하다고 단정할 수 없습니다."
    : day.coverageScope === "market-aggregate"
      ? "원천이 시장 합계로 정의한 범위입니다."
      : "자료의 포괄 범위는 확인 필요입니다.";
  return ratioEvidence({
    numerator: day.netShortPositionQuantity,
    denominator: day.denominator.quantity,
    formula: "신고·공시 기준 순보유잔고 수량 ÷ 동일 기준일 상장주식수",
    basisDate: day.referenceDate,
    label: "신고·공시 기준 공매도 순보유잔고 비율",
    sourceReportedRatioPct: day.sourceReportedRatioPct,
    coverageNote: scope,
    source: day.source,
    publicationDate: day.publicationDate,
    publicationStatus: day.publicationStatus,
    freshness: day.freshness,
  });
}

export function calculateSecuritiesLendingBalanceRatio(
  day: SecuritiesLendingBalanceDay,
): RatioEvidence {
  if (day.referenceDate !== day.denominator.referenceDate) {
    return {
      status: "unavailable",
      ratioPct: null,
      numerator: rawDatumValue(day.outstandingQuantity),
      denominator: rawDatumValue(day.denominator.quantity),
      formula: "대차잔고 주식수 ÷ 동일 기준일 상장주식수",
      basisDate: day.referenceDate,
      label: "증권대차 잔고비중",
      sourceReportedRatioPct: null,
      coverageNote: "대차잔고와 상장주식수의 기준일이 달라 계산을 차단했습니다.",
      source: day.source,
      publicationDate: day.publicationDate,
      publicationStatus: day.publicationStatus,
      freshness: day.freshness,
    };
  }
  return ratioEvidence({
    numerator: day.outstandingQuantity,
    denominator: day.denominator.quantity,
    formula: "대차잔고 주식수 ÷ 동일 기준일 상장주식수",
    basisDate: day.referenceDate,
    label: "증권대차 잔고비중",
    sourceReportedRatioPct: null,
    coverageNote: "대차잔고는 공매도 거래 또는 공매도 순보유잔고와 동일하지 않습니다.",
    source: day.source,
    publicationDate: day.publicationDate,
    publicationStatus: day.publicationStatus,
    freshness: day.freshness,
  });
}

function validateMetricProvenance(
  metric: FlowShortMetricProvenance,
  basisDate: string,
  label: string,
  metadata: FlowShortMetadata,
) {
  const errors: string[] = [];
  if (typeof metric.source !== "string" || !metric.source.trim()) errors.push(`${label} 출처가 없습니다.`);
  if (!isValidIsoDate(metric.publicationDate)) {
    errors.push(`${label} 공표일이 유효하지 않습니다.`);
  }
  if (isValidIsoDate(basisDate) && isValidIsoDate(metric.publicationDate)) {
    if (metric.publicationDate < basisDate) {
      errors.push(`${label} 공표일이 기준일보다 앞설 수 없습니다.`);
    }
    if (basisDate > metadata.asOfTradeDate) {
      errors.push(`${label} 기준일이 dataset 기준 거래일보다 미래입니다.`);
    }
    if (metric.publicationDate > metadata.publicationDate) {
      errors.push(`${label} 공표일이 dataset 공표일보다 미래입니다.`);
    }
  }
  if (metric.publicationStatus !== "not_applicable" || metric.freshness !== "fixture") {
    errors.push(`${label}은 교육용 fixture의 공표·최신성 상태를 사용해야 합니다.`);
  }
  return errors;
}

function validateDataset(dataset: TickerFlowShortDataset) {
  const errors: string[] = [];
  if (dataset.metadata.label !== "교육용 데모 데이터" || dataset.metadata.dataMode !== "demo") {
    errors.push("승인된 실데이터가 아니므로 교육용 데모 데이터 계약만 허용합니다.");
  }
  if (!isValidIsoDate(dataset.metadata.asOfTradeDate)) errors.push("dataset 기준 거래일이 유효하지 않습니다.");
  if (!isValidIsoDate(dataset.metadata.publicationDate)) errors.push("dataset 공표일이 유효하지 않습니다.");
  if (isValidIsoDate(dataset.metadata.asOfTradeDate) && isValidIsoDate(dataset.metadata.publicationDate)
    && dataset.metadata.publicationDate < dataset.metadata.asOfTradeDate) {
    errors.push("dataset 공표일이 기준 거래일보다 앞설 수 없습니다.");
  }
  const eligibleCalendarDates = dataset.tradingCalendar
    .filter(isValidIsoDate)
    .filter((date) => !isValidIsoDate(dataset.metadata.publicationDate) || date <= dataset.metadata.publicationDate)
    .sort((a, b) => a.localeCompare(b));
  const latestEligibleCalendarDate = eligibleCalendarDates.at(-1) ?? null;
  if (latestEligibleCalendarDate !== dataset.metadata.asOfTradeDate) {
    errors.push("dataset 기준 거래일은 거래 달력의 최신 적격 일자와 같아야 합니다.");
  }
  if (!isValidIsoDate(dataset.shortSaleTrading.tradeDate)) errors.push("공매도 거래 기준일이 유효하지 않습니다.");
  if (!isValidIsoDate(dataset.reportableNetShortPosition.referenceDate)) errors.push("순보유잔고 기준일이 유효하지 않습니다.");
  if (!isValidIsoDate(dataset.securitiesLending.referenceDate)) errors.push("대차잔고 기준일이 유효하지 않습니다.");
  errors.push(...validateMetricProvenance(
    dataset.shortSaleTrading,
    dataset.shortSaleTrading.tradeDate,
    "공매도 거래",
    dataset.metadata,
  ));
  errors.push(...validateMetricProvenance(
    dataset.reportableNetShortPosition,
    dataset.reportableNetShortPosition.referenceDate,
    "신고·공시 기준 순보유잔고",
    dataset.metadata,
  ));
  errors.push(...validateMetricProvenance(
    dataset.securitiesLending,
    dataset.securitiesLending.referenceDate,
    "증권대차 잔고",
    dataset.metadata,
  ));

  const integerChecks: Array<[FlowShortDatum<number>, string, boolean]> = [
    [dataset.shortSaleTrading.shortSaleTradingValueKrw, "공매도 거래대금", true],
    [dataset.shortSaleTrading.totalTradingValueKrw, "공매도 기준 전체 거래대금", true],
    [dataset.reportableNetShortPosition.netShortPositionQuantity, "신고·공시 기준 순보유잔고 수량", true],
    [dataset.reportableNetShortPosition.denominator.quantity, "순보유잔고 비율 상장주식수", true],
    [dataset.securitiesLending.matchedQuantity, "대차 체결 주식수", true],
    [dataset.securitiesLending.returnedQuantity, "대차 상환 주식수", true],
    [dataset.securitiesLending.outstandingQuantity, "대차잔고 주식수", true],
    [dataset.securitiesLending.outstandingValueKrw, "대차잔고 금액", true],
    [dataset.securitiesLending.denominator.quantity, "대차잔고 비율 상장주식수", true],
  ];
  for (const [datum, label, nonNegative] of integerChecks) {
    const error = validateIntegerDatum(datum, label, { nonNegative });
    if (error) errors.push(error);
  }
  const reportedChecks: Array<[FlowShortDatum<number> | null, string]> = [
    [dataset.shortSaleTrading.sourceReportedRatioPct, "원천 공매도 거래대금비중"],
    [dataset.reportableNetShortPosition.sourceReportedRatioPct, "원천 순보유잔고 비율"],
  ];
  for (const [datum, label] of reportedChecks) {
    const error = validateRatioDatum(datum, label);
    if (error) errors.push(error);
  }
  return errors;
}

function collectMetricWarning(
  warnings: Set<string>,
  metric: CalculatedMetric<number>,
  label: string,
) {
  if (metric.status === "missing" || metric.status === "unavailable") {
    warnings.add(`${label}: ${metric.reason ?? FLOW_SHORT_STATUS_LABELS[metric.status]}`);
  } else if (metric.status === "provisional") {
    warnings.add(`${label}: 잠정 자료가 포함되었습니다.`);
  }
}

function collectRatioWarning(warnings: Set<string>, ratio: RatioEvidence) {
  if (ratio.status === "missing" || ratio.status === "unavailable") {
    warnings.add(`${ratio.label}: ${ratio.coverageNote}`);
  } else if (ratio.status === "provisional") {
    warnings.add(`${ratio.label}: 잠정 자료입니다.`);
  }
  if (ratio.ratioPct != null && ratio.sourceReportedRatioPct != null
    && Math.abs(ratio.ratioPct - ratio.sourceReportedRatioPct) > 0.01) {
    warnings.add(`${ratio.label}: 원천 표시 비율과 결정론 재계산값이 0.01%p 넘게 다릅니다.`);
  }
}

function failClosedRatio(ratio: RatioEvidence, reason: string): RatioEvidence {
  return {
    ...ratio,
    status: "unavailable",
    ratioPct: null,
    numerator: null,
    denominator: null,
    sourceReportedRatioPct: null,
    coverageNote: `dataset 검증 실패로 수치를 제거했습니다. ${reason}`,
  };
}

export function buildTickerFlowShortEvidence(dataset: TickerFlowShortDataset): TickerFlowShortEvidence {
  const flow = calculateInvestorFlowWindows(dataset);
  const calculatedShortSaleTrading = calculateShortSaleTradingRatio(dataset.shortSaleTrading);
  const calculatedReportableNetShortPosition = calculateReportableNetShortPositionRatio(dataset.reportableNetShortPosition);
  const calculatedSecuritiesLending = calculateSecuritiesLendingBalanceRatio(dataset.securitiesLending);
  const errors = [...validateDataset(dataset), ...flow.errors];
  const failureReason = errors[0] ?? "검증 오류";
  const shortSaleTrading = errors.length
    ? failClosedRatio(calculatedShortSaleTrading, failureReason)
    : calculatedShortSaleTrading;
  const reportableNetShortPosition = errors.length
    ? failClosedRatio(calculatedReportableNetShortPosition, failureReason)
    : calculatedReportableNetShortPosition;
  const securitiesLending = errors.length
    ? failClosedRatio(calculatedSecuritiesLending, failureReason)
    : calculatedSecuritiesLending;
  const warnings = new Set<string>([...flow.warnings, ...errors]);

  for (const [windowKey, window] of Object.entries(flow.windows)) {
    for (const [groupKey, group] of Object.entries({
      individual: window.individual,
      foreign: window.foreign,
      institution: window.institution,
    })) {
      collectMetricWarning(warnings, group.netBuyKrw, `${windowKey} ${groupKey} 누적 순매수`);
      collectMetricWarning(warnings, group.shareOfTurnoverPct, `${windowKey} ${groupKey} 거래대금 대비 비율`);
    }
  }
  collectRatioWarning(warnings, shortSaleTrading);
  collectRatioWarning(warnings, reportableNetShortPosition);
  collectRatioWarning(warnings, securitiesLending);

  return {
    status: errors.length ? "blocked" : warnings.size ? "warning" : "ok",
    symbol: dataset.symbol,
    displayName: dataset.displayName,
    metadata: { ...dataset.metadata },
    windows: flow.windows,
    shortSaleTrading,
    reportableNetShortPosition,
    securitiesLending,
    duplicateDatesRemoved: flow.duplicateDatesRemoved,
    warnings: Array.from(warnings),
  };
}
