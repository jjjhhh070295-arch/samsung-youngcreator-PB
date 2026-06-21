/**
 * SET→macroStress 변환 검증 스크립트
 * node scripts/test-stress-connect.mjs
 *
 * 검증 항목:
 * 1. setToMacroApiParams 변환 정확성
 * 2. 헤지자산 제외 + 재정규화 결과
 * 3. us+kr+bond 합계 1.0 확인
 * 4. 전체 포트폴리오 환산 방법 예시
 */

// ── 순수 JS로 assetMapping.ts 로직 재현 ──────────────────────────────
const OVERSEAS_PATTERN =
  /S&P|NVIDIA|Microsoft|Apple|Broadcom|Eli Lilly|Nasdaq|Nifty|미국|해외|나스닥|인도/i;
const ETF_OVERSEAS_RATIO_DEFAULT = 0.6;

function round1(v) { return Math.round(v * 10) / 10; }

function convertSetToIndices(set, etfHoldings) {
  const els = set.els ?? 0;
  const effectiveBond = set.bond + els * 0.7;
  const effectiveMmf = set.mmf + els * 0.3;
  let sp500, kospi;
  if (etfHoldings && etfHoldings.length > 0) {
    const total = etfHoldings.reduce((s, h) => s + h.weight, 0) || 1;
    const overseas = etfHoldings.reduce((s, h) => s + (OVERSEAS_PATTERN.test(h.name) ? h.weight : 0), 0);
    const ratio = Math.min(1, Math.max(0, overseas / total));
    sp500 = set.etf * ratio; kospi = set.etf * (1 - ratio);
  } else {
    sp500 = set.etf * ETF_OVERSEAS_RATIO_DEFAULT;
    kospi = set.etf * (1 - ETF_OVERSEAS_RATIO_DEFAULT);
  }
  const hedge = { gold: set.gold, dollar: set.dollar, raw: set.raw, mmf: effectiveMmf };
  const hedgeTotal = hedge.gold + hedge.dollar + hedge.raw + hedge.mmf;
  return { sp500: round1(sp500), kospi: round1(kospi), treasury: round1(effectiveBond), hedge, hedgeTotal: round1(hedgeTotal) };
}

function setToMacroApiParams(set, etfHoldings) {
  const idx = convertSetToIndices(set, etfHoldings);
  const equityBondTotal = idx.sp500 + idx.kospi + idx.treasury;
  const divisor = equityBondTotal > 0 ? equityBondTotal : 1;
  return {
    us: idx.sp500 / divisor, kr: idx.kospi / divisor, bond: idx.treasury / divisor,
    hedgePct: round1(idx.hedgeTotal), equityBondPct: round1(equityBondTotal),
    hedgeDetail: { ...idx.hedge },
  };
}

// ── 유틸 ─────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0.001) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual.toFixed(4)} (기대: ${expected})`);
}
function section(title) { console.log(`\n=== ${title} ===`); }

// ── 케이스 1: 요청 예시 (주식45/채권30/금10/MMF10/달러5) ─────────────
section('케이스1: etf45/bond30/gold10/mmf10/dollar5 — holdings 없음');
const c1 = setToMacroApiParams({ etf:45, bond:30, mmf:10, gold:10, dollar:5, raw:0 });
console.log('  변환 결과:', JSON.stringify(c1, null, 2));
console.log('\n  [계산 내역]');
console.log('  · 주식+채권 슬리브 = sp500(27) + kospi(18) + treasury(30) = 75%');
console.log('  · 헤지자산 = gold(10) + dollar(5) + mmf(10) = 25% → 제외');
console.log('  · macroStress 입력 = us=27/75 kr=18/75 bond=30/75');
check('us = 0.36 (27/75)', c1.us, 0.36);
check('kr = 0.24 (18/75)', c1.kr, 0.24);
check('bond = 0.40 (30/75)', c1.bond, 0.40);
check('us+kr+bond 합계 = 1.0', c1.us + c1.kr + c1.bond, 1.0);
check('hedgePct = 25.0', c1.hedgePct, 25.0);
check('equityBondPct = 75.0', c1.equityBondPct, 75.0);

