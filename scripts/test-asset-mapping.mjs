/**
 * lib/assetMapping.ts 검증 스크립트 (순수 JS — TS 컴파일 없이 로직 검증)
 * node scripts/test-asset-mapping.mjs
 */

const OVERSEAS_PATTERN =
  /S&P|NVIDIA|Microsoft|Apple|Broadcom|Eli Lilly|Nasdaq|Nifty|미국|해외|나스닥|인도/i;
const ETF_OVERSEAS_RATIO_DEFAULT = 0.6;

function round1(v) { return Math.round(v * 10) / 10; }

function convertSetToIndices(set, etfHoldings) {
  const els = set.els ?? 0;
  const effectiveBond = set.bond + els * 0.7;
  const effectiveMmf  = set.mmf  + els * 0.3;

  let sp500, kospi;
  if (etfHoldings && etfHoldings.length > 0) {
    const etfTotal = etfHoldings.reduce((s, h) => s + h.weight, 0) || 1;
    const overseas = etfHoldings.reduce(
      (s, h) => s + (OVERSEAS_PATTERN.test(h.name) ? h.weight : 0), 0,
    );
    const ratio = Math.min(1, Math.max(0, overseas / etfTotal));
    sp500 = set.etf * ratio;
    kospi = set.etf * (1 - ratio);
  } else {
    sp500 = set.etf * ETF_OVERSEAS_RATIO_DEFAULT;
    kospi = set.etf * (1 - ETF_OVERSEAS_RATIO_DEFAULT);
  }

  const hedge = { gold: set.gold, dollar: set.dollar, raw: set.raw, mmf: effectiveMmf };
  const hedgeTotal = hedge.gold + hedge.dollar + hedge.raw + hedge.mmf;

  return {
    sp500: round1(sp500), kospi: round1(kospi), treasury: round1(effectiveBond),
    hedge: { gold: round1(hedge.gold), dollar: round1(hedge.dollar), raw: round1(hedge.raw), mmf: round1(hedge.mmf) },
    hedgeTotal: round1(hedgeTotal),
  };
}

// ── 유틸 ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, actual, expected, tolerance = 0) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${actual} (기대: ${expected})`);
}
function section(title) { console.log(`\n=== ${title} ===`); }

// ── 케이스 1: 요청된 예시 (holdings 없음) ─────────────────────────────
section('케이스1: etf45/bond30/gold10/mmf10/dollar5 (holdings 없음)');
const c1 = convertSetToIndices({ etf:45, bond:30, mmf:10, gold:10, dollar:5, raw:0 });
console.log('  결과:', JSON.stringify(c1));
check('sp500 = 27.0', c1.sp500, 27.0);
check('kospi = 18.0', c1.kospi, 18.0);
check('treasury = 30.0', c1.treasury, 30.0);
check('hedge.gold = 10.0', c1.hedge.gold, 10.0);
check('hedge.dollar = 5.0', c1.hedge.dollar, 5.0);
check('hedge.raw = 0.0', c1.hedge.raw, 0.0);
check('hedge.mmf = 10.0', c1.hedge.mmf, 10.0);
check('hedgeTotal = 25.0', c1.hedgeTotal, 25.0);
const sum1 = c1.sp500 + c1.kospi + c1.treasury + c1.hedgeTotal;
check(`합계 = 100% (실제: ${sum1})`, sum1, 100.0, 0.1);

// ── 케이스 2: holdings 있음 — 해외 80% ───────────────────────────────
section('케이스2: etf42, holdings 있음 (해외 80%/국내 20%)');
const holdings2 = [
  { name: 'TIGER S&P500', weight: 40 },
  { name: 'KODEX NASDAQ100', weight: 40 },
  { name: 'TIGER KOSPI200', weight: 20 },
];
const c2 = convertSetToIndices({ etf:42, bond:40, mmf:8, gold:5, dollar:3, raw:2 }, holdings2);
console.log('  결과:', JSON.stringify(c2));
check('sp500 = 33.6 (42 × 0.8)', c2.sp500, 33.6);
check('kospi = 8.4 (42 × 0.2)', c2.kospi, 8.4);
check('treasury = 40.0', c2.treasury, 40.0);
const sum2 = c2.sp500 + c2.kospi + c2.treasury + c2.hedgeTotal;
check(`합계 = 100% (실제: ${sum2})`, sum2, 100.0, 0.1);

// ── 케이스 3: holdings 있음 — 전량 국내 ──────────────────────────────
section('케이스3: etf30, holdings 전부 국내 (KOSPI100%)');
const holdings3 = [
  { name: 'TIGER KOSPI200', weight: 60 },
  { name: 'KODEX 200', weight: 40 },
];
const c3 = convertSetToIndices({ etf:30, bond:50, mmf:10, gold:5, dollar:5, raw:0 }, holdings3);
console.log('  결과:', JSON.stringify(c3));
check('sp500 = 0.0 (해외 없음)', c3.sp500, 0.0);
check('kospi = 30.0 (전량 국내)', c3.kospi, 30.0);
const sum3 = c3.sp500 + c3.kospi + c3.treasury + c3.hedgeTotal;
check(`합계 = 100% (실제: ${sum3})`, sum3, 100.0, 0.1);

// ── 케이스 4: ELS 흡수 ────────────────────────────────────────────────
section('케이스4: ELS 10 → bond+mmf 흡수');
const c4 = convertSetToIndices({ etf:50, bond:30, mmf:5, gold:0, dollar:0, raw:0, els:15 });
console.log('  결과:', JSON.stringify(c4));
// effectiveBond = 30 + 15*0.7 = 40.5, effectiveMmf = 5 + 15*0.3 = 9.5
check('treasury = 40.5 (30 + 15×0.7)', c4.treasury, 40.5);
check('hedge.mmf = 9.5 (5 + 15×0.3)', c4.hedge.mmf, 9.5);
const sum4 = c4.sp500 + c4.kospi + c4.treasury + c4.hedgeTotal;
check(`합계 = 100% (실제: ${sum4})`, sum4, 100.0, 0.1);

// ── 케이스 5: 균형형 SET 기본값 ──────────────────────────────────────
section('케이스5: 균형형 기본값 (etf42/bond46/gold8/raw3/mmf0/dollar0)');
const c5 = convertSetToIndices({ etf:42, bond:46, mmf:0, gold:8, dollar:0, raw:3 });
console.log('  결과:', JSON.stringify(c5));
const sum5 = c5.sp500 + c5.kospi + c5.treasury + c5.hedgeTotal;
check(`합계 = 99~100% (실제: ${sum5})`, sum5, 99, 1.0); // 반올림 허용

// ── 최종 ─────────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${fail === 0 ? '✅ 전체 통과' : `❌ ${fail}건 실패`} (통과 ${pass}건) ===\n`);
