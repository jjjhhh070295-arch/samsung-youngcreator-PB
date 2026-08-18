import {
  ENGINE_ASSUMPTION,
  ENGINE_CURRENCY,
  ENGINE_SOURCE,
  RISK_FREE_RATE_PCT,
  STANDARD_NORMAL_PDF_Z95,
  VAR_CONFIDENCE,
  VAR_Z_95,
} from "./constants";
import type { MeasuredNumber } from "./types";

function round(value: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function measured(
  value: number,
  unit: string,
  asOf: string,
  source = ENGINE_SOURCE,
  assumption = ENGINE_ASSUMPTION,
  currency?: string,
): MeasuredNumber {
  return {
    value,
    unit,
    asOf,
    source,
    assumption,
    ...(currency ? { currency } : {}),
  };
}

/** 파라메트릭 1년 손실률 VaR (음수=손실). 정규분포, 신뢰수준 고정. */
export function parametricVarPct(expectedReturnPct: number, volPct: number, z = VAR_Z_95): number {
  return round(expectedReturnPct - z * volPct, 2);
}

/** 파라메트릭 CVaR (Expected Shortfall). φ(z)/(1-α) 사용. */
export function parametricCvarPct(expectedReturnPct: number, volPct: number): number {
  const tail = STANDARD_NORMAL_PDF_Z95 / (1 - VAR_CONFIDENCE);
  return round(expectedReturnPct - volPct * tail, 2);
}

export function sharpeRatio(expectedReturnPct: number, volPct: number, rf = RISK_FREE_RATE_PCT): number {
  if (!(volPct > 0)) return 0;
  return round((expectedReturnPct - rf) / volPct, 2);
}

export function historicalVarCvar(periodReturns: number[], confidence = VAR_CONFIDENCE) {
  if (periodReturns.length < 8) {
    return { varPct: null as number | null, cvarPct: null as number | null };
  }
  const sorted = [...periodReturns].sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor((1 - confidence) * sorted.length) - 1);
  const varPct = round(sorted[idx] * 100, 2);
  const tail = sorted.slice(0, idx + 1);
  const cvarPct = round((tail.reduce((s, v) => s + v, 0) / tail.length) * 100, 2);
  return { varPct, cvarPct };
}

export function buildRiskMetrics(input: {
  expectedReturnPct: number;
  volatilityPct: number;
  mddPct: number;
  asOf: string;
  source?: string;
}) {
  const asOf = input.asOf;
  const source = input.source ?? ENGINE_SOURCE;
  const assumption = ENGINE_ASSUMPTION;
  return {
    expectedReturn: measured(input.expectedReturnPct, "%", asOf, source, assumption),
    volatility: measured(input.volatilityPct, "%", asOf, source, assumption),
    sharpe: measured(sharpeRatio(input.expectedReturnPct, input.volatilityPct), "ratio", asOf, source, `무위험 ${RISK_FREE_RATE_PCT}% · ${assumption}`),
    mdd: measured(input.mddPct, "%", asOf, source, assumption),
    var95: measured(
      parametricVarPct(input.expectedReturnPct, input.volatilityPct),
      "%",
      asOf,
      source,
      `파라메트릭 ${Math.round(VAR_CONFIDENCE * 100)}% VaR · ${assumption}`,
    ),
    cvar95: measured(
      parametricCvarPct(input.expectedReturnPct, input.volatilityPct),
      "%",
      asOf,
      source,
      `파라메트릭 ${Math.round(VAR_CONFIDENCE * 100)}% CVaR · ${assumption}`,
    ),
    currency: ENGINE_CURRENCY,
  };
}
