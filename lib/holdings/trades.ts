/**
 * 보유종목 거래 이력 — 매도 기록과 실현손익.
 *
 * ── 범위 (2단계까지 반영됨) ────────────────────────────────────────────────
 * 매도 1건이 이력·잔고·AUM 세 곳에 원자적으로 반영된다. 실제 쓰기는 전부
 * record_holding_sale RPC 안에서 일어난다(supabase-migration-holding-sale-rpc.sql).
 *
 *  · 이력 : client_holding_trades 에 append. 취득원가와 실현손익을 체결 시점 값으로 고정.
 *  · 잔고 : client_holdings.quantity 차감(0 이면 행 삭제). avg_price 는 바꾸지 않는다 —
 *           남은 수량의 취득원가는 그대로다. 평단이 바뀌는 것은 매수(가중평균)뿐이다.
 *  · AUM  : parties.asset_size += 실현손익.
 *
 * ── AUM 규칙: 시세로는 안 움직이고 확정된 거래로만 움직인다 ─────────────────
 * assetSize 는 여전히 "PB 가 입력한 확정 AUM"이고 시세 변동으로 자동으로 흔들리지 않는다.
 * 매도는 예외가 아니라 그 규칙이 적용되는 지점이다 — 체결가로 확정된 현금 흐름이기 때문이다.
 * 더하는 값이 매도대금이 아니라 실현손익인 이유도 같다. 매도대금이 계좌에 남으면 주식이
 * 현금으로 바뀐 것뿐이라 AUM 은 그대로여야 하고, 실제로 늘어난 것은 차익뿐이다.
 *
 * ⚠️ 실현손실로 AUM 이 음수가 되면 0 으로 막지 않는다. RPC 가 예외를 던져 트랜잭션 전체를
 *    되돌리고 PB 에게 알린다 — 아무것도 기록되지 않은 상태가 되므로 자산규모를 정정한 뒤
 *    다시 시도하면 된다. 조용히 0 이 되면 "왜 자산이 0 인가"의 근거가 사라진다.
 *
 * 승인 해제는 따로 배선하지 않았다. assetSize 가 기본정보 승인 해시 payload 에 들어 있고
 * (lib/advisory/approvalSnapshots.ts), 화면의 onBasicAssetsChanged 가 이미
 * invalidateAfterEdit({}, "basic") 을 부른다. 매도 성공 시 onAssetsChanged 를 태우면
 * 승인이 즉시 해제되고 새 assetSize 까지 반영된다.
 *
 * ── §CASH-CREDIT 결론: 현금 행에 매도대금을 더하지 않는다 ───────────────────
 * lib/advisory/ipsHoldingsSync.ts 가 IPS 확정 시 market="CASH" 행을 매수액만큼 차감하는
 * 관행이 있어 대칭으로 증액할지 검토했으나, 하지 않기로 했다. 잔차 모델
 * (lib/assets.ts: cash = AUM − stocks)에서 AUM 에 실현손익만 더하면 현금이 자동으로
 * 매도대금만큼 늘기 때문이다:
 *
 *     매도 후 cash = (A + q(p−c)) − (S − q·c) = (A − S) + q·p = 기존 현금 + 매도대금
 *
 * 여기에 CASH 행까지 증액하면 이중 계상이다. 덧붙여 lib/assets.ts 는 CASH 행도
 * stocksKrw 에 합산하므로 명시적 현금 행을 가진 고객은 이미 잔차 모델과 어긋나 있다 —
 * 그건 이 작업이 만든 문제가 아니라 기존 사안이라 별건으로 다룬다.
 */

import { supabase, isSupabaseConfigured } from "../supabase";

export const HOLDING_TRADES_TABLE = "client_holding_trades";

export type TradeSide = "buy" | "sell";

