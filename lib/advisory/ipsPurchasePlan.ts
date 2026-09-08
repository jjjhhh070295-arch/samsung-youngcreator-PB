/**
 * IPS 확정 시 지정가(designatedPrice) 기반 매수 수량 산출.
 * 브로커 주문은 내지 않으며, 가정 취득단가·수량만 계산한다.
 */

import type { ManualAssetClass, ManualPortfolioDraft, ManualSelectedInstrument } from "../manualPortfolioDraft";

export type QuotationKind = "share" | "bond_face" | "unit";

export interface PurchasePlanLine {
  symbol: string;
  name: string;
  assetClass: ManualAssetClass;
  exchange: string;
  currency: string;
  kind: string;
  quotationKind: QuotationKind;
  /** 지정가 (현지통화) — IPS 확정 기준 가정 취득단가 */
  designatedPrice: number;
  /** 배정 예산(KRW) */
  allocatedBudgetKrw: number;
  /** 사용 FX (외화→KRW). KRW면 1 */
  fxRate: number;
  /** 버림 후 매수 수량 */
  quantity: number;
  /** 실제 매수 원가(현지통화) = quantity * designatedPrice */
  purchaseCostLocal: number;
  /** 실제 매수 원가(KRW) */
  purchaseCostKrw: number;
  /** 예산 잔여(KRW) — 현금으로 유지 */
  remainderKrw: number;
  quantityIncrement: number;
  faceValue: number | null;
  portfolioWeightPct: number;
}

export interface PurchasePlanResult {
  ok: boolean;
  lines: PurchasePlanLine[];
  totalPurchaseKrw: number;
  totalRemainderKrw: number;
  errors: string[];
}

const SEARCHABLE: ManualAssetClass[] = [
  "domesticEquity",
  "globalEquity",
  "domesticBond",
  "globalBond",
  "alternatives",
];

function inferQuotationKind(item: ManualSelectedInstrument): QuotationKind {
  if (item.quotationKind) return item.quotationKind;
  const kind = (item.kind || "").toLowerCase();
  if (item.assetClass === "domesticBond" || item.assetClass === "globalBond" || kind.includes("bond")) {
    return "bond_face";
  }
  if (kind.includes("wrap") || kind.includes("trust") || kind.includes("els") || kind.includes("elb")) {
    return "unit";
  }
  return "share";
}

function defaultIncrement(kind: QuotationKind): number {
  if (kind === "share") return 1;
  if (kind === "bond_face") return 1;
  return 0.0001;
}

export function floorToIncrement(rawQty: number, increment: number): number {
  if (!Number.isFinite(rawQty) || rawQty <= 0) return 0;
  if (!Number.isFinite(increment) || increment <= 0) return Math.floor(rawQty);
  return Math.floor(rawQty / increment) * increment;
}

