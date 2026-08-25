/**
 * KRX / NXT / SOR 주문 라우팅 (공식 EXCG_ID_DVSN_CD).
 * 기본 TRADING_EXCHANGE_MODE=SOR
 */

export type ExchangeMode = "KRX" | "NXT" | "SOR";

export interface RouteDecision {
  requested: ExchangeMode;
  effective: ExchangeMode;
  reason: string;
  switched: boolean;
}

export function getConfiguredExchangeMode(
  env: NodeJS.ProcessEnv = process.env,
): ExchangeMode {
  const raw = (env.TRADING_EXCHANGE_MODE ?? "SOR").trim().toUpperCase();
  if (raw === "KRX" || raw === "NXT" || raw === "SOR") return raw;
  return "SOR";
}

/**
 * NXT 비대상 종목이면 NXT 직접 주문 금지 → SOR(또는 KRX)로 전환.
 */
export function resolveExchangeRoute(input: {
  mode?: ExchangeMode;
  nxtEligible: boolean;
}): RouteDecision {
  const requested = input.mode ?? getConfiguredExchangeMode();
  if (requested === "NXT" && !input.nxtEligible) {
    return {
      requested,
      effective: "SOR",
      reason: "NXT 비대상 종목 — SOR로 전환",
      switched: true,
    };
  }
  return {
    requested,
    effective: requested,
    reason: requested === "SOR" ? "SOR 최선집행" : `${requested} 직접 지정`,
    switched: false,
  };
}

/** 현금주문 body에 넣을 거래소 구분 */
export function buildExchangeOrderFields(effective: ExchangeMode): {
  EXCG_ID_DVSN_CD: ExchangeMode;
  SLL_TYPE: string;
  CNDT_PRIC: string;
} {
  return {
    EXCG_ID_DVSN_CD: effective,
    SLL_TYPE: "01",
    CNDT_PRIC: "0",
  };
}