export interface HoldingTrade {
  id: string;
  clientId: string;
  holdingId: string | null;
  ticker: string | null;
  name: string;
  market: string | null;
  currency: string;
  side: TradeSide;
  quantity: number;
  unitPrice: number;
  fxRate: number | null;
  tradedAt: string;
  feeWon: number;
  taxWon: number;
  costBasisUnitPrice: number | null;
  realizedPnlWon: number | null;
  source: string | null;
  memo: string | null;
  createdAt: string;
}

/** 매도 실현손익 계산에 필요한 값. 화면과 기록이 같은 함수를 쓴다. */
export interface RealizedPnlInput {
  /** 매도 수량 */
  quantity: number;
  /** 매도 단가(종목 통화 기준) */
  unitPrice: number;
  /** 체결 시점의 평균매입단가(종목 통화 기준) */
  costBasisUnitPrice: number;
  /** 외화면 원화 환산율. KRW 는 null/undefined(=1). */
  fxRate?: number | null;
  feeWon?: number;
  taxWon?: number;
}

/**
 * 실현손익(원) = 수량 × (매도단가 − 평균매입단가) × 환율 − 수수료 − 세금.
 *
 * 환율을 차익에만 곱하는 이유: 매도대금과 취득원가가 같은 통화라 차액에 한 번만 걸면
 * 된다. 수수료·세금은 이미 원화로 받는다.
 *
 * ⚠️ 환차손익은 다루지 않는다. 정확히 하려면 취득 시점 환율과 매도 시점 환율을 각각
 *    적용해야 하는데, client_holdings 에 취득 시점 환율이 없다. 매수 이력이 쌓이면
 *    그때 정교화한다 — 지금 추정 환율을 넣으면 틀린 숫자가 확정값처럼 남는다.
 */
export function computeRealizedPnlWon(input: RealizedPnlInput): number {
  const qty = Number(input.quantity) || 0;
  const sell = Number(input.unitPrice) || 0;
  const cost = Number(input.costBasisUnitPrice) || 0;
  const fx = input.fxRate == null ? 1 : Number(input.fxRate) || 1;
  const fee = Number(input.feeWon) || 0;
  const tax = Number(input.taxWon) || 0;
  return Math.round(qty * (sell - cost) * fx - fee - tax);
}

/** 매도대금(원) = 수량 × 매도단가 × 환율. 수수료·세금 차감 전. */
export function computeGrossProceedsWon(
  quantity: number,
  unitPrice: number,
  fxRate?: number | null,
): number {
  const fx = fxRate == null ? 1 : Number(fxRate) || 1;
  return Math.round((Number(quantity) || 0) * (Number(unitPrice) || 0) * fx);
}

export interface SellValidationInput {
  quantity: number;
  unitPrice: number;
  tradedAt: string;
  /** 현재 보유수량 */
  heldQuantity: number;
  currency: string;
  fxRate?: number | null;
}

/** 매도 입력 검증. 빈 배열이면 통과. 화면이 그대로 목록으로 보여 준다. */
export function validateSellInput(input: SellValidationInput): string[] {
  const reasons: string[] = [];
  const qty = Number(input.quantity);
  const price = Number(input.unitPrice);

  if (!Number.isFinite(qty) || qty <= 0) {
    reasons.push("매도 수량을 0보다 크게 입력하세요.");
  } else if (qty > input.heldQuantity) {
    reasons.push(
      `매도 수량이 보유수량(${input.heldQuantity.toLocaleString("ko-KR")})을 초과합니다.`,
    );
  }

  if (!Number.isFinite(price) || price < 0) {
    reasons.push("매도 단가를 0 이상으로 입력하세요.");
  }

  if (!input.tradedAt) {
    reasons.push("매도일을 입력하세요.");
  } else if (input.tradedAt > new Date().toLocaleDateString("en-CA")) {
    reasons.push("매도일이 미래입니다.");
  }

  // 외화 종목은 환율이 있어야 원화 손익이 나온다. 기본값을 몰래 넣지 않는다 —
  // 1350 같은 상수를 끼워 넣으면 틀린 실현손익이 장부에 확정값으로 남는다.
  if (input.currency && input.currency.toUpperCase() !== "KRW") {
    const fx = Number(input.fxRate);
    if (!Number.isFinite(fx) || fx <= 0) {
      reasons.push("외화 종목은 체결 시점 환율을 입력해야 합니다.");
    }
  }

  return reasons;
}

