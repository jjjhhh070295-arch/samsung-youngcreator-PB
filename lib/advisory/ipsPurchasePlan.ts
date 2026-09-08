/**
 * IPS 확정 시 KIS(또는 지원 시세) 스냅샷 기반 매수 수량 산출.
 * 브로커 주문은 내지 않으며, 장부용 가정 취득단가·수량만 계산한다.
 * designatedPrice / plannedQuantity 는 무시한다(레거시 초안 호환).
 */

import type { ManualAssetClass, ManualPortfolioDraft, ManualSelectedInstrument } from "../manualPortfolioDraft";
import { resolveInstrumentForPricing, symbolsEquivalent } from "../pricing/instrumentIdentity";

export type QuotationKind = "share" | "bond_face" | "unit";

/** 확정에 사용한 시세 스냅샷 — 취득원가 근거 */
export interface PriceSnapshot {
  symbol: string;
  providerSymbol: string;
  price: number;
  currency: string;
  source: string;
  fetchedAt: string;
  quoteTime: string | null;
  isLive: boolean;
}

export interface PurchasePlanLine {
  symbol: string;
  name: string;
  assetClass: ManualAssetClass;
  exchange: string;
  currency: string;
  kind: string;
  quotationKind: QuotationKind;
  /** @deprecated 호환 — snapshotPrice 와 동일 */
  designatedPrice: number;
  /** 확정에 사용한 시세(현지통화) */
  snapshotPrice: number;
  priceSnapshot: PriceSnapshot;
  allocatedBudgetKrw: number;
  fxRate: number;
  quantity: number;
  purchaseCostLocal: number;
  purchaseCostKrw: number;
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

function findSnapshot(
  snapshots: PriceSnapshot[],
  symbol: string,
  currency: string,
): PriceSnapshot | undefined {
  return snapshots.find((s) => symbolsEquivalent(s.symbol, symbol, currency));
}

/** 상장 주식·ETF 등 KIS 시세가 필수인 행 */
export function requiresMarketQuote(item: ManualSelectedInstrument): boolean {
  const qk = inferQuotationKind(item);
  if (qk === "bond_face") {
    // 채권 ETF/ETN 은 share 로 들어오는 경우가 많다. bond_face 직접채권은 시세 엔드포인트 금지.
    const kind = (item.kind || "").toLowerCase();
    if (kind.includes("etf") || kind.includes("etn")) return true;
    return false;
  }
  if (qk === "unit") return false;
  const resolved = resolveInstrumentForPricing(item.symbol, item.currency || "KRW");
  return resolved.venue !== "unsupported";
}

/**
 * @param availableFundsWon 신규 배분 가능 자금(allocatableWon). 0 은 유효한 값(매수 없음).
 */
export function buildIpsPurchasePlan(
  draft: ManualPortfolioDraft,
  opts: {
    /** @deprecated use availableFundsWon */
    investableWon?: number;
    availableFundsWon?: number;
    fxUsdKrw: number;
    /** KIS 등에서 받은 확정용 스냅샷. 레거시 지정가/검색가는 사용하지 않는다. */
    priceSnapshots?: PriceSnapshot[];
  },
): PurchasePlanResult {
  const errors: string[] = [];
  const lines: PurchasePlanLine[] = [];
  const available =
    opts.availableFundsWon != null
      ? Math.max(0, opts.availableFundsWon)
      : Math.max(0, opts.investableWon || 0);
  const fx = opts.fxUsdKrw > 0 ? opts.fxUsdKrw : 1350;
  const snapshots = opts.priceSnapshots ?? [];

  // 0원 배분은 "데이터 없음"이 아니라 매수 없음 — 전체 AUM 으로 폴백하지 않는다.
  if (available <= 0) {
    return { ok: true, lines: [], totalPurchaseKrw: 0, totalRemainderKrw: 0, errors: [] };
  }

  for (const assetClass of SEARCHABLE) {
    const classWeight = Number(draft.allocation[assetClass]) || 0;
    if (classWeight <= 0) continue;
    const items = draft.selected.filter((row) => row.assetClass === assetClass);
    for (const item of items) {
      const within = Number(item.weightWithinClass) || 0;
      if (within <= 0) continue;

      const portfolioWeightPct = (classWeight * within) / 100;
      const allocatedBudgetKrw = (available * portfolioWeightPct) / 100;
      const currency = (item.currency || "KRW").toUpperCase();
      const exchange = item.exchange || inferExchange(assetClass, currency);
      const quotationKind = inferQuotationKind(item);
      const increment =
        item.quantityIncrement && item.quantityIncrement > 0
          ? item.quantityIncrement
          : defaultIncrement(quotationKind);
      const faceValue = item.faceValue ?? (quotationKind === "bond_face" ? 10_000 : null);
      const needsQuote = requiresMarketQuote(item);

      let price: number | null = null;
      let snapshot: PriceSnapshot | null = null;

      if (needsQuote) {
        const hit = findSnapshot(snapshots, item.symbol, currency);
        if (!hit || !Number.isFinite(hit.price) || hit.price <= 0) {
          errors.push(`${item.name}(${item.symbol}): KIS 시세 스냅샷이 필요합니다.`);
          continue;
        }
        price = hit.price;
        snapshot = hit;
      } else if (quotationKind === "bond_face") {
        // 직접채권: 액면·호가(%) 관례. 검색/지정가 폴백 금지 — 초안에 명시된 face 기반만.
        // 카탈로그에서 넣은 price 가 %호가인 경우(<=200)만 허용.
        const catalogPx = item.price;
        if (catalogPx == null || !Number.isFinite(catalogPx) || catalogPx <= 0) {
          errors.push(`${item.name}(${item.symbol}): 직접채권 호가(시세)가 없어 확정할 수 없습니다.`);
          continue;
        }
        price = catalogPx;
        snapshot = {
          symbol: item.symbol,
          providerSymbol: item.symbol,
          price: catalogPx,
          currency,
          source: item.source || "bond_catalog",
          fetchedAt: item.asOf || new Date().toISOString(),
          quoteTime: item.asOf ?? null,
          isLive: false,
        };
      } else {
        errors.push(`${item.name}(${item.symbol}): 지원하지 않는 상품 유형입니다.`);
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
        unitCostLocal = price <= 200 ? (faceValue * price) / 100 : price;
      }

      // plannedQuantity / designatedPrice 는 더 이상 수량을 덮어쓰지 않는다.
      const rawQty = unitCostLocal > 0 ? budgetLocal / unitCostLocal : 0;
      const quantity = floorToIncrement(rawQty, increment);

      const purchaseCostLocal = quantity * unitCostLocal;
      const purchaseCostKrw = currency === "USD" ? purchaseCostLocal * fxRate : purchaseCostLocal;
      // 예산을 초과하지 않도록 잔여는 항상 >= 0
      const remainderKrw = Math.max(0, allocatedBudgetKrw - purchaseCostKrw);

      if (quantity > 0 && snapshot) {
        lines.push({
          symbol: item.symbol,
          name: item.name,
          assetClass,
          exchange,
          currency,
          kind: item.kind || quotationKind,
          quotationKind,
          designatedPrice: price,
          snapshotPrice: price,
          priceSnapshot: snapshot,
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
        errors.push(
          `${item.name}(${item.symbol}): 배정 예산으로 매수 가능 수량이 없습니다. 시세·증분을 확인하세요.`,
        );
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
