/**
 * 계좌 예수금 / 매수가능금액 조회 + 잔고 부족 시 매수 차단.
 * 민감정보(계좌번호)는 로그에 남기지 않음.
 */

import { getKisConfig } from "./config";
import { kisRequest } from "./http";

export interface AccountCashSummary {
  ok: boolean;
  /** 주문가능 현금 추정(원) */
  orderableCashWon: number | null;
  /** 예수금 총액 추정(원) */
  depositWon: number | null;
  source: string;
  asOf: string;
  error?: string;
}

export interface BuyAffordability {
  ok: boolean;
  estimatedWon: number;
  orderableCashWon: number | null;
  reason?: string;
}

function parseWon(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[,+\s]/g, "").trim());
  return Number.isFinite(n) ? Math.floor(n) : null;
}

let cashOverride: AccountCashSummary | null = null;

export function setAccountCashOverrideForTests(summary: AccountCashSummary | null): void {
  cashOverride = summary;
}

/**
 * 주식잔고조회(TTTC8434R)에서 현금성 잔고 추출.
 * 실패 시 ok=false → 실매수 차단(fail-closed).
 */
export async function fetchAccountCashSummary(options?: {
  fetchImpl?: typeof fetch;
}): Promise<AccountCashSummary> {
  if (cashOverride) return cashOverride;

  const config = getKisConfig();
  const asOf = new Date().toISOString();
  if (!config.appKey || !config.appSecret || !config.cano || !config.acntPrdtCd) {
    return {
      ok: false,
      orderableCashWon: null,
      depositWon: null,
      source: "kis:unconfigured",
      asOf,
      error: "KIS 계좌 설정 부족",
    };
  }

  try {
    const json = await kisRequest<{
      output2?: Record<string, string> | Array<Record<string, string>>;
    }>({
      path: "/uapi/domestic-stock/v1/trading/inquire-balance",
      method: "GET",
      trId: "TTTC8434R",
      query: {
        CANO: config.cano,
        ACNT_PRDT_CD: config.acntPrdtCd,
        AFHR_FLPR_YN: "N",
        OFL_YN: "",
        INQR_DVSN: "02",
        UNPR_DVSN: "01",
        FUND_STTL_ICLD_YN: "N",
        FNCG_AMT_AUTO_RDPT_YN: "N",
        PRCS_DVSN: "01",
        CTX_AREA_FK100: "",
        CTX_AREA_NK100: "",
      },
      fetchImpl: options?.fetchImpl,
    });

    const out2 = Array.isArray(json.output2) ? json.output2[0] : json.output2;
    const depositWon =
      parseWon(out2?.dnca_tot_amt) ??
      parseWon(out2?.nass_amt) ??
      parseWon(out2?.tot_evlu_amt);
    const orderableCashWon =
      parseWon(out2?.nxdy_excc_amt) ??
      parseWon(out2?.prvs_rcdl_excc_amt) ??
      parseWon(out2?.dnca_tot_amt) ??
      depositWon;

    if (orderableCashWon == null) {
      return {
        ok: false,
        orderableCashWon: null,
        depositWon,
        source: "kis:inquire-balance:TTTC8434R",
        asOf,
        error: "잔고 응답에서 주문가능금액을 읽지 못함 — 매수 차단",
      };
    }

    return {
      ok: true,
      orderableCashWon,
      depositWon,
      source: "kis:inquire-balance:TTTC8434R",
      asOf,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      orderableCashWon: null,
      depositWon: null,
      source: "kis:inquire-balance:error",
      asOf,
      error: e instanceof Error ? e.message : "잔고 조회 실패",
    };
  }
}

/** 특정 종목·가격 기준 매수가능수량(가능하면). 실패해도 cash summary로 fallback. */
export async function fetchMaxBuyQty(input: {
  symbol: string;
  price: number;
  ordDvsn?: string;
}): Promise<{ ok: boolean; maxQty: number | null; maxAmt: number | null; error?: string }> {
  const config = getKisConfig();
  try {
    const json = await kisRequest<{ output?: Record<string, string> }>({
      path: "/uapi/domestic-stock/v1/trading/inquire-psbl-order",
      method: "GET",
      trId: "TTTC8908R",
      query: {
        CANO: config.cano,
        ACNT_PRDT_CD: config.acntPrdtCd,
        PDNO: input.symbol.trim(),
        ORD_UNPR: String(Math.round(input.price)),
        ORD_DVSN: input.ordDvsn ?? "00",
        CMA_EVLU_AMT_ICLD_YN: "N",
        OVRS_ICLD_YN: "N",
      },
    });
    const maxQty = parseWon(json.output?.nrcvb_buy_qty) ?? parseWon(json.output?.max_buy_qty);
    const maxAmt = parseWon(json.output?.nrcvb_buy_amt) ?? parseWon(json.output?.max_buy_amt);
    return { ok: true, maxQty, maxAmt };
  } catch (e: unknown) {
    return {
      ok: false,
      maxQty: null,
      maxAmt: null,
      error: e instanceof Error ? e.message : "매수가능조회 실패",
    };
  }
}

/**
 * 매수 금액이 주문가능현금을 초과하면 차단.
 * 잔고 조회 실패 시에도 차단(fail-closed).
 */
export function assertBuyAffordable(
  estimatedWon: number,
  cash: AccountCashSummary,
  bufferWon = 0,
): BuyAffordability {
  if (!(estimatedWon > 0)) {
    return { ok: false, estimatedWon, orderableCashWon: cash.orderableCashWon, reason: "주문금액이 올바르지 않음" };
  }
  if (!cash.ok || cash.orderableCashWon == null) {
    return {
      ok: false,
      estimatedWon,
      orderableCashWon: cash.orderableCashWon,
      reason: cash.error || "잔고 확인 실패 — 매수 차단",
    };
  }
  if (cash.orderableCashWon <= 0) {
    return {
      ok: false,
      estimatedWon,
      orderableCashWon: cash.orderableCashWon,
      reason: "주문가능 현금이 0원입니다. 계좌에 돈을 넣은 뒤 다시 시도하세요.",
    };
  }
  if (estimatedWon + bufferWon > cash.orderableCashWon) {
    return {
      ok: false,
      estimatedWon,
      orderableCashWon: cash.orderableCashWon,
      reason: `잔고 부족: 필요 ${estimatedWon.toLocaleString("ko-KR")}원 > 주문가능 ${cash.orderableCashWon.toLocaleString("ko-KR")}원`,
    };
  }
  return { ok: true, estimatedWon, orderableCashWon: cash.orderableCashWon };
}
