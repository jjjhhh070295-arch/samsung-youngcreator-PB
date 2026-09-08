/**
 * 포트폴리오 승인 시 초안 → 확정 구성 스냅샷.
 * 종목 상세·비중·배정금액을 parties.portfolios 에 박제한다.
 */

import type { ManualAssetClass, ManualPortfolioDraft, ManualSelectedInstrument } from "../manualPortfolioDraft";
import type { ApprovedInstrument, AssetAllocation, Portfolio, PortfolioMetricsStatus } from "../types";
import { floorToIncrement, requiresMarketQuote } from "./ipsPurchasePlan";

const LABEL_MAP: Record<ManualAssetClass, string> = {
  domesticEquity: "국내주식",
  globalEquity: "해외주식",
  domesticBond: "국내채권",
  globalBond: "해외채권",
  alternatives: "상품·대체",
  cash: "현금성",
};

const SEARCHABLE: ManualAssetClass[] = [
  "domesticEquity",
  "globalEquity",
  "domesticBond",
  "globalBond",
  "alternatives",
];

export function assetClassLabel(key: string): string {
  return LABEL_MAP[key as ManualAssetClass] ?? key;
}

export function buildAllocationsFromDraft(draft: ManualPortfolioDraft): AssetAllocation[] {
  const source = draft.finalAllocation ?? draft.allocation;
  return (Object.entries(source) as [ManualAssetClass, number][])
    .filter(([, weight]) => Number(weight) > 0)
    .map(([assetClass, weight]) => ({
      assetClass: assetClassLabel(assetClass),
      weight: Number(weight),
    }));
}

/**
 * 승인 시점 종목 스냅샷.
 * quantity/price 는 미리보기 추정치일 수 있으며, IPS 확정 시 KIS 스냅샷으로 갱신 가능.
 * 실주문이 아님을 bookkeepingNote 로 명시한다.
 */
