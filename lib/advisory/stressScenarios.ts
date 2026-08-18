import { ENGINE_ASSUMPTION, ENGINE_CURRENCY, ENGINE_SOURCE } from "./constants";
import { measured } from "./riskEngine";
import type { StressScenarioResult } from "./types";

interface WeightLike {
  etf: number;
  bond: number;
  els: number;
  mmf: number;
  gold: number;
  dollar: number;
  raw: number;
}

function equityShare(w: WeightLike) {
  const total = Object.values(w).reduce((s, v) => s + v, 0) || 1;
  return (w.etf + w.raw * 0.4) / total;
}
function durationShare(w: WeightLike) {
  const total = Object.values(w).reduce((s, v) => s + v, 0) || 1;
  return (w.bond + w.els * 0.7) / total;
}
function fxShare(w: WeightLike) {
  const total = Object.values(w).reduce((s, v) => s + v, 0) || 1;
  return (w.dollar + w.etf * 0.55) / total;
}
function cashShare(w: WeightLike) {
  const total = Object.values(w).reduce((s, v) => s + v, 0) || 1;
  return (w.mmf + w.gold * 0.2) / total;
}

function pnl(principalWon: number, shockPct: number) {
  return Math.round(principalWon * (shockPct / 100));
}

export function runStressScenarios(input: {
  weights: WeightLike;
  principalWon: number;
  asOf: string;
  clientType?: string;
}): StressScenarioResult[] {
  const { weights, principalWon, asOf, clientType } = input;
  const eq = equityShare(weights);
  const dur = durationShare(weights);
  const fx = fxShare(weights);
  const cash = cashShare(weights);

  const rateShockPct = round1(-(dur * 4.2) + cash * 0.4);
  const equityShockPct = round1(eq * -20 + cash * 1.2);
  const fxShockPct = round1(fx * 6.5 - dur * 0.3);
  const vacancyShockPct = round1(-(0.8 + (1 - cash) * 1.4));
  const salesShockPct = round1(clientType === "corporate" ? -(eq * 8 + 3) : -(eq * 2 + 0.5));

  return [
    scenario("rate-plus-100bp", "금리 +100bp", "기준금리·장기금리 +1.0%p. 채권 듀레이션 민감.", rateShockPct, principalWon, asOf),
    scenario("equity-minus-20", "주식시장 -20%", "국내·해외 주식 동반 -20%. 현금성 자산은 완충.", equityShockPct, principalWon, asOf),
    scenario("fx-plus-10", "환율 +10%", "원/달러 +10%. 해외자산 환산차익·수입물가 부담 동시 반영.", fxShockPct, principalWon, asOf),
    scenario("re-vacancy-up", "부동산 공실률 상승", "상업용 공실 +5%p 가정. 임대현금흐름·담보가치 간이 민감.", vacancyShockPct, principalWon, asOf),
    scenario("corp-sales-down", "법인 매출 감소", "매출 -15% 가정. 법인은 이익·배당 여력, 개인은 지분가치 민감.", salesShockPct, principalWon, asOf),
  ];
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function scenario(
  id: string,
  label: string,
  assumption: string,
  shockPct: number,
  principalWon: number,
  asOf: string,
): StressScenarioResult {
  return {
    id,
    label,
    assumption: `${assumption} ${ENGINE_ASSUMPTION}`,
    shockPct: measured(shockPct, "%", asOf, ENGINE_SOURCE, assumption),
    pnlWon: measured(pnl(principalWon, shockPct), "KRW", asOf, ENGINE_SOURCE, assumption, ENGINE_CURRENCY),
  };
}
