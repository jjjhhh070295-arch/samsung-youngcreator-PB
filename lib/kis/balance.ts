/**
 * 계좌 예수금 / 매수가능금액 조회 + 잔고 부족 시 매수 차단.
 * 민감정보(계좌번호)는 로그에 남기지 않음.
 */

import { getKisConfig } from "./config";
import { kisRequest } from "./http";

export interface AccountCashSummary {
  ok: boolean;
  /** 현금 잔고 참고값(원). 실제 매수가능수량은 종목·가격별 조회를 사용. */
  orderableCashWon: number | null;
  /** 예수금 총액 추정(원) */
  depositWon: number | null;
  /** 총평가금액 tot_evlu_amt (원) */
  totalEvaluationWon: number | null;
  /** 유가증권 평가금액 (원) */
  securitiesEvaluationWon: number | null;
  /** 평가손익 합계 (원) */
  evaluationPnlWon: number | null;
  /** 매입금액 합계 (원) */
  purchaseAmountWon: number | null;
  /** 순자산 (원) */
  netAssetWon: number | null;
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

export interface KisHolding {
  ticker: string;
  name: string;
  heldQty: number;
  /** 한투 잔고조회가 반환한 즉시 매도 주문가능수량 */
  sellableQty: number;
  averagePrice: number;
  currentPrice: number;
}

function parseWon(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[,+\s]/g, "").trim());
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export function mapKisHoldings(rows: Array<Record<string, string>>): KisHolding[] {
  return rows
    .map((row) => ({
      ticker: String(row.pdno ?? "").trim(),
      name: String(row.prdt_name ?? row.pdno ?? "").trim(),
      heldQty: Math.max(0, parseWon(row.hldg_qty) ?? 0),
      sellableQty: Math.max(0, parseWon(row.ord_psbl_qty) ?? 0),
      averagePrice: Math.max(0, parseWon(row.pchs_avg_pric) ?? 0),
      currentPrice: Math.max(0, parseWon(row.prpr) ?? 0),
    }))
    .filter((row) => row.ticker && row.heldQty > 0);
}

async function requestKisBalance(options?: { fetchImpl?: typeof fetch }) {
  const config = getKisConfig();
  return kisRequest<{
    output1?: Array<Record<string, string>>;
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
      totalEvaluationWon: null,
      securitiesEvaluationWon: null,
      evaluationPnlWon: null,
      purchaseAmountWon: null,
      netAssetWon: null,
      source: "kis:unconfigured",
      asOf,
      error: "KIS 계좌 설정 부족",
    };
  }

  try {
    const json = await requestKisBalance(options);

    const out2 = Array.isArray(json.output2) ? json.output2[0] : json.output2;
    const depositWon = parseWon(out2?.dnca_tot_amt);
    const totalEvaluationWon = parseWon(out2?.tot_evlu_amt);
    const securitiesEvaluationWon =
      parseWon(out2?.scts_evlu_amt) ?? parseWon(out2?.evlu_amt_smtl_amt);
    const evaluationPnlWon = parseWon(out2?.evlu_pfls_smtl_amt);
    const purchaseAmountWon = parseWon(out2?.pchs_amt_smtl_amt);
    const netAssetWon = parseWon(out2?.nass_amt);
    // nxdy_excc_amt/prvs_rcdl_excc_amt는 각각 익일/가수도 정산금액이다.
    // 실제 주문가능금액으로 오인하지 않고 예수금만 참고값으로 노출한다.
    const orderableCashWon = depositWon;

    // output2에 평가가 없으면 보유종목(output1) 합산으로 보강
    let secEval = securitiesEvaluationWon;
    if (secEval == null && Array.isArray(json.output1) && json.output1.length > 0) {
      let sum = 0;
      let any = false;
      for (const row of json.output1) {
        const v = parseWon(row.evlu_amt);
        if (v != null) {
          sum += v;
          any = true;
        }
      }
      if (any) secEval = sum;
    }

    if (orderableCashWon == null) {
      return {
        ok: false,
        orderableCashWon: null,
        depositWon,
        totalEvaluationWon,
        securitiesEvaluationWon: secEval,
        evaluationPnlWon,
        purchaseAmountWon,
        netAssetWon,
        source: "kis:inquire-balance:TTTC8434R",
        asOf,
        error: "잔고 응답에서 주문가능금액을 읽지 못함 — 매수 차단",
      };
    }

    return {
      ok: true,
      orderableCashWon,
      depositWon,
      totalEvaluationWon,
      securitiesEvaluationWon: secEval,
      evaluationPnlWon,
      purchaseAmountWon,
      netAssetWon,
      source: "kis:inquire-balance:TTTC8434R",
      asOf,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      orderableCashWon: null,
      depositWon: null,
      totalEvaluationWon: null,
      securitiesEvaluationWon: null,
      evaluationPnlWon: null,
      purchaseAmountWon: null,
      netAssetWon: null,
      source: "kis:inquire-balance:error",
      asOf,
      error: e instanceof Error ? e.message : "잔고 조회 실패",
    };
  }
}

