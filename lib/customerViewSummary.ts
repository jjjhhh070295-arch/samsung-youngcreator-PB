/**
 * 고객화면 요약 계산 — 편집기·고객화면이 같은 규칙을 쓰도록 한곳.
 * 표시용 반올림은 formatPercent1, 저장·합산은 전체 정밀도.
 */

import type { ApprovedInstrument, Client, Portfolio } from "./types";
import type { ManualPortfolioDraft } from "./manualPortfolioDraft";
import {
  buildInstrumentsFromDraft,
  isLegacyIncompletePortfolio,
  portfolioHasDisplayableMetrics,
} from "./advisory/approvedPortfolioComposition";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "./advisory/workflowApprovals";
import { detectApprovalInvalidation } from "./advisory/approvalSnapshots";
import { formatPercent1 } from "./formatPercent";

export type QuoteFreshness = "live" | "delayed" | "unavailable" | "book";

export type CustomerInstrumentRow = {
  symbol: string;
  name: string;
  assetClassLabel: string;
  weightWithinClass: number;
  totalWeightPct: number;
  allocationAmountWon: number | null;
  quantity: number | null;
  price: number | null;
  marketValueWon: number | null;
  currency: string;
  quoteFreshness: QuoteFreshness;
  source: "approved" | "proposed";
};

export type CustomerViewReviewStatus =
  | "ips_ready"
  | "portfolio_ready"
  | "needs_review"
  | "blocked";

export type CustomerViewSummary = {
  reviewStatus: CustomerViewReviewStatus;
  reviewLabelKo: string;
  investableWon: number | null;
  portfolioLabel: string | null;
  expectedReturnPct: number | null;
  expectedRiskPct: number | null;
  metricsLabelKo: string;
  /** 편입 종목(승인 스냅샷 우선). 없으면 자산군만 */
  instruments: CustomerInstrumentRow[];
  allocations: { assetClass: string; weight: number }[];
  allocationTotalPct: number;
  proposedInstruments: CustomerInstrumentRow[];
  hasProposedDiff: boolean;
  portfolioValueWon: number | null;
  portfolioValueComplete: boolean;
  cashflowMonthlyNetWon: number | null;
  legacyIncomplete: boolean;
};

/**
 * 초안에서 "실제로 화면에 나올" 종목의 심볼 집합.
 *
 * 자산군 배분이 0%인 자산군은 제외한다 — buildInstrumentsFromDraft 가 `allocPct <= 0`
 * 이면 그 자산군을 통째로 건너뛰기 때문이다. 예전에는 여기서 배분을 보지 않아,
 * 표시되는 종목과 비교되는 종목이 달랐다. 실제로 그 때문에 오탐이 났다:
 * 초안에 채권 2종(KODEX 단기채권·국고채3년)이 남아 있는데 domesticBond 배분이 0% 라
 * 화면에는 안 나오고, 비교에만 잡혀서 위 표와 아래 목록이 글자 그대로 같은데도
 * "미승인 제안 초안이 있습니다 (저장본과 다름)" 이 떴다.
 *
 * 표시 기준과 판정 기준은 같아야 한다 — 화면에 없는 종목으로 "다름"을 주장할 수 없다.
 */
function draftSymbolSet(draft: ManualPortfolioDraft | null): Set<string> {
  if (!draft) return new Set();
  return new Set(
    draft.selected
      .filter((s) => (Number(s.weightWithinClass) || 0) > 0)
      .filter((s) => (Number(draft.allocation?.[s.assetClass]) || 0) > 0)
      .map((s) => s.symbol.trim().toUpperCase()),
  );
}

function approvedSymbolSet(pf: Portfolio | null | undefined): Set<string> {
  return new Set((pf?.instruments ?? []).map((i) => i.symbol.trim().toUpperCase()));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of Array.from(a)) if (!b.has(x)) return false;
  return true;
}

function instrumentToRow(
  inst: ApprovedInstrument,
  source: "approved" | "proposed",
  priceOverride?: number | null,
  freshness: QuoteFreshness = "book",
): CustomerInstrumentRow {
  const price =
    priceOverride != null && Number.isFinite(priceOverride) && priceOverride > 0
      ? priceOverride
      : inst.priceSnapshot != null && Number.isFinite(inst.priceSnapshot) && inst.priceSnapshot > 0
        ? inst.priceSnapshot
        : null;
  let marketValueWon: number | null = null;
  if (inst.allocationAmountWon != null && Number.isFinite(inst.allocationAmountWon)) {
    marketValueWon = inst.allocationAmountWon;
  } else if (price != null && inst.quantity != null && Number.isFinite(inst.quantity)) {
    const raw = price * inst.quantity;
    marketValueWon = (inst.currency || "KRW").toUpperCase() === "USD" ? null : raw;
  }
  return {
    symbol: inst.symbol,
    name: inst.name,
    assetClassLabel: inst.assetClassLabel,
    weightWithinClass: inst.weightWithinClass,
    totalWeightPct: inst.totalWeightPct,
    allocationAmountWon: inst.allocationAmountWon,
    quantity: inst.quantity,
    price,
    marketValueWon,
    currency: inst.currency || "KRW",
    quoteFreshness: price == null ? "unavailable" : freshness,
    source,
  };
}

