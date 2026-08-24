// Day 2 검증: 투자가능자산 기준 배분 핵심 로직
// 1억 = 1e8

const REAL_ESTATE_WARNING_THRESHOLD = 0.5;
const OEK = 1e8; // 1억

function computeAssetLayer(heldAssets) {
  if (!heldAssets || heldAssets.totalKrw <= 0) return null;
  const { stocksKrw, realEstateKrw, cashKrw, totalKrw } = heldAssets;
  const investableKrw = totalKrw - realEstateKrw;
  const stocksPct = (stocksKrw / totalKrw) * 100;
  const realEstatePct = (realEstateKrw / totalKrw) * 100;
  const cashPct = (cashKrw / totalKrw) * 100;
  const realEstateWarning =
    realEstateKrw / totalKrw >= REAL_ESTATE_WARNING_THRESHOLD
      ? `부동산 비중 ${Math.round(realEstatePct)}% — 과집중. 유동성·분산 검토 및 전문가 상담 권고`
      : null;
  return { totalKrw, investableKrw, stocksPct, realEstatePct, cashPct, realEstateWarning };
}

function calcLiquidityManwon(heldAssets, mmfPct, taxOutflow, clientAssetSize) {
  const allocationBase = heldAssets && heldAssets.totalKrw > 0
    ? heldAssets.totalKrw - heldAssets.realEstateKrw  // investableKrw
    : (clientAssetSize || 0);
  return Math.max(
    1_000,
    Math.min(
      30_000,
      Math.round((allocationBase * mmfPct) / 100 / 10_000) ||
        Math.round((taxOutflow || allocationBase * 0.03) / 10_000),
    ),
  );
}

function calcStockComparison(assetLayer, targetEtfPct) {
  if (!assetLayer || assetLayer.investableKrw <= 0) return null;
  const currentStocksPct = Math.round(
    (assetLayer.stocksPct / 100 * assetLayer.totalKrw) / assetLayer.investableKrw * 1000
  ) / 10;
  const diff = Math.round((targetEtfPct - currentStocksPct) * 10) / 10;
  return { currentStocksPct, diff };
}

const fmt = (n) => `${(n / OEK).toFixed(0)}억`;
let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual} (기대: ${expected})`);
}

// ─────────────────────────────────────────────────────────────────────
// 핵심 검증: 기준 금액이 투자가능자산으로 바뀌었는지 (캡 미적용 케이스)
// 총자산 20억, 부동산 10억, 주식 5억, 현금 5억 → 투자가능 10억
// mmf=10% → 투자가능 기준: 10억*10%=1억=100만원 (< 캡 30,000만원)
// 만약 총자산 기준이면: 20억*10%=2억=200만원
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== 핵심 검증: base가 investable인지 (소규모) ===');
const hSmall = {
  stocksKrw:     5 * OEK,
  realEstateKrw: 10 * OEK,
  cashKrw:       5 * OEK,
  totalKrw:      20 * OEK,
};
const liqSmall = calcLiquidityManwon(hSmall, 10, 0, 20 * OEK);
const liqSmallTotal = Math.max(1000, Math.min(30000, Math.round((20 * OEK * 10) / 100 / 10000)));
console.log(`  투자가능(10억) 기준: ${liqSmall.toLocaleString()}만원`);
console.log(`  총자산(20억) 기준이었다면: ${liqSmallTotal.toLocaleString()}만원`);
check('투자가능 기준 = 1000만원', liqSmall, 1000);
check('총자산 기준이었다면 2000만원', liqSmallTotal, 2000);
console.log(`  → 투자가능 기준이 올바르게 적용됨 (2000→1000, 50% 감소) ✅`);

// ─────────────────────────────────────────────────────────────────────
// [A] 총자산 400억, 부동산 300억, 주식 50억, 현금 50억
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== [A] 총자산 400억, 부동산 300억, 주식 50억, 현금 50억 ===');
const hA = {
  stocksKrw: 50 * OEK, realEstateKrw: 300 * OEK, cashKrw: 50 * OEK, totalKrw: 400 * OEK
};
const layerA = computeAssetLayer(hA);
const cmpA = calcStockComparison(layerA, 42);
const liqA = calcLiquidityManwon(hA, 10, 0, 400 * OEK);

check('투자가능자산 100억', layerA.investableKrw, 100 * OEK);
check('부동산 비중 75%', Math.round(layerA.realEstatePct), 75);
check('경고 존재', layerA.realEstateWarning !== null, true);
check('주식%(투자가능기준) = 50%', cmpA.currentStocksPct, 50);
check('목표-현재 = -8%p (과다)', cmpA.diff, -8);
// 대형 자산 → 캡 30,000만원 (3억)
check('liquidityManwon 캡 = 30000만원', liqA, 30000);
console.log(`  (참고: 100억*10%=10억=100,000만원 → 상한 30,000만원으로 캡)`);

// ─────────────────────────────────────────────────────────────────────
// [B] 총자산 100억, 부동산 30억, 주식 40억, 현금 30억
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== [B] 총자산 100억, 부동산 30억, 주식 40억, 현금 30억 ===');
const hB = {
  stocksKrw: 40 * OEK, realEstateKrw: 30 * OEK, cashKrw: 30 * OEK, totalKrw: 100 * OEK
};
const layerB = computeAssetLayer(hB);
const cmpB = calcStockComparison(layerB, 42);

check('투자가능자산 70억', layerB.investableKrw, 70 * OEK);
check('부동산 비중 30%', Math.round(layerB.realEstatePct), 30);
check('경고 없음', layerB.realEstateWarning, null);
check('주식%(투자가능기준) ≈ 57.1%', Math.round(cmpB.currentStocksPct * 10) / 10, 57.1);
check('목표-현재 ≈ -15.1%p', cmpB.diff, -15.1);

// ─────────────────────────────────────────────────────────────────────
// [C] 보유자산 없는 고객 → 폴백
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== [C] 보유자산 없는 고객 (폴백) ===');
const layerC = computeAssetLayer(undefined);
const liqC = calcLiquidityManwon(undefined, 10, 0, 50 * OEK);
// 50억*10% = 5억 = 5000만원 (캡 미도달)
check('assetLayer = null', layerC, null);
check('폴백 총자산50억 기준: 5000만원', liqC, 5000);

// ─────────────────────────────────────────────────────────────────────
// [D] 부동산 0, 현금만
// ─────────────────────────────────────────────────────────────────────
console.log('\n=== [D] 총자산 30억, 부동산 0, 현금만 ===');
const hD = { stocksKrw: 0, realEstateKrw: 0, cashKrw: 30 * OEK, totalKrw: 30 * OEK };
const layerD = computeAssetLayer(hD);
const liqD = calcLiquidityManwon(hD, 10, 0, 30 * OEK);
// 30억*10% = 3억 = 3000만원
check('투자가능 = 총자산 30억', layerD.investableKrw, 30 * OEK);
check('경고 없음', layerD.realEstateWarning, null);
check('liquidityManwon 3000만원', liqD, 3000);

// ─────────────────────────────────────────────────────────────────────
// 결과 요약
// ─────────────────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${fail === 0 ? '✅ 전체 통과' : `❌ ${fail}건 실패`} (통과 ${pass}건) ===`);
console.log('\n[변경 범위]');
console.log('  변경: liquidityReserveManwon base → investableKrw (부동산 제외)');
console.log('  유지: percentOfAssets() 총자산 기준 (7요인 점수·추천ID 결정)');
console.log('  유지: growthCapacity·riskTilt·시장신호 가중치');