console.log('\n  [전체 포트폴리오 환산 방법]');
console.log('  macroStress CVaR 95% = X% 이면');
console.log('  전체 포트폴리오 CVaR 95% ≈ X% × (75/100) = X% × 0.75');
console.log('  (헤지자산 25%는 macroStress 모델 밖 — 스트레스 미적용)');

// ── 케이스 2: 균형형 기본값 (etf42/bond46/gold8/raw3) ─────────────
section('케이스2: 균형형 기본값 etf42/bond46/gold8/raw3 (헤지 11%)');
const c2 = setToMacroApiParams({ etf:42, bond:46, mmf:0, gold:8, dollar:0, raw:3 });
console.log('  변환 결과:', JSON.stringify(c2));
check('us+kr+bond 합계 = 1.0', c2.us + c2.kr + c2.bond, 1.0);
check('hedgePct = 11.0', c2.hedgePct, 11.0);
check('equityBondPct = 88.0', c2.equityBondPct, 88.0); // 42+46=88

// ── 케이스 3: 헤지 0% (전체가 주식+채권) ────────────────────────────
section('케이스3: 헤지 0% — 정규화 no-op');
const c3 = setToMacroApiParams({ etf:60, bond:40, mmf:0, gold:0, dollar:0, raw:0 });
console.log('  변환 결과:', JSON.stringify(c3));
check('us = 0.36 (60×0.6/100)', c3.us, 0.36);
check('kr = 0.24 (60×0.4/100)', c3.kr, 0.24);
check('bond = 0.40', c3.bond, 0.40);
check('hedgePct = 0', c3.hedgePct, 0);
check('us+kr+bond = 1.0', c3.us + c3.kr + c3.bond, 1.0);

// ── 케이스 4: holdings 있음 (해외 80%) ──────────────────────────────
section('케이스4: holdings 있음 (해외 80%) — etf45/bond30/hedge25');
const holdings = [
  { name: 'TIGER S&P500', weight: 40 },
  { name: 'KODEX NASDAQ100', weight: 40 },
  { name: 'TIGER KOSPI200', weight: 20 },
];
const c4 = setToMacroApiParams({ etf:45, bond:30, mmf:10, gold:10, dollar:5, raw:0 }, holdings);
console.log('  변환 결과:', JSON.stringify(c4));
// sp500 = 45*0.8=36, kospi=45*0.2=9, treasury=30, hedge=25
// 재정규화: total=36+9+30=75 → us=36/75=0.48, kr=9/75=0.12, bond=30/75=0.40
check('us = 0.48 (해외 80%)', c4.us, 0.48);
check('kr = 0.12 (국내 20%)', c4.kr, 0.12);
check('us+kr+bond = 1.0', c4.us + c4.kr + c4.bond, 1.0);

// ── macroStress API URL 예시 ─────────────────────────────────────────
section('URL 파라미터 예시 (?us=&kr=&bond=&scenario=gfc)');
const params1 = new URLSearchParams({
  us: String(c1.us),
  kr: String(c1.kr),
  bond: String(c1.bond),
  scenario: 'gfc',
});
console.log(`  /api/macro-stress?${params1}`);
console.log(`  → macroStress 엔진이 받는 Weights: {sp500:${c1.us.toFixed(4)}, kospi:${c1.kr.toFixed(4)}, treasury:${c1.bond.toFixed(4)}}`);
console.log(`  → route.ts 내부 재정규화 후 합계: ${(c1.us+c1.kr+c1.bond).toFixed(4)} (이미 1.0이므로 변화 없음)`);

// ── 결과 ─────────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${fail === 0 ? '✅ 전체 통과' : `❌ ${fail}건 실패`} (통과 ${pass}건) ===\n`);

console.log('[헤지자산 처리 방식 정리]');
console.log('  정규화 방식: 주식+채권 합계로 재정규화 (헤지 제외)');
console.log('  예: etf45/bond30/hedge25 → us36% + kr24% + bond40% (합=100%)');
console.log('  macroStress 결과는 주식+채권 슬리브(75%) 기준');
console.log('  전체 포트폴리오 기준 환산: 결과 × (equityBondPct/100) = 결과 × 0.75');
console.log('  UI에 "헤지자산 25% 제외" 배너로 사용자에게 명시');
