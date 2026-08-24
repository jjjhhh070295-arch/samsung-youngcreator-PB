// 자산 3층 구조 + 경고 플래그 검증
// Node.js에서 TypeScript 없이 로직만 검증

const REAL_ESTATE_WARNING_THRESHOLD = 0.5;

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

const fmt = (n) => (n / 1e8).toFixed(0) + '억';

// ── 케이스 A: 총자산 400억, 부동산 300억, 주식 50억, 현금 50억 ──
const A = computeAssetLayer({
  stocksKrw:      50_00_000_000,
  realEstateKrw: 300_00_000_000,
  cashKrw:        50_00_000_000,
  totalKrw:      400_00_000_000,
});
console.log('[A] 총자산 400억, 부동산 300억, 주식 50억, 현금 50억');
console.log('  투자가능:', fmt(A.investableKrw), '→ 기대: 100억');
console.log('  부동산%:', A.realEstatePct.toFixed(1) + '%', '→ 기대: 75%');
console.log('  경고:', A.realEstateWarning ? '✅ 있음 — ' + A.realEstateWarning : '❌ 없음 (기대: 있어야 함)');

// ── 케이스 B: 총자산 100억, 부동산 30억, 주식 40억, 현금 30억 ──
const B = computeAssetLayer({
  stocksKrw:     40_00_000_000,
  realEstateKrw: 30_00_000_000,
  cashKrw:       30_00_000_000,
  totalKrw:     100_00_000_000,
});
console.log('\n[B] 총자산 100억, 부동산 30억, 주식 40억, 현금 30억');
console.log('  투자가능:', fmt(B.investableKrw), '→ 기대: 70억');
console.log('  부동산%:', B.realEstatePct.toFixed(1) + '%', '→ 기대: 30%');
console.log('  경고:', B.realEstateWarning ? '❌ 있음 (기대: 없어야 함)' : '✅ 없음');

// ── 케이스 C: 보유자산 없는 고객 (heldAssets undefined) ──
const C = computeAssetLayer(undefined);
console.log('\n[C] 보유자산 없는 고객 (heldAssets undefined)');
console.log('  결과:', C === null ? '✅ null (폴백 동작 정상)' : '❌ null이 아님 — 오류');
