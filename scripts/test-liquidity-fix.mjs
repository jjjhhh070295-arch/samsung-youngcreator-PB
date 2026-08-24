// 유동성 정교화 before/after 검증
// 1억 = 1e8
const OEK = 1e8;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function pctOfAssets(amt, base) { return base > 0 ? Math.abs(amt) / base * 100 : 0; }

// ─── growthCapacity ───────────────────────────────────────────────────────────
// BEFORE: Liquidity 점수가 ETF 직접 깎음 ((scores.liquidity-3)*8)
function growthCapacityBefore(scores, scheduledPct, taxPct, riskTilt) {
  return (
    (scores.risk - 3) * 14 +
    (scores.return - 3) * 9 +
    (scores.timeHorizon - 3) * 7 -
    (scores.tax - 3) * 5 -
    (scores.liquidity - 3) * 8 -          // ← 제거 대상
    Math.max(0, scores.legal - 2) * 5 -
    Math.max(0, scores.unique - 3) * 4 -
    Math.min(14, scheduledPct * 0.25 + taxPct * 0.35) +
    riskTilt * 11
  );
}

// AFTER: Liquidity → ETF 직접 패널티 제거
function growthCapacityAfter(scores, scheduledPct, taxPct, riskTilt) {
  return (
    (scores.risk - 3) * 14 +
    (scores.return - 3) * 9 +
    (scores.timeHorizon - 3) * 7 -
    (scores.tax - 3) * 5 -
    // (scores.liquidity - 3) * 8 ← 제거됨
    Math.max(0, scores.legal - 2) * 5 -
    Math.max(0, scores.unique - 3) * 4 -
    Math.min(14, scheduledPct * 0.25 + taxPct * 0.35) +
    riskTilt * 11
  );
}

// ─── liquidityReservePercent (변경 없음, base만 바뀜) ─────────────────────────
function liquidityPct(scores, scheduledPct, taxPct, annualDeficitPct, cashflow, riskTilt) {
  const hasNear = Boolean(cashflow.nearestOutflow);
  const floor = 4;
  const cap = scores.liquidity >= 5 ? 48 : 42;
  const reserve =
    3 +
    (scores.liquidity - 1) * 3.2 +
    (scores.tax >= 4 ? 4 : 0) +
    (hasNear ? 4 : 0) +
    scheduledPct * 0.34 +
    taxPct * 0.7 +
    annualDeficitPct * 0.45 -
    (scores.timeHorizon - 3) * 1.8 -
    riskTilt * 2.2;
  return clamp(reserve, floor, cap);
}

// ─── 비중 분배 (단순화: bond=46, els=13, gold=8, raw=3 고정점수) ──────────────
function weights(gc, mmfPct) {
  const remaining = Math.max(0, 100 - mmfPct - 2); // dollar ~2% 가정
  const etfScore = Math.max(0, 42 + gc);
  const bondScore = Math.max(0, 46 - gc * 0.5);
  const elsScore  = Math.max(0, 13);
  const goldScore = Math.max(0, 8);
  const rawScore  = Math.max(0, 3);
  const scoreSum  = etfScore + bondScore + elsScore + goldScore + rawScore;
  if (scoreSum <= 0) return { etf: 0, bond: remaining, mmf: mmfPct };
  return {
    etf:  Math.round(remaining * etfScore  / scoreSum * 10) / 10,
    bond: Math.round(remaining * bondScore / scoreSum * 10) / 10,
    mmf:  Math.round(mmfPct * 10) / 10,
  };
}

function simulate(label, scores, cashflow, totalAsset, investableKrw) {
  const riskTilt = 0; // 균형형

  // ── BEFORE: 총자산 기준 ──
  const schB = pctOfAssets(cashflow.scheduledOutflow, totalAsset);
  const taxB = pctOfAssets(cashflow.taxOutflow,       totalAsset);
  const defB = pctOfAssets(Math.max(0, -cashflow.monthlyNet) * 12, totalAsset);
  const mmfB = liquidityPct(scores, schB, taxB, defB, cashflow, riskTilt);
  const gcB  = growthCapacityBefore(scores, schB, taxB, riskTilt);
  const wB   = weights(gcB, mmfB);

  // ── AFTER: 투자가능자산 기준 ──
  const base = investableKrw && investableKrw > 0 ? investableKrw : totalAsset;
  const schA = pctOfAssets(cashflow.scheduledOutflow, base);
  const taxA = pctOfAssets(cashflow.taxOutflow,       base);
  const defA = pctOfAssets(Math.max(0, -cashflow.monthlyNet) * 12, base);
  const mmfA = liquidityPct(scores, schA, taxA, defA, cashflow, riskTilt);
  const gcA  = growthCapacityAfter(scores, schA, taxA, riskTilt);
  const wA   = weights(gcA, mmfA);

  const fmt = (n) => `${(n/OEK).toLocaleString()}억`;
  console.log(`\n=== ${label} ===`);
  console.log(`  총자산 ${fmt(totalAsset)}, 투자가능 ${fmt(base)}, 예정지출 ${fmt(cashflow.scheduledOutflow)}`);
  console.log(`  Liquidity점수=${scores.liquidity}`);
  console.log(`  [BEFORE] schPct=${schB.toFixed(2)}%  MMF=${mmfB.toFixed(1)}%  growthCap=${gcB.toFixed(1)}  ETF≈${wB.etf}%  채권≈${wB.bond}%`);
  console.log(`  [AFTER]  schPct=${schA.toFixed(2)}%  MMF=${mmfA.toFixed(1)}%  growthCap=${gcA.toFixed(1)}  ETF≈${wA.etf}%  채권≈${wA.bond}%`);
  console.log(`  → MMF ${mmfA - mmfB >= 0 ? '+' : ''}${(mmfA - mmfB).toFixed(1)}%p  |  ETF ${wA.etf - wB.etf >= 0 ? '+' : ''}${(wA.etf - wB.etf).toFixed(1)}%p`);
}