export class HoldingTradesTableMissingError extends Error {
  constructor() {
    super(
      "거래 이력 테이블(client_holding_trades)이 없습니다. " +
        "supabase-migration-client-holding-trades.sql 을 먼저 실행하세요.",
    );
    this.name = "HoldingTradesTableMissingError";
  }
}

const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export interface RecordSellInput {
  clientId: string;
  holdingId: string;
  name: string;
  ticker: string | null;
  market: string | null;
  currency: string;
  /** 현재 보유수량 */
  heldQuantity: number;
  /** 체결 시점 평균매입단가 */
  costBasisUnitPrice: number;
  quantity: number;
  unitPrice: number;
  fxRate?: number | null;
  tradedAt: string;
  feeWon?: number;
  taxWon?: number;
  memo?: string | null;
}

export interface RecordSellResult {
  tradeId: string;
  realizedPnlWon: number;
  grossProceedsWon: number;
  /** 매도 후 남은 수량. 0 이면 잔고 행을 삭제했다. */
  remainingQuantity: number;
  holdingRemoved: boolean;
  /** AUM 반영 전후. 화면이 "무엇 때문에 자산이 바뀌었는지"를 보여 주는 데 쓴다. */
  assetSizeBeforeWon: number;
  assetSizeAfterWon: number;
}

export class HoldingSaleRpcMissingError extends Error {
  constructor() {
    super(
      "매도 처리 함수(record_holding_sale)가 없습니다. " +
        "supabase-migration-holding-sale-rpc.sql 을 먼저 실행하세요.",
    );
    this.name = "HoldingSaleRpcMissingError";
  }
}

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

/** uuid v4. RPC 인자가 uuid 라 형식이 맞아야 한다. */
function newTradeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 매도 기록 — 이력·잔고·AUM 을 RPC 한 번으로 원자적으로 반영한다.
 *
 * 1단계에서는 이력 INSERT 와 잔고 UPDATE 를 순차로 했다. 2단계에서 AUM 갱신이 붙으면서
 * 그 방식을 버렸다. 이유는 둘이다.
 *
 *  · assetSize += 실현손익 은 읽고-더하고-쓰는 연산이라 REST 로는 원자적일 수 없다.
 *    매도가 겹치거나 클라이언트가 쥔 값이 오래되면 한쪽 손익이 사라진다(lost update).
 *  · 세 쓰기가 부분 적용되면 장부와 잔고와 자산이 서로 어긋난 채 남는다. 되돌릴 방법이
 *    사람 손밖에 없다.
 *
 * 취득원가도 서버가 client_holdings.avg_price 에서 직접 읽는다 — 화면이 오래된 평단을
 * 쥐고 있어도 장부에 틀린 실현손익이 확정값으로 남지 않는다. 그래서 이 함수가 넘기는
 * costBasisUnitPrice 는 화면 미리보기용일 뿐 기록에는 쓰이지 않는다.
 *
 * RPC 나 테이블이 없으면 던진다. 조용히 로컬로 넘어가지 않는다 — 기록이 남지 않은 채
 * 잔고나 자산만 바뀌는 것이 최악이다.
 */
