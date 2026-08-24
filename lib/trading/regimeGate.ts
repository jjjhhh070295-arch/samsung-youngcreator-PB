/**
 * 매수 주문 강제 게이트 — 런타임 국면 + 3양봉/과열/수량 정책.
 * 하락장·과열·한도 초과 시 주문 차단. 매도는 게이트 예외(청산 허용).
 */

import { fetchKospiCompletedBars } from "@/lib/market/kospiBars";
import {
  detectMarketRegime,
  evaluateRegimeEntry,
  policyForRegime,
  type RegimeEntryDecision,
} from "@/lib/strategy/marketRegime";
import type { CompletedBar } from "@/lib/strategy/threeBullTwoBear";
import type { PreviewOrderInput } from "@/lib/trading/types";

export interface RegimeGateInput {
  side: PreviewOrderInput["side"];
  symbol: string;
  quantity: number;
  price: number;
  /** 종목 완료 일봉 (없으면 매수 시 차단) */
  stockBars?: CompletedBar[];
  openCount?: number;
  allocatedWon?: number;
  dayChangePct?: number | null;
  /** 테스트용 지수 봉 주입 */
  indexBars?: CompletedBar[];
}

export interface RegimeGateResult {
  ok: boolean;
  code?: string;
  error?: string;
  regime?: RegimeEntryDecision["regime"];
  policyLabel?: string;
  decision?: RegimeEntryDecision;
  indexAsOf?: string | null;
  indexSource?: string;
  /** 게이트가 허용한 수량 (횡보 시 축소될 수 있음) */
  allowedQuantity?: number;
}

function defaultAllocatedWon(): number {
  const raw = process.env.STRATEGY_ALLOCATED_WON;
  const n = raw ? Number.parseInt(raw, 10) : 1_000_000;
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

/**
 * 매수에만 적용. 매도는 항상 통과.
 */
export async function enforceRegimeBuyGate(input: RegimeGateInput): Promise<RegimeGateResult> {
  if (input.side !== "buy") {
    return { ok: true, allowedQuantity: input.quantity };
  }

  let indexBars = input.indexBars;
  let indexSource = "injected";
  if (!indexBars) {
    const fetched = await fetchKospiCompletedBars();
    indexBars = fetched.bars;
    indexSource = fetched.source;
    if (fetched.error && indexBars.length === 0) {
      return {
        ok: false,
        code: "REGIME_INDEX_UNAVAILABLE",
        error: `국면 판정용 지수 일봉 조회 실패: ${fetched.error}`,
        indexSource,
      };
    }
  }

  const detected = detectMarketRegime(indexBars);
  const policy = policyForRegime(detected.regime);

  if (!policy.allowNewBuys) {
    return {
      ok: false,
      code: "REGIME_BEAR_NO_BUY",
      error: "하락장 — 신규매수 중단, 현금 대기",
      regime: detected.regime,
      policyLabel: policy.labelKo,
      indexAsOf: detected.asOf,
      indexSource,
    };
  }

  const stockBars = input.stockBars ?? [];
  if (stockBars.length < 3) {
    return {
      ok: false,
      code: "STOCK_BARS_REQUIRED",
      error: "매수 게이트: 종목 완료 일봉(최소 3개)이 필요합니다",
      regime: detected.regime,
      policyLabel: policy.labelKo,
      indexAsOf: detected.asOf,
      indexSource,
    };
  }

  const allocatedWon =
    input.allocatedWon != null && input.allocatedWon > 0
      ? input.allocatedWon
      : Math.max(input.quantity * input.price, defaultAllocatedWon());

  const decision = evaluateRegimeEntry({
    indexBars,
    stockBars,
    openCount: input.openCount ?? 0,
    allocatedWon,
    closePrice: input.price,
    dayChangePct: input.dayChangePct,
  });

  if (!decision.allow) {
    return {
      ok: false,
      code: "REGIME_ENTRY_BLOCKED",
      error: decision.reasons.join(" · "),
      regime: decision.regime,
      policyLabel: decision.policy.labelKo,
      decision,
      indexAsOf: detected.asOf,
      indexSource,
      allowedQuantity: 0,
    };
  }

  // 요청 수량과 국면 허용 수량 중 작은 쪽
  const allowedQuantity = Math.min(input.quantity, decision.qty);
  if (allowedQuantity < 1) {
    return {
      ok: false,
      code: "REGIME_QTY_ZERO",
      error: "국면 수량 배율 적용 후 주문 가능 수량 없음",
      regime: decision.regime,
      policyLabel: decision.policy.labelKo,
      decision,
      indexAsOf: detected.asOf,
      indexSource,
      allowedQuantity: 0,
    };
  }

  return {
    ok: true,
    regime: decision.regime,
    policyLabel: decision.policy.labelKo,
    decision,
    indexAsOf: detected.asOf,
    indexSource,
    allowedQuantity,
  };
}