export function buildInstrumentsFromDraft(
  draft: ManualPortfolioDraft,
  opts?: {
    priceBySymbol?: Map<string, number>;
    fxUsdKrw?: number;
  },
): ApprovedInstrument[] {
  const allocatable = Math.max(0, draft.allocatableWon ?? 0);
  const investable = Math.max(0, draft.investableWon ?? 0);
  const allocationScale = investable > 0 ? allocatable / investable : 0;
  const fx = opts?.fxUsdKrw && opts.fxUsdKrw > 0 ? opts.fxUsdKrw : 1350;
  const instruments: ApprovedInstrument[] = [];

  for (const assetClass of SEARCHABLE) {
    const allocPct = Number(draft.allocation[assetClass]) || 0;
    if (allocPct <= 0) continue;
    const items = draft.selected.filter((row) => row.assetClass === assetClass);
    for (const item of items) {
      const within = Number(item.weightWithinClass) || 0;
      if (within <= 0) continue;
      const totalWeightPct = allocPct * allocationScale * (within / 100);
      const allocationAmountWon = allocatable * (allocPct / 100) * (within / 100);
      const currency = (item.currency || "KRW").toUpperCase();
      const livePx = opts?.priceBySymbol?.get(item.symbol);
      const priceSnapshot = livePx != null && livePx > 0 ? livePx : null;
      let quantity: number | null = null;
      if (priceSnapshot != null && priceSnapshot > 0 && allocationAmountWon > 0) {
        const budgetLocal = currency === "USD" ? allocationAmountWon / fx : allocationAmountWon;
        const increment = item.quantityIncrement && item.quantityIncrement > 0 ? item.quantityIncrement : 1;
        quantity = floorToIncrement(budgetLocal / priceSnapshot, increment);
      }

      instruments.push({
        symbol: item.symbol,
        name: item.name,
        assetClassKey: assetClass,
        assetClassLabel: assetClassLabel(assetClass),
        currency,
        exchange: item.exchange ?? null,
        kind: item.kind ?? null,
        quotationKind: item.quotationKind ?? null,
        weightWithinClass: within,
        totalWeightPct,
        allocationAmountWon,
        quantity,
        priceSnapshot,
        bookkeepingNote:
          "장부 반영용 구성입니다. 증권사 주문·체결이 아니며, IPS 확정 시 KIS 시세 스냅샷으로 수량을 산출합니다.",
      });
    }
  }

  return instruments.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function newCompositionRevision(): string {
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildApprovedPortfolio(input: {
  draft: ManualPortfolioDraft;
  previous?: Portfolio | null;
  expectedReturn: number | null;
  expectedRisk: number | null;
  metricsStatus: PortfolioMetricsStatus;
  priceBySymbol?: Map<string, number>;
  fxUsdKrw?: number;
}): Portfolio {
  const { draft, previous } = input;
  const allocations = buildAllocationsFromDraft(draft);
  const instruments = buildInstrumentsFromDraft(draft, {
    priceBySymbol: input.priceBySymbol,
    fxUsdKrw: input.fxUsdKrw,
  });
  const metricsOk = input.metricsStatus === "ok";
  return {
    id: previous?.id ?? `manual-${Date.now()}`,
    label: "맞춤 포트폴리오",
    allocations,
    instruments,
    compositionRevision: newCompositionRevision(),
    metricsStatus: input.metricsStatus,
    expectedReturn: metricsOk && input.expectedReturn != null ? input.expectedReturn : null,
    expectedRisk: metricsOk && input.expectedRisk != null ? input.expectedRisk : null,
    taxNote: "확정 구성 기준 참고",
    rationale: "PB가 승인한 자산군 배분과 편입 종목 구성",
    editedByPb: true,
    confirmedAt: new Date().toISOString(),
    referencedReports: previous?.referencedReports,
  };
}

/** 레거시: 승인됐으나 instruments 없음 → 재확인 필요 */
export function isLegacyIncompletePortfolio(pf: Portfolio | null | undefined): boolean {
  if (!pf) return false;
  if (pf.metricsStatus === "legacy_incomplete") return true;
  const hasAlloc = (pf.allocations?.length ?? 0) > 0;
  const hasInstruments = (pf.instruments?.length ?? 0) > 0;
  return hasAlloc && !hasInstruments;
}

export function portfolioHasDisplayableMetrics(pf: Portfolio | null | undefined): boolean {
  if (!pf) return false;
  if (pf.metricsStatus === "unavailable" || pf.metricsStatus === "legacy_incomplete") return false;
  return (
    pf.metricsStatus === "ok" &&
    pf.expectedReturn != null &&
    Number.isFinite(pf.expectedReturn) &&
    pf.expectedRisk != null &&
    Number.isFinite(pf.expectedRisk)
  );
}

/** 초안 종목이 승인 스냅샷과 같은 심볼 집합인지 (레거시 복구용) */
export function draftMatchesApprovedInstruments(
  draft: ManualPortfolioDraft | null,
  pf: Portfolio | null | undefined,
): boolean {
  if (!draft || !pf?.instruments?.length) return false;
  const draftSyms = new Set(
    draft.selected
      .filter((s) => (Number(s.weightWithinClass) || 0) > 0)
      .map((s) => s.symbol.trim().toUpperCase()),
  );
  const approvedSyms = new Set(pf.instruments.map((i) => i.symbol.trim().toUpperCase()));
  if (draftSyms.size !== approvedSyms.size) return false;
  for (const s of Array.from(draftSyms)) {
    if (!approvedSyms.has(s)) return false;
  }
  return true;
}

export function selectedRequiresQuotes(selected: ManualSelectedInstrument[]): boolean {
  return selected.some((row) => (Number(row.weightWithinClass) || 0) > 0 && requiresMarketQuote(row));
}

/**
 * 승인된 종목 스냅샷에 KIS 시세·수량을 반영한다.
 * compositionRevision·비중·심볼 집합은 유지하고, 가격·수량만 갱신한다.
 */
export function stampApprovedInstrumentsWithQuotes(
  portfolio: Portfolio,
  opts: {
    priceBySymbol: Map<string, number>;
    fxUsdKrw: number;
  },
): Portfolio {
  const instruments = (portfolio.instruments ?? []).map((inst) => {
    const key = inst.symbol.trim().toUpperCase();
    let priceSnapshot: number | null = null;
    for (const [sym, px] of Array.from(opts.priceBySymbol.entries())) {
      if (sym.trim().toUpperCase() === key && px > 0) {
        priceSnapshot = px;
        break;
      }
    }
    let quantity = inst.quantity;
    const amount = inst.allocationAmountWon;
    if (priceSnapshot != null && amount != null && amount > 0) {
      const currency = (inst.currency || "KRW").toUpperCase();
      const budgetLocal = currency === "USD" ? amount / opts.fxUsdKrw : amount;
      quantity = floorToIncrement(budgetLocal / priceSnapshot, 1);
    }
    return {
      ...inst,
      priceSnapshot: priceSnapshot ?? inst.priceSnapshot,
      quantity,
      bookkeepingNote:
        "장부 반영용 구성입니다. 증권사 주문·체결이 아니며, KIS 시세 스냅샷으로 수량을 산출했습니다.",
    };
  });
  return { ...portfolio, instruments };
}

/**
 * 레거시(종목 없음)인데 초안 심볼이 승인 해시 시점과 일치할 때만 복구.
 * 호출부에서 draftMatches + 승인 해시 일치을 확인한 뒤 사용한다.
 */
export function recoverInstrumentsFromMatchingDraft(
  portfolio: Portfolio,
  draft: ManualPortfolioDraft,
  opts?: { priceBySymbol?: Map<string, number>; fxUsdKrw?: number },
): Portfolio {
  const instruments = buildInstrumentsFromDraft(draft, opts);
  return {
    ...portfolio,
    instruments,
    metricsStatus: portfolio.metricsStatus === "legacy_incomplete" ? "unavailable" : portfolio.metricsStatus,
    compositionRevision: portfolio.compositionRevision ?? newCompositionRevision(),
  };
}