export async function recordSell(input: RecordSellInput): Promise<RecordSellResult> {
  const reasons = validateSellInput({
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    tradedAt: input.tradedAt,
    heldQuantity: input.heldQuantity,
    currency: input.currency,
    fxRate: input.fxRate,
  });
  if (reasons.length) throw new Error(reasons.join("\n"));

  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase 연결이 없어 매도를 기록할 수 없습니다.");
  }

  const tradeId = newTradeId();

  const { data, error } = await supabase.rpc("record_holding_sale", {
    p_trade_id: tradeId,
    p_client_id: input.clientId,
    p_holding_id: input.holdingId,
    p_quantity: input.quantity,
    p_unit_price: input.unitPrice,
    p_fx_rate: input.fxRate ?? null,
    p_traded_at: input.tradedAt,
    p_fee_won: input.feeWon ?? 0,
    p_tax_won: input.taxWon ?? 0,
    p_memo: input.memo ?? null,
  });

  if (error) {
    if (MISSING_FUNCTION_CODES.has(error.code ?? "")) throw new HoldingSaleRpcMissingError();
    if (MISSING_TABLE_CODES.has(error.code ?? "")) throw new HoldingTradesTableMissingError();
    if (error.code === "23505") {
      throw new Error("이미 기록된 매도입니다. 목록을 새로고침해 확인하세요.");
    }
    // RPC 안에서 raise exception 으로 던진 메시지는 그대로 보여 준다 — 수량 초과·평단 없음·
    // AUM 음수 같은, PB 가 무엇을 해야 하는지 아는 문구들이다.
    throw new Error(error.message || "매도 기록에 실패했습니다.");
  }

  const r = (data ?? {}) as Record<string, unknown>;
  return {
    tradeId: String(r.tradeId ?? tradeId),
    realizedPnlWon: Number(r.realizedPnlWon ?? 0),
    grossProceedsWon: Number(r.grossProceedsWon ?? 0),
    remainingQuantity: Number(r.remainingQuantity ?? 0),
    holdingRemoved: Boolean(r.holdingRemoved),
    assetSizeBeforeWon: Number(r.assetSizeBefore ?? 0),
    assetSizeAfterWon: Number(r.assetSizeAfter ?? 0),
  };
}

function rowToTrade(r: Record<string, unknown>): HoldingTrade {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    holdingId: r.holding_id == null ? null : String(r.holding_id),
    ticker: r.ticker == null ? null : String(r.ticker),
    name: String(r.name ?? ""),
    market: r.market == null ? null : String(r.market),
    currency: String(r.currency ?? "KRW"),
    side: r.side === "buy" ? "buy" : "sell",
    quantity: Number(r.quantity ?? 0),
    unitPrice: Number(r.unit_price ?? 0),
    fxRate: r.fx_rate == null ? null : Number(r.fx_rate),
    tradedAt: String(r.traded_at ?? ""),
    feeWon: Number(r.fee_won ?? 0),
    taxWon: Number(r.tax_won ?? 0),
    costBasisUnitPrice: r.cost_basis_unit_price == null ? null : Number(r.cost_basis_unit_price),
    realizedPnlWon: r.realized_pnl_won == null ? null : Number(r.realized_pnl_won),
    source: r.source == null ? null : String(r.source),
    memo: r.memo == null ? null : String(r.memo),
    createdAt: String(r.created_at ?? ""),
  };
}

/**
 * 고객의 거래 이력. 최신순.
 *
 * 테이블이 없으면 빈 배열이 아니라 던진다. "이력 없음"과 "이력을 못 읽음"을 화면이
 * 구분할 수 있어야 한다 — 오늘 발송 대상이 0 명으로 조용히 처리되던 것과 같은 함정이다.
 */
export async function listHoldingTrades(clientId: string): Promise<HoldingTrade[]> {
  if (!clientId) return [];
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from(HOLDING_TRADES_TABLE)
    .select("*")
    .eq("client_id", clientId)
    .order("traded_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code ?? "")) throw new HoldingTradesTableMissingError();
    throw new Error(`거래 이력 조회 실패: ${error.message}`);
  }
  return (data ?? []).map(rowToTrade);
}

/** 실현손익 합계(원). 매도 행만 센다. */
export function sumRealizedPnlWon(trades: HoldingTrade[]): number {
  return trades.reduce(
    (sum, t) => (t.side === "sell" ? sum + (t.realizedPnlWon ?? 0) : sum),
    0,
  );
}