// ─── 케이스 실행 ─────────────────────────────────────────────────────────────

// 중립 기준 (다 3점, 예정지출 0 — MMF/ETF 깨지면 안 됨)
const neutral = { risk:3, return:3, timeHorizon:3, tax:3, liquidity:3, legal:3, unique:3 };
const noFlow  = { scheduledOutflow:0, taxOutflow:0, monthlyNet:0, nearestOutflow:null };
console.log('==========================================================');
console.log('▶ 중립 기준 확인 (Liquidity=3이면 (3-3)*8=0 → 제거해도 growthCap 불변)');
simulate('중립 (총자산=투자가능)', neutral, noFlow, 100*OEK, 100*OEK);

// 케이스 A: 투자가능 100억, 예정지출 10억
console.log('\n==========================================================');
console.log('▶ 케이스 A: 투자가능 100억, 예정지출 10억 (10%)');
console.log('  부동산 100억 포함 총자산 200억 → before는 5%로 과소평가');
const scA = { ...neutral };
const fA  = { scheduledOutflow:10*OEK, taxOutflow:0, monthlyNet:0, nearestOutflow:{} };
simulate('케이스 A', scA, fA, 200*OEK, 100*OEK);

// 케이스 B: 투자가능 100억, 예정지출 1억
console.log('\n==========================================================');
console.log('▶ 케이스 B: 투자가능 100억, 예정지출 1억 (1%)');
const fB  = { scheduledOutflow:1*OEK, taxOutflow:0, monthlyNet:0, nearestOutflow:null };
simulate('케이스 B', neutral, fB, 200*OEK, 100*OEK);

// 케이스 C: 투자가능 1조, 필요자금 10억 (0.1%)
console.log('\n==========================================================');
console.log('▶ 케이스 C: 투자가능 1조, 필요자금 10억 (0.1%)');
console.log('  총자산 2조 → before schPct=0.05%, after=0.10% — MMF 거의 변화 없어야 함');
const fC  = { scheduledOutflow:10*OEK, taxOutflow:0, monthlyNet:0, nearestOutflow:null };
simulate('케이스 C (초대형)', neutral, fC, 2000*OEK*10, 1000*OEK*10); // 2조, 1조

// 케이스 D: 유동성 점수 5, 예정지출 없음
console.log('\n==========================================================');
console.log('▶ 케이스 D: Liquidity=5, 예정지출 0');
console.log('  실제 쓸 돈 없음 → MMF는 점수로 올라가지만 ETF는 직접 깎이면 안 됨');
const scD = { ...neutral, liquidity:5 };
simulate('케이스 D (Liquidity=5, 지출없음)', scD, noFlow, 100*OEK, 100*OEK);

// ─── 변경 범위 요약 ───────────────────────────────────────────────────────────
console.log('\n\n==========================================================');
console.log('변경 범위 요약');
console.log('==========================================================');
console.log('[변경] liquidityReservePercent: scheduledPct/taxPct/annualDeficitPct → investableKrw 기준');
console.log('[변경] assetScoresFromAnalysis: taxPct/scheduledPct → investableKrw 기준');
console.log('[변경] growthCapacity: (scores.liquidity-3)*8 항 제거');
console.log('');
console.log('[유지] percentOfAssets() — 총자산 기준 함수 자체는 그대로 (7요인 점수 전달용)');
console.log('[유지] buildCalculationSteps cashPressurePct — 표시용, 총자산 기준 유지');
console.log('[유지] buildPortfolioViewModel taxPressurePct/cashPressurePct — recommendedId 판정, 총자산 기준 유지');
console.log('[유지] bond: (scores.liquidity-3)*4 가산 — 채권↑은 유동성 논리상 맞음, 건드리지 않음');
console.log('[유지] els: liquidity 패널티 — 건드리지 않음');
console.log('[유지] raw: liquidity>=4 패널티 — 건드리지 않음');
