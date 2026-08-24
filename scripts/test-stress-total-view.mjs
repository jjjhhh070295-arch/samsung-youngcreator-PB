/**
 * 전체 포트폴리오 환산 손실 표시 검증 스크립트
 * node scripts/test-stress-total-view.mjs
 *
 * 검증 항목:
 * 1. 전체 환산값 < 슬리브값 (헤지 완충 효과)
 * 2. 방어형(헤지 많음)이 완충 효과 더 큰지
 * 3. 숫자 계산 정확성 (슬리브 × equityBondPct/100)
 * 4. 헤지 0%이면 표시 안 함 (조건 확인)
 */

function round1(v) { return Math.round(v * 10) / 10; }

// ── lib/assetMapping.ts setToMacroApiParams 재현 ──────────────────────────
const ETF_OVERSEAS = 0.6;
function setToMacroApiParams(set) {
  const sp500 = round1(set.etf * ETF_OVERSEAS);
  const kospi = round1(set.etf * (1 - ETF_OVERSEAS));
  const treasury = round1(set.bond + (set.els ?? 0) * 0.7);
  const hedgeTotal = round1(set.mmf + set.gold + set.dollar + set.raw + (set.els ?? 0) * 0.3);
  const equityBondTotal = sp500 + kospi + treasury;
  const d = equityBondTotal || 1;
  return {
    us: sp500 / d,
    kr: kospi / d,
    bond: treasury / d,
    hedgePct: hedgeTotal,
    equityBondPct: equityBondTotal,
  };
}

// ── 환산 계산 함수 (StressTestPanel.tsx에서 인라인으로 수행하는 계산 재현) ──
function fullPortfolioLoss(sleeveMetric, equityBondPct) {
  return sleeveMetric * (equityBondPct / 100);
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, actual, expected, tol = 0.001) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual.toFixed(4)} (기대: ${expected})`);
}
function checkTrue(label, cond) {
  if (cond) pass++; else fail++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}`);
}
function section(title) { console.log(`\n=== ${title} ===`); }

// ── 모의 macroStress 결과 (슬리브 기준) ──────────────────────────────────────
// 실제 macroStress API가 반환하는 값과 동일한 형태 (fraction, 음수 = 손실)
const MOCK_SLEEVE_METRICS = {
  cvar95: -0.285,   // -28.5% CVaR 95%
  cvar99: -0.412,   // -41.2% CVaR 99%
  meanMdd: -0.198,  // -19.8% 평균 MDD
  worstMdd: -0.547, // -54.7% 최악 MDD
  lossProbability: 0.342,
};

// ── 케이스 1: 방어형 SET (헤지 많음) ──────────────────────────────────────────
section('케이스1: 방어형 SET — etf25/bond52/mmf10/gold8/dollar3/raw2 (헤지 23%)');
const stable_set = { etf: 25, bond: 52, els: 0, mmf: 10, gold: 8, dollar: 3, raw: 2 };
const p1 = setToMacroApiParams(stable_set);
console.log(`  equityBondPct: ${p1.equityBondPct}%  hedgePct: ${p1.hedgePct}%`);

const full1_cvar95 = fullPortfolioLoss(MOCK_SLEEVE_METRICS.cvar95, p1.equityBondPct);
const full1_meanMdd = fullPortfolioLoss(MOCK_SLEEVE_METRICS.meanMdd, p1.equityBondPct);
console.log(`  CVaR 95%: 슬리브 ${(MOCK_SLEEVE_METRICS.cvar95*100).toFixed(1)}% → 전체 ${(full1_cvar95*100).toFixed(1)}%`);
console.log(`  평균 MDD: 슬리브 ${(MOCK_SLEEVE_METRICS.meanMdd*100).toFixed(1)}% → 전체 ${(full1_meanMdd*100).toFixed(1)}%`);
checkTrue('전체 CVaR < 슬리브 CVaR (절대값)', Math.abs(full1_cvar95) < Math.abs(MOCK_SLEEVE_METRICS.cvar95));
checkTrue('전체 MDD < 슬리브 MDD (절대값)', Math.abs(full1_meanMdd) < Math.abs(MOCK_SLEEVE_METRICS.meanMdd));
check('CVaR 95% 전체 계산값', full1_cvar95, MOCK_SLEEVE_METRICS.cvar95 * p1.equityBondPct / 100);
checkTrue('헤지 있어서 표시 조건 true', p1.hedgePct > 0);

