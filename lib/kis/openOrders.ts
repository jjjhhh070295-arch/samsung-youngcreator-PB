import { assertLiveOrderAllowed, getKisConfig, LIVE_ORDER_TR } from "./config";
import { kisRequest } from "./http";

export type KisExchange = "KRX" | "NXT" | "SOR";

export interface KisOpenOrder {
  orderNo: string;
  orgNo: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  orderQty: number;
  filledQty: number;
  cancelableQty: number;
  price: number;
  orderTime: string;
  ordDvsn: string;
  ordDvsnName: string;
  exchange: KisExchange;
}

type KisRequestImpl = typeof kisRequest;

function parseNumber(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[,+\s]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function parseExchange(value: unknown): KisExchange {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "NXT" || normalized === "SOR") return normalized;
  return "KRX";
}

export function mapKisOpenOrders(rows: Array<Record<string, string>>): KisOpenOrder[] {
  return rows
    .map((row) => ({
      orderNo: String(row.odno ?? "").trim(),
      orgNo: String(row.ord_gno_brno ?? "").trim(),
      symbol: String(row.pdno ?? "").trim(),
      name: String(row.prdt_name ?? row.pdno ?? "").trim(),
      side: row.sll_buy_dvsn_cd === "01" ? ("sell" as const) : ("buy" as const),
      orderQty: parseNumber(row.ord_qty),
      filledQty: parseNumber(row.tot_ccld_qty),
      cancelableQty: parseNumber(row.psbl_qty),
      price: parseNumber(row.ord_unpr),
      orderTime: String(row.ord_tmd ?? "").trim(),
      ordDvsn: String(row.ord_dvsn_cd ?? "00").trim() || "00",
      ordDvsnName: String(row.ord_dvsn_name ?? "").trim(),
      exchange: parseExchange(row.excg_id_dvsn_cd),
    }))
    .filter((order) => order.orderNo && order.orgNo && order.cancelableQty > 0);
}

export function buildKisCancelBody(order: KisOpenOrder) {
  return {
    KRX_FWDG_ORD_ORGNO: order.orgNo,
    ORGN_ODNO: order.orderNo,
    ORD_DVSN: order.ordDvsn,
    RVSE_CNCL_DVSN_CD: "02",
    ORD_QTY: "0",
    ORD_UNPR: "0",
    QTY_ALL_ORD_YN: "Y",
    EXCG_ID_DVSN_CD: order.exchange,
  };
}

export async function fetchKisOpenOrders(
  requestImpl: KisRequestImpl = kisRequest,
): Promise<KisOpenOrder[]> {
  const config = getKisConfig();
  const json = await requestImpl<{
    output?: Array<Record<string, string>>;
  }>({
    path: "/uapi/domestic-stock/v1/trading/inquire-psbl-rvsecncl",
    method: "GET",
    trId: "TTTC0084R",
    query: {
      CANO: config.cano,
      ACNT_PRDT_CD: config.acntPrdtCd,
      INQR_DVSN_1: "0",
      INQR_DVSN_2: "0",
      CTX_AREA_FK100: "",
      CTX_AREA_NK100: "",
    },
  });
  return mapKisOpenOrders(json.output ?? []);
}

export async function cancelKisOpenOrderByNo(
  orderNo: string,
  requestImpl: KisRequestImpl = kisRequest,
): Promise<{ order: KisOpenOrder; response: unknown }> {
  assertLiveOrderAllowed();
  const openOrders = await fetchKisOpenOrders(requestImpl);
  const order = openOrders.find((row) => row.orderNo === orderNo.trim());
  if (!order) {
    throw new Error("취소 가능한 미체결 주문을 찾지 못했습니다. 이미 체결 또는 취소됐을 수 있습니다.");
  }

  const config = getKisConfig();
  const response = await requestImpl({
    path: "/uapi/domestic-stock/v1/trading/order-rvsecncl",
    method: "POST",
    trId: LIVE_ORDER_TR.cancel,
    body: {
      CANO: config.cano,
      ACNT_PRDT_CD: config.acntPrdtCd,
      ...buildKisCancelBody(order),
    },
  });
  return { order, response };
}
