export type OrderSide = "buy" | "sell";

/** Allowed limit order division codes (cash account). */
export type LimitOrdDvsn = "00" | "06";

export type OrderIntentStatus =
  | "preview"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "cancelled"
  | "rejected"
  | "failed";

export interface PreviewOrderInput {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  ordDvsn: LimitOrdDvsn;
  idempotencyKey?: string;
  strategyId?: string;
  /** KRX | NXT | SOR */
  excgIdDvsnCd?: "KRX" | "NXT" | "SOR";
  nxtEligible?: boolean;
}

export interface OrderIntent {
  id: string;
  idempotencyKey: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  /** 매수가능수량에 맞춰 축소되기 전 최초 요청 수량 */
  requestedQuantity?: number;
  price: number;
  ordDvsn: LimitOrdDvsn;
  status: OrderIntentStatus;
  strategyId?: string;
  kisOrderNo?: string;
  kisOrgOrderNo?: string;
  filledQuantity: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface OrderPreviewResult {
  ok: true;
  preview: {
    symbol: string;
    side: OrderSide;
    quantity: number;
    price: number;
    ordDvsn: LimitOrdDvsn;
    estimatedWon: number;
    maxOrderWon: number;
    exchange?: string;
  };
}

export interface OrderValidationError {
  ok: false;
  error: string;
  code?: string;
}

export type PreviewOrderResult = OrderPreviewResult | OrderValidationError;

export interface KisOrderResponse {
  output?: {
    KRX_FWDG_ORD_ORGNO?: string;
    ODNO?: string;
    ORD_TMD?: string;
  };
  rt_cd?: string;
  msg1?: string;
}

export interface TraderUser {
  id: string;
  role: "trader" | "admin" | "viewer";
  email?: string;
}