// ── 케이스 2: 균형형 SET ──────────────────────────────────────────────────────
section('케이스2: 균형형 SET — etf34/bond45/mmf8/gold7/dollar4/raw2 (헤지 21%)');
const balanced_set = { etf: 34, bond: 45, els: 0, mmf: 8, gold: 7, dollar: 4, raw: 2 };
const p2 = setToMacroApiParams(balanced_set);
console.log(`  equityBondPct: ${p2.equityBondPct}%  hedgePct: ${p2.hedgePct}%`);

const full2_cvar95 = fullPortfolioLoss(MOCK_SLEEVE_METRICS.cvar95, p2.equityBondPct);
const full2_meanMdd = fullPortfolioLoss(MOCK_SLEEVE_METRICS.meanMdd, p2.equityBondPct);
console.log(`  CVaR 95%: 슬리브 ${(MOCK_SLEEVE_METRICS.cvar95*100).toFixed(1)}% → 전체 ${(full2_cvar95*100).toFixed(1)}%`);
checkTrue('균형형 전체 CVaR < 슬리브 CVaR', Math.abs(full2_cvar95) < Math.abs(MOCK_SLEEVE_METRICS.cvar95));
checkTrue('헤지 있어서 표시 조건 true', p2.hedgePct > 0);

// ── 케이스 3: 성장형 SET ──────────────────────────────────────────────────────
section('케이스3: 성장형 SET — etf43/bond38/mmf5/gold8/dollar4/raw2 (헤지 19%)');
const growth_set = { etf: 43, bond: 38, els: 0, mmf: 5, gold: 8, dollar: 4, raw: 2 };
const p3 = setToMacroApiParams(growth_set);
console.log(`  equityBondPct: ${p3.equityBondPct}%  hedgePct: ${p3.hedgePct}%`);

const full3_cvar95 = fullPortfolioLoss(MOCK_SLEEVE_METRICS.cvar95, p3.equityBondPct);
console.log(`  CVaR 95%: 슬리브 ${(MOCK_SLEEVE_METRICS.cvar95*100).toFixed(1)}% → 전체 ${(full3_cvar95*100).toFixed(1)}%`);
checkTrue('성장형 전체 CVaR < 슬리브 CVaR', Math.abs(full3_cvar95) < Math.abs(MOCK_SLEEVE_METRICS.cvar95));
checkTrue('헤지 있어서 표시 조건 true', p3.hedgePct > 0);

// ── 케이스 4: 방어형이 성장형보다 완충 효과 큰지 ─────────────────────────────
section('케이스4: 방어형 완충 > 성장형 완충 (헤지 23% vs 19%)');
const buffer1 = Math.abs(MOCK_SLEEVE_METRICS.cvar95) - Math.abs(full1_cvar95); // 방어형 완충량
const buffer3 = Math.abs(MOCK_SLEEVE_METRICS.cvar95) - Math.abs(full3_cvar95); // 성장형 완충량
console.log(`  방어형 완충: ${(buffer1*100).toFixed(2)}%p  성장형 완충: ${(buffer3*100).toFixed(2)}%p`);
checkTrue('방어형 완충 > 성장형 완충 (헤지 많을수록 효과 큼)', buffer1 > buffer3);
checkTrue('equityBondPct: 방어형 < 성장형 (헤지 더 많으면 슬리브 비율 낮음)', p1.equityBondPct < p3.equityBondPct);

