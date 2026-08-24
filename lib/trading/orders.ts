import {
  assertLiveOrderAllowed,
  getKisConfig,
  isLiveTradingEnabled,
  LIVE_ORDER_TR,
  ORD_DVSN_AFTER_CLOSE,
  ORD_DVSN_LIMIT,
} from "@/lib/kis/config";
import type {
  KisOrderResponse,
  LimitOrdDvsn,
  OrderIntent,
  OrderIntentStatus,
  OrderPreviewResult,
  PreviewOrderInput,
  PreviewOrderResult,
} from "./types";

type FetchImpl = typeof fetch;

export interface PlaceOrderDeps {
  fetchImpl?: FetchImpl;
}

const idempotencyStore = new Map<string, OrderIntent>();
const orderStore = new Map<string, OrderIntent>();

let dailyOrderWon = 0;
let dailyOrderDate = "";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyIfNeeded(): void {
  const today = todayKey();
  if (dailyOrderDate !== today) {
    dailyOrderDate = today;
    dailyOrderWon = 0;
  }
}

function newId(): string {
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAllowedOrdDvsn(value: string): value is LimitOrdDvsn {
  return value === ORD_DVSN_LIMIT || value === ORD_DVSN_AFTER_CLOSE;
}

export function validateLimitCashOrder(input: PreviewOrderInput): PreviewOrderResult {
  const config = getKisConfig();

  if (!input.symbol?.trim()) {
    return { ok: false, error: "symbol is required", code: "INVALID_SYMBOL" };
  }
  if (input.side !== "buy" && input.side !== "sell") {
    return { ok: false, error: "only buy/sell cash orders supported", code: "INVALID_SIDE" };
  }
  if (!isAllowedOrdDvsn(input.ordDvsn)) {
    return {
      ok: false,
      error: `only limit cash ord_dvsn ${ORD_DVSN_LIMIT} or ${ORD_DVSN_AFTER_CLOSE} allowed`,
      code: "INVALID_ORD_DVSN",
    };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, error: "quantity must be an integer >= 1", code: "INVALID_QTY" };
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return { ok: false, error: "price must be > 0", code: "INVALID_PRICE" };
  }
  if (input.quantity < 0) {
    return { ok: false, error: "short selling is not supported", code: "NO_SHORT" };
  }

  const estimatedWon = input.quantity * input.price;
  if (estimatedWon > config.maxOrderWon) {
    return {
      ok: false,
      error: `order exceeds KIS_MAX_ORDER_WON (${config.maxOrderWon})`,
      code: "MAX_ORDER_WON",
    };
  }

  resetDailyIfNeeded();
  if (dailyOrderWon + estimatedWon > config.maxDailyOrderWon) {
    return {
      ok: false,
      error: `daily order limit exceeded (${config.maxDailyOrderWon})`,
      code: "MAX_DAILY_ORDER_WON",
    };
  }

  return {
    ok: true,
    preview: {
      symbol: input.symbol.trim(),
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      ordDvsn: input.ordDvsn,
      estimatedWon,
      maxOrderWon: config.maxOrderWon,
    },
  };
}

export function previewOrder(input: PreviewOrderInput): PreviewOrderResult {
  if (!isLiveTradingEnabled()) {
    return { ok: false, error: "KIS live trading is disabled", code: "LIVE_DISABLED" };
  }
  return validateLimitCashOrder(input);
}

export type { RegimeGateInput, RegimeGateResult } from "./regimeGate";
export { enforceRegimeBuyGate } from "./regimeGate";

function buildKisOrderBody(input: PreviewOrderInput) {
  const config = getKisConfig();
  return {
    CANO: config.cano,
    ACNT_PRDT_CD: config.acntPrdtCd,
    PDNO: input.symbol.trim(),
    ORD_DVSN: input.ordDvsn,
    ORD_QTY: String(input.quantity),
    ORD_UNPR: String(Math.round(input.price)),
  };
}

async function callKisOrder(
  input: PreviewOrderInput,
  fetchImpl: FetchImpl,
): Promise<KisOrderResponse> {
  const config = getKisConfig();
  const trId = input.side === "buy" ? LIVE_ORDER_TR.buy : LIVE_ORDER_TR.sell;
  const url = `${config.baseUrl}/uapi/domestic-stock/v1/trading/order-cash`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      tr_id: trId,
      custtype: "P",
    },
    body: JSON.stringify(buildKisOrderBody(input)),
    cache: "no-store",
  });

  const json = (await res.json()) as KisOrderResponse;
  if (!res.ok || json.rt_cd !== "0") {
    throw new Error(json.msg1 ?? `KIS order failed (${res.status})`);
  }
  return json;
}

export interface PlaceOrderParams extends PreviewOrderInput {
  userId: string;
}

