/**
 * 고객 Book·보유종목 공통 미실현 수익률.
 * 개별 종목 %를 평균하지 않고, KRW 환산 (시가합 − 취득원가합) / 취득원가합 × 100.
 */

export type BookLossTag = "손실중" | "관리필요";

export type PortfolioReturnStatus = "ok" | "incomplete" | "unavailable";

export interface ValuedHoldingInput {
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  currency: string;
  /** 평가에서 제외(부동산 등) */
  exclude?: boolean;
}

export interface PortfolioReturnResult {
  status: PortfolioReturnStatus;
  /** status === "ok" 일 때만 유한 숫자 */
  returnPct: number | null;
  marketValueKrw: number | null;
  acquisitionCostKrw: number | null;
  unrealizedPnlKrw: number | null;
  missingQuoteCount: number;
  /** Book 태그 컬럼용 — incomplete/unavailable 이면 null */
  lossTag: BookLossTag | null;
  note: string | null;
}

export type AumWeightedReturnStatus = "ok" | "incomplete" | "unavailable";

export interface AumWeightedReturnInput {
  clientId: string;
  aumKrw: number;
  returnStatus: PortfolioReturnStatus | null | undefined;
  returnPct: number | null | undefined;
}

export interface AumWeightedReturnResult {
  status: AumWeightedReturnStatus;
  returnPct: number | null;
  totalPnlKrw: number | null;
  totalAumKrw: number;
  coveredAumKrw: number;
  coveragePct: number;
  missingClientCount: number;
  note: string;
}

export function toKrw(amountLocal: number, currency: string, fxUsdKrw: number): number {
  const c = (currency || "KRW").toUpperCase();
  if (c === "USD") return amountLocal * fxUsdKrw;
  return amountLocal;
}

/**
 * -10% < return <= -5% → 손실중
 * return <= -10% → 관리필요
 * return > -5% → 태그 없음
 * 정확히 -5%는 손실중, 정확히 -10%는 관리필요
 */
export function lossTagFromReturn(returnPct: number | null | undefined): BookLossTag | null {
  if (returnPct == null || !Number.isFinite(returnPct)) return null;
  if (returnPct <= -10) return "관리필요";
  if (returnPct <= -5) return "손실중";
  return null;
}

export function calcAumWeightedReturn(
  clients: AumWeightedReturnInput[],
): AumWeightedReturnResult {
  let totalAumKrw = 0;
  let coveredAumKrw = 0;
  let totalPnlKrw = 0;
  let missingClientCount = 0;

  for (const client of clients) {
    const aumKrw = Number.isFinite(client.aumKrw) && client.aumKrw > 0 ? client.aumKrw : 0;
    if (aumKrw <= 0) continue;
    totalAumKrw += aumKrw;

    if (client.returnStatus !== "ok" || client.returnPct == null || !Number.isFinite(client.returnPct)) {
      missingClientCount += 1;
      continue;
    }

    const clientPnlKrw = (aumKrw * client.returnPct) / 100;
    if (!Number.isFinite(clientPnlKrw)) {
      missingClientCount += 1;
      continue;
    }
    coveredAumKrw += aumKrw;
    totalPnlKrw += clientPnlKrw;
  }

  const coveragePct = totalAumKrw > 0 ? (coveredAumKrw / totalAumKrw) * 100 : 0;

  if (totalAumKrw <= 0) {
    return {
      status: "unavailable",
      returnPct: null,
      totalPnlKrw: null,
      totalAumKrw: 0,
      coveredAumKrw: 0,
      coveragePct: 0,
      missingClientCount: 0,
      note: "평가 가능한 운용자산 없음",
    };
  }

  if (missingClientCount > 0 || coveredAumKrw < totalAumKrw) {
    return {
      status: "incomplete",
      returnPct: null,
      totalPnlKrw: null,
      totalAumKrw,
      coveredAumKrw,
      coveragePct,
      missingClientCount,
      note: `시세 확인 필요 · AUM 커버리지 ${coveragePct.toFixed(1)}%`,
    };
  }

  const returnPct = (totalPnlKrw / totalAumKrw) * 100;
  const safeReturnPct = Number.isFinite(returnPct) ? returnPct : null;
  const safeTotalPnlKrw = Number.isFinite(totalPnlKrw) ? totalPnlKrw : null;
  if (safeReturnPct == null || safeTotalPnlKrw == null) {
    return {
      status: "unavailable",
      returnPct: null,
      totalPnlKrw: null,
      totalAumKrw,
      coveredAumKrw,
      coveragePct,
      missingClientCount: clients.filter((client) => (Number.isFinite(client.aumKrw) ? client.aumKrw : 0) > 0).length,
      note: "평가 가능한 운용자산 없음",
    };
  }

  return {
    status: "ok",
    returnPct: safeReturnPct,
    totalPnlKrw: safeTotalPnlKrw,
    totalAumKrw,
    coveredAumKrw,
    coveragePct: 100,
    missingClientCount: 0,
    note: `평가손익 ${Math.round(safeTotalPnlKrw).toLocaleString("ko-KR")}원 · ${Math.round(totalAumKrw).toLocaleString("ko-KR")}원 기준`,
  };
}