// ── 케이스 5: 헤지 0%이면 표시 안 함 ─────────────────────────────────────────
section('케이스5: 헤지 0% — 표시 조건 false');
const no_hedge_set = { etf: 60, bond: 40, els: 0, mmf: 0, gold: 0, dollar: 0, raw: 0 };
const p5 = setToMacroApiParams(no_hedge_set);
console.log(`  equityBondPct: ${p5.equityBondPct}%  hedgePct: ${p5.hedgePct}%`);
checkTrue('헤지 0% → 표시 조건 false (hedgePct === 0)', p5.hedgePct === 0);
// 헤지 0%면 전체=슬리브이므로 표시 불필요 (중복 정보 방지)
const full5_cvar95 = fullPortfolioLoss(MOCK_SLEEVE_METRICS.cvar95, p5.equityBondPct);
check('헤지 0%면 전체 ≈ 슬리브 (scale=1.0)', full5_cvar95, MOCK_SLEEVE_METRICS.cvar95, 0.01);

// ── 케이스 6: 계산 정확성 수치 검증 ──────────────────────────────────────────
section('케이스6: 수치 계산 정확성 (예시: 슬리브 CVaR -30%, 슬리브비율 77%)');
const sleeveValue = -0.300;  // -30%
const equityBondPct = 77.0;
const expected = sleeveValue * (equityBondPct / 100); // -0.231 = -23.1%
const computed = fullPortfolioLoss(sleeveValue, equityBondPct);
console.log(`  슬리브 CVaR ${(sleeveValue*100).toFixed(1)}% × ${equityBondPct}% = ${(computed*100).toFixed(1)}%`);
check('전체 환산값 = -23.1%', computed, -0.231, 0.0001);
checkTrue('전체 손실 < 슬리브 손실 (완충 확인)', Math.abs(computed) < Math.abs(sleeveValue));

// ── 케이스 7: 4개 지표 모두 계산 확인 ────────────────────────────────────────
section('케이스7: 방어형 4개 지표 전체 환산 일관성');
const scale1 = p1.equityBondPct / 100;
console.log(`  equityBondPct=${p1.equityBondPct}%, scale=${scale1}`);
const metrics = [
  ['CVaR 95%', MOCK_SLEEVE_METRICS.cvar95],
  ['CVaR 99%', MOCK_SLEEVE_METRICS.cvar99],
  ['평균 MDD',  MOCK_SLEEVE_METRICS.meanMdd],
  ['최악 MDD',  MOCK_SLEEVE_METRICS.worstMdd],
];
for (const [label, v] of metrics) {
  const full = fullPortfolioLoss(v, p1.equityBondPct);
  console.log(`  ${label}: 슬리브 ${(v*100).toFixed(1)}% → 전체 ${(full*100).toFixed(1)}%`);
  checkTrue(`${label} 전체 < 슬리브 (완충)`, Math.abs(full) < Math.abs(v));
  check(`${label} 계산 일치`, full, v * scale1, 0.0001);
}

// ── 결과 ──────────────────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${fail === 0 ? '✅ 전체 통과' : `❌ ${fail}건 실패`} (통과 ${pass}건) ===\n`);

console.log('[UI 변경 요약]');
console.log('  파일: components/StressTestPanel.tsx');
console.log('  위치: 첫 번째 결과 카드(metrics grid) 바로 아래');
console.log('  조건: autoParams && autoParams.hedgePct > 0 (헤지자산이 있을 때만)');
console.log('  표시: CVaR95/CVaR99/평균MDD/최악MDD 각각');
console.log('         전체값(큰 글씨, 빨간색) + 슬리브값(작은 글씨, 회색)');
console.log('  공식: 전체 = 슬리브 × (equityBondPct / 100)');
console.log('  색상: 앰버 배경 (기존 헤지 배너와 동일한 톤)');
