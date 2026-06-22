export type ReadinessStatus = "covered" | "watch" | "shortage";

export interface ReadinessInput {
  currentCashWon: number;
  monthlyNetWon?: number;
  events: Array<{
    id: string;
    label: string;
    amountWon: number;
    dueDate: string;
    cashReadyDate: string;
    rule?: string;
  }>;
}

export interface ReadinessResult {
  status: ReadinessStatus;
  label: "커버" | "점검" | "부족";
  cumulativeRequiredWon: number;
  gapWon: number;
  coveragePct: number;
  daysToCashReady?: number;
  reason: string;
  formula: string;
}

export type ReadinessScoredEvent<T> = T & {
  status: ReadinessStatus;
  readiness: ReadinessResult;
};

export const READINESS_RUBRIC: Array<{
  status: ReadinessStatus;
  label: ReadinessResult["label"];
  tone: string;
  formula: string;
  criteria: string[];
}> = [
  {
    status: "covered",
    label: "커버",
    tone: "green",
    formula: "현재 현금성자산 >= 해당 이벤트까지의 누적 필요액",
    criteria: [
      "현금화 목표일 순서로 세금 이벤트를 정렬",
      "해당 행까지 예상세액을 누적",
      "현재 현금성자산이 누적 필요액 이상이면 커버",
    ],
  },
  {
    status: "watch",
    label: "점검",
    tone: "amber",
    formula: "현재 현금성자산 < 누적 필요액 AND 보완 가능성 존재",
    criteria: [
      "이번 이벤트 금액이 현재 현금성자산의 25% 이하",
      "또는 월 순현금흐름을 현금화 목표일까지 누적하면 부족분을 메울 수 있음",
      "자금 이동 일정, 중복 입력, 세무 확정액 확인 필요",
    ],
  },
  {
    status: "shortage",
    label: "부족",
    tone: "red",
    formula: "현재 현금성자산 < 누적 필요액 AND 점검 완충 기준도 미달",
    criteria: [
      "누적 필요액이 현재 현금성자산을 초과",
      "이번 이벤트 금액이 현재 현금성자산의 25%를 초과",
      "월 순현금흐름 반영 후에도 현금화 목표일까지 부족분 보완이 어려움",
    ],
  },
];

const labelByStatus: Record<ReadinessStatus, ReadinessResult["label"]> = {
  covered: "커버",
  watch: "점검",
  shortage: "부족",
};

export function formatReadinessWon(won: number) {
  const abs = Math.abs(won);
  const sign = won < 0 ? "-" : "";
  if (abs >= 100_000_000) return `${sign}${Math.round((abs / 100_000_000) * 10) / 10}억`;
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}원`;
}

function parseDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function daysBetween(from: Date, to: Date) {
  const ms = to.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function monthsUntil(days?: number) {
  if (days == null || days <= 0) return 0;
  return Math.ceil(days / 30);
}

function coveragePct(currentCashWon: number, cumulativeRequiredWon: number) {
  if (cumulativeRequiredWon <= 0) return 999;
  return Math.round((currentCashWon / cumulativeRequiredWon) * 100);
}

export function scoreReadinessEvent({
  currentCashWon,
  monthlyNetWon = 0,
  amountWon,
  cashReadyDate,
  cumulativeRequiredWon,
}: {
  currentCashWon: number;
  monthlyNetWon?: number;
  amountWon: number;
  cashReadyDate: string;
  cumulativeRequiredWon: number;
}): ReadinessResult {
  const today = new Date();
  const parsedReadyDate = parseDate(cashReadyDate);
  const daysToCashReady = parsedReadyDate ? daysBetween(today, parsedReadyDate) : undefined;
  const projectedNetCashWon = Math.max(0, monthlyNetWon) * monthsUntil(daysToCashReady);
  const gapWon = cumulativeRequiredWon - currentCashWon;
  const pct = coveragePct(currentCashWon, cumulativeRequiredWon);
  const canCoverByMonthlyNet = gapWon > 0 && projectedNetCashWon >= gapWon;
  const isSmallIncrement = amountWon <= Math.max(0, currentCashWon) * 0.25;

  let status: ReadinessStatus;
  let formula: string;
  if (currentCashWon >= cumulativeRequiredWon) {
    status = "covered";
    formula = READINESS_RUBRIC[0].formula;
  } else if (isSmallIncrement || canCoverByMonthlyNet) {
    status = "watch";
    formula = READINESS_RUBRIC[1].formula;
  } else {
    status = "shortage";
    formula = READINESS_RUBRIC[2].formula;
  }

  const comparator = gapWon <= 0 ? "<=" : ">";
  const baseReason = `누적 필요 ${formatReadinessWon(cumulativeRequiredWon)} ${comparator} 현재현금 ${formatReadinessWon(currentCashWon)} (커버율 ${pct}%)`;
  const reason =
    status === "covered"
      ? baseReason
      : `${baseReason}; 부족 ${formatReadinessWon(gapWon)}${canCoverByMonthlyNet ? `, 목표일까지 예상 순유입 ${formatReadinessWon(projectedNetCashWon)}` : ""}`;

  return {
    status,
    label: labelByStatus[status],
    cumulativeRequiredWon,
    gapWon,
    coveragePct: pct,
    daysToCashReady,
    reason,
    formula,
  };
}

export function scoreReadinessEvents<T extends ReadinessInput["events"][number]>({
  currentCashWon,
  monthlyNetWon,
  events,
}: ReadinessInput & { events: T[] }): Array<ReadinessScoredEvent<T>> {
  let cumulativeRequiredWon = 0;
  return [...events]
    .sort((a, b) => {
      const cashReadyOrder = a.cashReadyDate.localeCompare(b.cashReadyDate);
      return cashReadyOrder !== 0 ? cashReadyOrder : a.dueDate.localeCompare(b.dueDate);
    })
    .map((event) => {
      cumulativeRequiredWon += event.amountWon;
      const readiness = scoreReadinessEvent({
        currentCashWon,
        monthlyNetWon,
        amountWon: event.amountWon,
        cashReadyDate: event.cashReadyDate,
        cumulativeRequiredWon,
      });
      return {
        ...event,
        status: readiness.status,
        readiness,
      };
    });
}