/** 실제 계좌의 보유수량·매도 주문가능수량 조회. */
export async function fetchKisHoldings(options?: {
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; holdings: KisHolding[]; error?: string }> {
  const config = getKisConfig();
  if (!config.appKey || !config.appSecret || !config.cano || !config.acntPrdtCd) {
    return { ok: false, holdings: [], error: "KIS 계좌 설정 부족" };
  }
  try {
    const json = await requestKisBalance(options);
    return { ok: true, holdings: mapKisHoldings(json.output1 ?? []) };
  } catch (error: unknown) {
    return {
      ok: false,
      holdings: [],
      error: error instanceof Error ? error.message : "보유수량 조회 실패",
    };
  }
}

/** 특정 종목·가격 기준 미수 없는 매수가능수량. 실패 시 주문을 차단한다. */
export async function fetchMaxBuyQty(input: {
  symbol: string;
  price: number;
  ordDvsn?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  ok: boolean;
  maxQty: number | null;
  maxAmt: number | null;
  orderableCashWon?: number | null;
  queryOrdDvsn?: string;
  error?: string;
}> {
  const config = getKisConfig();
  try {
    // 실제 제출할 주문구분과 같은 조건으로 조회한다. 지정가 주문을 시장가(01)로
    // 조회하면 상한가가 계산단가로 잡혀, 현금으로 1주를 살 수 있어도 0주가 될 수 있다.
    // 미수 없는 수량(nrcvb_buy_qty)만 사용하므로 신용/미수 수량은 허용하지 않는다.
    const queryOrdDvsn = input.ordDvsn ?? "00";
    const json = await kisRequest<{ output?: Record<string, string> }>({
      path: "/uapi/domestic-stock/v1/trading/inquire-psbl-order",
      method: "GET",
      trId: "TTTC8908R",
      query: {
        CANO: config.cano,
        ACNT_PRDT_CD: config.acntPrdtCd,
        PDNO: input.symbol.trim(),
        ORD_UNPR: String(Math.round(input.price)),
        ORD_DVSN: queryOrdDvsn,
        CMA_EVLU_AMT_ICLD_YN: "N",
        OVRS_ICLD_YN: "N",
      },
      fetchImpl: input.fetchImpl,
    });
    // 미수/신용을 사용하지 않으므로 max_buy_*로 대체하지 않는다.
    const maxQty = parseWon(json.output?.nrcvb_buy_qty);
    const maxAmt = parseWon(json.output?.nrcvb_buy_amt);
    const orderableCashWon = parseWon(json.output?.ord_psbl_cash);
    if (maxQty == null) {
      return {
        ok: false,
        maxQty: null,
        maxAmt,
        orderableCashWon,
        queryOrdDvsn,
        error: "한투 응답에서 미수 없는 매수가능수량을 읽지 못함",
      };
    }
    return { ok: true, maxQty, maxAmt, orderableCashWon, queryOrdDvsn };
  } catch (e: unknown) {
    return {
      ok: false,
      maxQty: null,
      maxAmt: null,
      orderableCashWon: null,
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