export async function placeOrderViaKis(
  params: PlaceOrderParams,
  deps: PlaceOrderDeps = {},
): Promise<OrderIntent> {
  if (!isLiveTradingEnabled()) {
    throw new Error("KIS live trading is disabled");
  }

  assertLiveOrderAllowed();

  const preview = validateLimitCashOrder(params);
  if (!preview.ok) {
    throw new Error(preview.error);
  }

  const idempotencyKey = params.idempotencyKey?.trim() || newId();
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing) {
    throw new DuplicateOrderError(existing);
  }

  const now = new Date().toISOString();
  const pending: OrderIntent = {
    id: newId(),
    idempotencyKey,
    userId: params.userId,
    symbol: params.symbol.trim(),
    side: params.side,
    quantity: params.quantity,
    price: params.price,
    ordDvsn: params.ordDvsn,
    status: "submitted",
    strategyId: params.strategyId,
    filledQuantity: 0,
    createdAt: now,
    updatedAt: now,
  };

  idempotencyStore.set(idempotencyKey, pending);
  orderStore.set(pending.id, pending);

  try {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const response = await callKisOrder(params, fetchImpl);
    pending.kisOrderNo = response.output?.ODNO;
    pending.kisOrgOrderNo = response.output?.KRX_FWDG_ORD_ORGNO;
    pending.status = "accepted";
    pending.updatedAt = new Date().toISOString();

    resetDailyIfNeeded();
    dailyOrderWon += params.quantity * params.price;
  } catch (error) {
    pending.status = "failed";
    pending.error = error instanceof Error ? error.message : String(error);
    pending.updatedAt = new Date().toISOString();
    throw error;
  }

  return { ...pending };
}

export class DuplicateOrderError extends Error {
  readonly existing: OrderIntent;

  constructor(existing: OrderIntent) {
    super("Duplicate idempotency key — order already submitted.");
    this.name = "DuplicateOrderError";
    this.existing = existing;
  }
}

export function getOrderById(orderId: string): OrderIntent | null {
  return orderStore.get(orderId) ?? null;
}

export function listOrdersForUser(userId: string): OrderIntent[] {
  return Array.from(orderStore.values())
    .filter((order) => order.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function applyPartialFill(orderId: string, filledQuantity: number): OrderIntent | null {
  const order = orderStore.get(orderId);
  if (!order) return null;

  const qty = Math.min(Math.max(0, filledQuantity), order.quantity);
  order.filledQuantity = qty;
  order.status = qty >= order.quantity ? "filled" : qty > 0 ? "partially_filled" : order.status;
  order.updatedAt = new Date().toISOString();
  orderStore.set(orderId, order);
  idempotencyStore.set(order.idempotencyKey, order);
  return { ...order };
}

export async function cancelOrderViaKis(
  orderId: string,
  deps: PlaceOrderDeps = {},
): Promise<OrderIntent> {
  if (!isLiveTradingEnabled()) {
    throw new Error("KIS live trading is disabled");
  }
  assertLiveOrderAllowed();

  const order = orderStore.get(orderId);
  if (!order) throw new Error("Order not found");
  if (!order.kisOrderNo || !order.kisOrgOrderNo) {
    throw new Error("Order missing KIS identifiers for cancel");
  }

  const config = getKisConfig();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = `${config.baseUrl}/uapi/domestic-stock/v1/trading/order-rvsecncl`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      tr_id: LIVE_ORDER_TR.cancel,
      custtype: "P",
    },
    body: JSON.stringify({
      CANO: config.cano,
      ACNT_PRDT_CD: config.acntPrdtCd,
      KRX_FWDG_ORD_ORGNO: order.kisOrgOrderNo,
      ORGN_ODNO: order.kisOrderNo,
      ORD_DVSN: order.ordDvsn,
      RVSE_CNCL_DVSN_CD: "02",
      ORD_QTY: "0",
      ORD_UNPR: "0",
      QTY_ALL_ORD_YN: "Y",
    }),
    cache: "no-store",
  });

  const json = (await res.json()) as KisOrderResponse;
  if (!res.ok || json.rt_cd !== "0") {
    throw new Error(json.msg1 ?? `KIS cancel failed (${res.status})`);
  }

  order.status = "cancelled";
  order.updatedAt = new Date().toISOString();
  orderStore.set(orderId, order);
  return { ...order };
}

/** Test helper — reset in-memory stores. */
export function resetTradingStoresForTests(): void {
  idempotencyStore.clear();
  orderStore.clear();
  dailyOrderWon = 0;
  dailyOrderDate = "";
}

export function recordOrderStatusForTests(orderId: string, status: OrderIntentStatus): void {
  const order = orderStore.get(orderId);
  if (!order) return;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  orderStore.set(orderId, order);
}