export function resolveCustomerReviewStatus(client: Client): {
  status: CustomerViewReviewStatus;
  labelKo: string;
} {
  const invalidation = detectApprovalInvalidation(client);
  if (invalidation) {
    return { status: "needs_review", labelKo: "변경사항 검토 필요" };
  }
  if (isIpsWorkflowApproved(client) && isPortfolioWorkflowApproved(client)) {
    return { status: "ips_ready", labelKo: "IPS 확정 · 현재 상담본" };
  }
  if (isPortfolioWorkflowApproved(client)) {
    return { status: "portfolio_ready", labelKo: "포트폴리오 승인 · IPS 검토 전" };
  }
  if (isBasicWorkflowApproved(client)) {
    return { status: "needs_review", labelKo: "변경사항 검토 필요" };
  }
  return { status: "blocked", labelKo: "기본정보 승인 후 표시" };
}

export function buildCustomerViewSummary(input: {
  client: Client;
  investableWon?: number | null;
  draft?: ManualPortfolioDraft | null;
  /** symbol → 현재가(현지통화) */
  livePrices?: Map<string, number>;
  quoteFreshness?: QuoteFreshness;
}): CustomerViewSummary {
  const { client, draft = null } = input;
  const review = resolveCustomerReviewStatus(client);
  const pf = client.portfolios?.[0] ?? null;
  const live = input.livePrices;
  const freshness = input.quoteFreshness ?? "book";

  const approvedRows = (pf?.instruments ?? []).map((inst) => {
    const key = inst.symbol.trim().toUpperCase();
    let px: number | null = null;
    if (live) {
      for (const [sym, price] of Array.from(live.entries())) {
        if (sym.trim().toUpperCase() === key) {
          px = price;
          break;
        }
      }
    }
    return instrumentToRow(inst, "approved", px, px != null ? freshness : "book");
  });

  let proposedRows: CustomerInstrumentRow[] = [];
  if (draft) {
    const proposed = buildInstrumentsFromDraft(draft);
    proposedRows = proposed.map((inst) => instrumentToRow(inst, "proposed", null, "unavailable"));
  }

  const hasProposedDiff =
    !!draft &&
    !setsEqual(draftSymbolSet(draft), approvedSymbolSet(pf)) &&
    proposedRows.length > 0;

  const allocations = (pf?.allocations ?? []).map((a) => ({
    assetClass: a.assetClass,
    weight: a.weight,
  }));
  const allocationTotalPct = allocations.reduce((s, a) => s + (Number(a.weight) || 0), 0);

  const valueRows = approvedRows.length ? approvedRows : proposedRows;
  let portfolioValueWon: number | null = null;
  let portfolioValueComplete = true;
  if (valueRows.length) {
    let sum = 0;
    for (const row of valueRows) {
      if (row.allocationAmountWon == null || !Number.isFinite(row.allocationAmountWon)) {
        portfolioValueComplete = false;
        continue;
      }
      sum += row.allocationAmountWon;
    }
    portfolioValueWon = sum;
    if (!portfolioValueComplete && sum === 0) portfolioValueWon = null;
  }

  const metricsOk = portfolioHasDisplayableMetrics(pf);
  const cashFlows = client.cashFlows ?? [];
  const recurringIn = cashFlows
    .filter((f) => f.recurring && f.amount > 0)
    .reduce((s, f) => s + f.amount, 0);
  const recurringOut = cashFlows
    .filter((f) => f.recurring && f.amount < 0)
    .reduce((s, f) => s + Math.abs(f.amount), 0);
  const cashflowMonthlyNetWon = cashFlows.length ? recurringIn - recurringOut : null;

  return {
    reviewStatus: review.status,
    reviewLabelKo: review.labelKo,
    investableWon: input.investableWon ?? null,
    portfolioLabel: pf?.label ?? null,
    expectedReturnPct: metricsOk ? pf!.expectedReturn : null,
    expectedRiskPct:
      metricsOk && pf!.expectedRisk != null && Number.isFinite(pf!.expectedRisk)
        ? pf!.expectedRisk
        : null,
    metricsLabelKo: metricsOk
      ? pf!.expectedRisk != null && Number.isFinite(pf!.expectedRisk)
        ? `수익 ${formatPercent1(pf!.expectedReturn)} · 변동성 ${formatPercent1(pf!.expectedRisk)}`
        : `수익 ${formatPercent1(pf!.expectedReturn)}`
      : isLegacyIncompletePortfolio(pf)
        ? "확인 필요"
        : "산출 전",
    instruments: approvedRows,
    allocations,
    allocationTotalPct,
    proposedInstruments: hasProposedDiff ? proposedRows : [],
    hasProposedDiff,
    portfolioValueWon,
    portfolioValueComplete,
    cashflowMonthlyNetWon,
    legacyIncomplete: isLegacyIncompletePortfolio(pf),
  };
}
