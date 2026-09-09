/**
 * 보유종목 거래 이력 — 매도 기록과 실현손익.
 *
 * ── 1단계 범위 ─────────────────────────────────────────────────────────────
 * 이력 기록 + 잔고 차감까지만 한다. AUM(parties.asset_size)은 건드리지 않는다.
 * 따라서 이 단계에서는 화면 숫자가 지금과 똑같이 움직인다 — 종목이 줄면 장부가만큼
 * cashKrw 잔차가 늘 뿐이다(lib/assets.ts). 달라지는 것은 "무엇을 얼마에 팔았는지"가
 * 남는다는 것뿐이라, 기존 계산에 회귀 위험이 없다.
 *
 * ── 2단계에서 여기에 붙을 것 (지금은 하지 않는다) ───────────────────────────
 *  1) assetSize += realized_pnl_won.
 *     시세로는 AUM 이 움직이지 않지만 확정된 거래로는 움직인다는 규칙이다.
 *     ⚠️ 실현손실이 커서 AUM 이 음수가 되는 경우는 조용히 0 으로 막지 않는다 —
 *        거부하고 PB 에게 알린다. 0 으로 눌러 버리면 또 하나의 조용한 실패가 된다.
 *  2) 승인 해제. assetSize 가 기본정보 승인 해시 payload 에 들어 있어
 *     (lib/advisory/approvalSnapshots.ts) 값만 바꿔도 다음 진입에서 스테일로 잡히지만,
 *     즉시 반영하려면 invalidateAfterEdit(next, "basic") 을 명시 호출한다.
 *  3) 원자성. PostgREST 에는 트랜잭션이 없다. 이력·잔고·AUM 세 쓰기를 한 번에 묶으려면
 *     SECURITY DEFINER RPC 가 필요하다(authenticate_pb 선례). 1단계는 AUM 을 건드리지
 *     않아 쓰기가 둘뿐이고, 아래 순서(이력 먼저)로 복구 가능하게 두었다.
 *
 * ── 미정: 매도대금을 현금 행에 반영할지 ─────────────────────────────────────
 * lib/advisory/ipsHoldingsSync.ts 는 IPS 확정 시 market="CASH" 또는 이름에 CMA·현금·
 * 예수금이 든 client_holdings 행을 찾아 매수액만큼 차감한다. 즉 현금을 보유종목 한 행으로
 * 두는 관행이 이미 있다. 매도대금을 그 행에 더할지, 아니면 잔차 방식(AUM 만 조정)에
 * 맡길지는 박상혁님과 합의가 필요하다 — 두 방식이 섞이면 현금이 이중 계상된다.
 * 합의되면 아래 recordSell 의 잔고 차감 직후가 그 자리다(§CASH-CREDIT 표시).
 * 1단계는 AUM 도 현금도 건드리지 않으므로 이 결정 없이 진행할 수 있다.
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
}

/**
 * 매도 기록. 이력을 먼저 남기고 잔고를 줄인다.
 *
 * 순서가 중요하다. 이력이 먼저여야 2 단계가 실패해도 "무엇을 팔았는지"가 남는다.
 * 반대로 잔고를 먼저 지우면 실패 시 종목이 사라진 채 근거가 없다 — 되돌릴 수 있는 쪽을
 * 나중에 둔다.
 *
 * 테이블이 없으면 던진다. 이 프로젝트의 다른 폴백들처럼 localStorage 로 조용히 넘어가지
 * 않는다 — 장부는 조용히 실패하면 안 되고, 기록이 남지 않은 채 잔고만 줄면 그게 최악이다.
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

  const realizedPnlWon = computeRealizedPnlWon({
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    costBasisUnitPrice: input.costBasisUnitPrice,
    fxRate: input.fxRate,
    feeWon: input.feeWon,
    taxWon: input.taxWon,
  });
  const grossProceedsWon = computeGrossProceedsWon(
    input.quantity,
    input.unitPrice,
    input.fxRate,
  );

  // id 를 여기서 만든다. 2 단계(잔고 차감)가 실패해 사용자가 다시 시도하면 같은 id 로
  // 충돌(23505)이 나므로 이력이 중복되지 않는다. 아래에서 그 충돌을 성공으로 취급한다.
  const tradeId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

  // ① 이력
  const { error: insertError } = await supabase.from(HOLDING_TRADES_TABLE).insert([
    {
      id: tradeId,
      client_id: input.clientId,
      holding_id: input.holdingId,
      ticker: input.ticker,
      name: input.name,
      market: input.market,
      currency: input.currency,
      side: "sell",
      quantity: input.quantity,
      unit_price: input.unitPrice,
      fx_rate: input.fxRate ?? null,
      traded_at: input.tradedAt,
      fee_won: input.feeWon ?? 0,
      tax_won: input.taxWon ?? 0,
      cost_basis_unit_price: input.costBasisUnitPrice,
      realized_pnl_won: realizedPnlWon,
      source: "manual",
      memo: input.memo ?? null,
    },
  ]);
  if (insertError && insertError.code !== "23505") {
    if (MISSING_TABLE_CODES.has(insertError.code ?? "")) throw new HoldingTradesTableMissingError();
    throw new Error(`매도 이력 기록 실패: ${insertError.message}`);
  }

  // ② 잔고
  const remainingQuantity = Number(input.heldQuantity) - Number(input.quantity);
  // 부동소수 오차로 0 이 1e-9 처럼 남는 것을 막는다.
  const cleared = Math.abs(remainingQuantity) < 1e-9;

  if (cleared) {
    const { error } = await supabase
      .from("client_holdings")
      .delete()
      .eq("id", input.holdingId)
      .eq("client_id", input.clientId);
    if (error) {
      throw new Error(
        `매도 이력은 기록됐으나(거래 ${tradeId}) 보유종목 삭제에 실패했습니다: ${error.message}`,
      );
    }
  } else {
    // avg_price 는 건드리지 않는다. 매도는 평단을 바꾸지 않는다 — 남은 수량의 취득원가는
    // 그대로다. 평단이 바뀌는 것은 매수뿐이다(가중평균).
    const { error } = await supabase
      .from("client_holdings")
      .update({ quantity: remainingQuantity })
      .eq("id", input.holdingId)
      .eq("client_id", input.clientId);
    if (error) {
      throw new Error(
        `매도 이력은 기록됐으나(거래 ${tradeId}) 보유수량 차감에 실패했습니다: ${error.message}`,
      );
    }
  }

  // §CASH-CREDIT — 매도대금을 현금 행에 더할지 결정되면 여기에 붙인다(파일 상단 주석 참고).
  // 지금은 아무것도 하지 않는다. AUM 도 현금도 1 단계 범위 밖이다.

  return {
    tradeId,
    realizedPnlWon,
    grossProceedsWon,
    remainingQuantity: cleared ? 0 : remainingQuantity,
    holdingRemoved: cleared,
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