export function calcPortfolioUnrealizedReturn(
  holdings: ValuedHoldingInput[],
  fxUsdKrw: number,
): PortfolioReturnResult {
  const tracked = holdings.filter((h) => !h.exclude && Number.isFinite(h.quantity) && h.quantity > 0);

  if (tracked.length === 0) {
    return {
      status: "unavailable",
      returnPct: null,
      marketValueKrw: null,
      acquisitionCostKrw: null,
      unrealizedPnlKrw: null,
      missingQuoteCount: 0,
      lossTag: null,
      note: "추적 보유종목 없음",
    };
  }

  let acquisitionCostKrw = 0;
  let marketValueKrw = 0;
  let missingQuoteCount = 0;
  let hasZeroCost = false;

  for (const h of tracked) {
    if (h.avgPrice == null || !Number.isFinite(h.avgPrice) || h.avgPrice <= 0) {
      hasZeroCost = true;
      continue;
    }
    acquisitionCostKrw += toKrw(h.quantity * h.avgPrice, h.currency, fxUsdKrw);

    if (h.lastPrice == null || !Number.isFinite(h.lastPrice) || h.lastPrice <= 0) {
      missingQuoteCount += 1;
      continue;
    }
    marketValueKrw += toKrw(h.quantity * h.lastPrice, h.currency, fxUsdKrw);
  }

  if (hasZeroCost || acquisitionCostKrw <= 0) {
    return {
      status: "unavailable",
      returnPct: null,
      marketValueKrw: missingQuoteCount === tracked.length ? null : marketValueKrw,
      acquisitionCostKrw: acquisitionCostKrw > 0 ? acquisitionCostKrw : null,
      unrealizedPnlKrw: null,
      missingQuoteCount,
      lossTag: null,
      note: "취득원가 부족으로 총수익률을 계산할 수 없음",
    };
  }

  if (missingQuoteCount > 0) {
    return {
      status: "incomplete",
      returnPct: null,
      marketValueKrw: null,
      acquisitionCostKrw,
      unrealizedPnlKrw: null,
      missingQuoteCount,
      lossTag: null,
      note: `시세 미확인 ${missingQuoteCount}종목 — 총수익률 미확정`,
    };
  }

  const unrealizedPnlKrw = marketValueKrw - acquisitionCostKrw;
  const returnPct = (unrealizedPnlKrw / acquisitionCostKrw) * 100;

  return {
    status: "ok",
    returnPct,
    marketValueKrw,
    acquisitionCostKrw,
    unrealizedPnlKrw,
    missingQuoteCount: 0,
    lossTag: lossTagFromReturn(returnPct),
    note: null,
  };
}