export function buildIpsPurchasePlan(
  draft: ManualPortfolioDraft,
  opts: {
    investableWon: number;
    fxUsdKrw: number;
  },
): PurchasePlanResult {
  const errors: string[] = [];
  const lines: PurchasePlanLine[] = [];
  const investable = Math.max(0, opts.investableWon || 0);
  const fx = opts.fxUsdKrw > 0 ? opts.fxUsdKrw : 1350;

  if (investable <= 0) {
    return { ok: false, lines: [], totalPurchaseKrw: 0, totalRemainderKrw: 0, errors: ["투자가능자산이 없습니다."] };
  }

  for (const assetClass of SEARCHABLE) {
    const classWeight = Number(draft.allocation[assetClass]) || 0;
    if (classWeight <= 0) continue;
    const items = draft.selected.filter((row) => row.assetClass === assetClass);
    for (const item of items) {
      const within = Number(item.weightWithinClass) || 0;
      if (within <= 0) continue;

      const portfolioWeightPct = (classWeight * within) / 100;
      const allocatedBudgetKrw = (investable * portfolioWeightPct) / 100;
      const price = item.designatedPrice;
      const currency = (item.currency || "KRW").toUpperCase();
      const exchange = item.exchange || inferExchange(assetClass, currency);
      const quotationKind = inferQuotationKind(item);
      const increment = item.quantityIncrement && item.quantityIncrement > 0
        ? item.quantityIncrement
        : defaultIncrement(quotationKind);
      const faceValue = item.faceValue ?? (quotationKind === "bond_face" ? 10_000 : null);

      if (price == null || !Number.isFinite(price) || price <= 0) {
        errors.push(`${item.name}(${item.symbol}): 지정가가 필요합니다.`);
        continue;
      }
      if (quotationKind === "bond_face" && (faceValue == null || faceValue <= 0)) {
        errors.push(`${item.name}(${item.symbol}): 채권 액면가 입력이 필요합니다.`);
        continue;
      }

      const fxRate = currency === "USD" ? (item.fxRate && item.fxRate > 0 ? item.fxRate : fx) : 1;
      const budgetLocal = currency === "USD" ? allocatedBudgetKrw / fxRate : allocatedBudgetKrw;

      let unitCostLocal = price;
      if (quotationKind === "bond_face" && faceValue) {
        // 지정가가 액면 100당 가격(%)이면 단위원가 = face * price/100
        // 카탈로그 채권은 대개 절대가격이 없으므로, price가 200 이하면 % 호가로 본다.
        unitCostLocal = price <= 200 ? (faceValue * price) / 100 : price;
      }

      const rawQty = unitCostLocal > 0 ? budgetLocal / unitCostLocal : 0;
      const quantity =
        item.plannedQuantity != null && Number.isFinite(item.plannedQuantity) && item.plannedQuantity >= 0
          ? floorToIncrement(item.plannedQuantity, increment)
          : floorToIncrement(rawQty, increment);

      const purchaseCostLocal = quantity * unitCostLocal;
      const purchaseCostKrw = currency === "USD" ? purchaseCostLocal * fxRate : purchaseCostLocal;
      const remainderKrw = Math.max(0, allocatedBudgetKrw - purchaseCostKrw);

      if (quantity > 0) {
        lines.push({
          symbol: item.symbol,
          name: item.name,
          assetClass,
          exchange,
          currency,
          kind: item.kind || quotationKind,
          quotationKind,
          designatedPrice: price,
          allocatedBudgetKrw,
          fxRate,
          quantity,
          purchaseCostLocal,
          purchaseCostKrw,
          remainderKrw,
          quantityIncrement: increment,
          faceValue,
          portfolioWeightPct,
        });
      } else if (allocatedBudgetKrw > 0) {
        errors.push(`${item.name}(${item.symbol}): 배정 예산으로 매수 가능 수량이 없습니다. 지정가·증분을 확인하세요.`);
      }
    }
  }

  const totalPurchaseKrw = lines.reduce((s, l) => s + l.purchaseCostKrw, 0);
  const totalRemainderKrw = lines.reduce((s, l) => s + l.remainderKrw, 0);

  return {
    ok: errors.length === 0,
    lines,
    totalPurchaseKrw,
    totalRemainderKrw,
    errors,
  };
}

export function holdingMatchKey(
  symbol: string,
  exchange: string,
  currency: string,
  assetClass?: string,
): string {
  return [
    (symbol || "").trim().toUpperCase(),
    (exchange || "").trim().toUpperCase(),
    (currency || "KRW").trim().toUpperCase(),
    assetClass || "",
  ].join("|");
}

function inferExchange(assetClass: ManualAssetClass, currency: string): string {
  if (assetClass === "domesticEquity" || assetClass === "domesticBond") return "KRX";
  if (currency === "USD") return "NASDAQ";
  return "OTC";
}

/** 가중 평균 취득단가 */
export function weightedAveragePrice(
  existingQty: number,
  existingAvg: number | null,
  buyQty: number,
  buyPrice: number,
): number {
  const eq = Math.max(0, existingQty);
  const bq = Math.max(0, buyQty);
  if (bq <= 0) return existingAvg ?? buyPrice;
  if (eq <= 0 || existingAvg == null || !Number.isFinite(existingAvg)) return buyPrice;
  return (eq * existingAvg + bq * buyPrice) / (eq + bq);
}
