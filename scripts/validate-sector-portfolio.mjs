/**
 * validate-sector-portfolio.mjs
 * 선B(portfolio) vs 선A(blendedBenchmark) 분리 검증
 * node scripts/validate-sector-portfolio.mjs
 */

// ── 유틸 (PortfolioPanel.tsx에서 복사) ─────────────────────────────────────
function finiteNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function fixedIncomeProxy(index, total, annualReturn) {
  if (total <= 1) return 0;
  return (Math.pow(1 + annualReturn / 100, index / (total - 1)) - 1) * 100;
}
function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

// ── FALLBACK_BENCHMARK_POINTS (PortfolioPanel.tsx와 동일) ──────────────────
const FALLBACK_BENCHMARK_POINTS = [
  { date: 'fallback-0',  label: '12M 전', sp500: 0,   kospi: 0,    bond: 0,   gold: 0,    dollar: 0,    commodity: 0    },
  { date: 'fallback-1',  label: '11M 전', sp500: -1.1, kospi: -2.0, bond: 0.2, gold: 1.6,  dollar: -0.4, commodity: -1.7 },
  { date: 'fallback-2',  label: '10M 전', sp500: -0.2, kospi: 1.8,  bond: -0.3,gold: 0.7,  dollar: 0.8,  commodity: -0.6 },
  { date: 'fallback-3',  label: '9M 전',  sp500: 2.1,  kospi: 0.9,  bond: 0.1, gold: 3.9,  dollar: 1.1,  commodity: 1.5  },
  { date: 'fallback-4',  label: '8M 전',  sp500: 3.7,  kospi: 4.4,  bond: 0.8, gold: 5.4,  dollar: -0.2, commodity: 0.2  },
  { date: 'fallback-5',  label: '7M 전',  sp500: 1.9,  kospi: 3.1,  bond: 0.4, gold: 4.8,  dollar: 1.7,  commodity: 2.8  },
  { date: 'fallback-6',  label: '6M 전',  sp500: 5.2,  kospi: 6.8,  bond: 1.1, gold: 7.2,  dollar: 1.2,  commodity: 1.9  },
  { date: 'fallback-7',  label: '5M 전',  sp500: 4.3,  kospi: 5.3,  bond: 1.0, gold: 6.1,  dollar: 2.4,  commodity: 4.1  },
  { date: 'fallback-8',  label: '4M 전',  sp500: 7.1,  kospi: 9.5,  bond: 1.7, gold: 10.4, dollar: 1.6,  commodity: 3.2  },
  { date: 'fallback-9',  label: '3M 전',  sp500: 6.4,  kospi: 7.7,  bond: 1.4, gold: 9.2,  dollar: 2.9,  commodity: 5.6  },
  { date: 'fallback-10', label: '2M 전',  sp500: 8.8,  kospi: 11.1, bond: 2.0, gold: 12.7, dollar: 2.0,  commodity: 4.3  },
  { date: 'fallback-11', label: '1M 전',  sp500: 7.6,  kospi: 9.4,  bond: 1.8, gold: 10.8, dollar: 1.3,  commodity: 3.8  },
  { date: 'fallback-12', label: '현재',   sp500: 9.2,  kospi: 6.4,  bond: 2.2, gold: 11.6, dollar: 1.8,  commodity: 4.9  },
];

// ── buildSimplifiedBenchmarkChartData 재현 ────────────────────────────────
// PortfolioPanel.tsx의 함수와 동일한 로직 (TypeScript → JS 변환)
function buildSimplifiedBenchmarkChartData(
  points,
  weights,
  overseasEquityWeight = 0,   // 단순화: 해외 비중 직접 주입
  planSummary = [],
  sectorEtfData = {},
) {
  const sourcePoints = points.length >= 2 ? points : FALLBACK_BENCHMARK_POINTS;
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0) || 100;
  const domesticEquityWeight = Math.max(0, weights.etf - overseasEquityWeight);

  // sector ETF weights (선B용)
  const etfKrw = new Map();
  for (const p of planSummary) {
    if (p.isFallback || p.amountKrw <= 0) continue;
    const series = sectorEtfData[p.etfCode];
    if (!series || series.length < 2) continue;
    etfKrw.set(p.etfCode, (etfKrw.get(p.etfCode) ?? 0) + p.amountKrw);
  }
  const totalEtfKrw = etfKrw.size > 0
    ? Array.from(etfKrw.values()).reduce((a, b) => a + b, 0)
    : 0;
  const etfEntries = totalEtfKrw > 0
    ? Array.from(etfKrw.entries()).map(([code, krw]) => ({ krw, series: sectorEtfData[code] }))
    : [];

  return sourcePoints.map((point, index) => {
    const usTreasury10y = finiteNumber(point.usTreasury10y, fixedIncomeProxy(index, sourcePoints.length, 3.2));
    const mmf     = finiteNumber(point.mmf,       fixedIncomeProxy(index, sourcePoints.length, 3.0));
    const gold    = finiteNumber(point.gold,      fixedIncomeProxy(index, sourcePoints.length, 4.0));
    const dollar  = finiteNumber(point.dollar,    fixedIncomeProxy(index, sourcePoints.length, 2.3));
    const commodity = finiteNumber(point.commodity, fixedIncomeProxy(index, sourcePoints.length, 3.6));

    const blendedBenchmark =
      (overseasEquityWeight  / totalWeight) * finiteNumber(point.sp500) +
      (domesticEquityWeight  / totalWeight) * finiteNumber(point.kospi, finiteNumber(point.sp500)) +
      (weights.bond   / totalWeight) * usTreasury10y +
      (weights.mmf    / totalWeight) * mmf +
      (weights.gold   / totalWeight) * gold +
      (weights.dollar / totalWeight) * dollar +
      (weights.raw    / totalWeight) * commodity;

    const hasSectorData = etfEntries.length > 0 && etfEntries.every((e) => index < e.series.length);
    const nonEquityReturn =
      (weights.bond   / totalWeight) * usTreasury10y +
      (weights.mmf    / totalWeight) * mmf +
      (weights.gold   / totalWeight) * gold +
      (weights.dollar / totalWeight) * dollar +
      (weights.raw    / totalWeight) * commodity;
    const portfolioReturn = hasSectorData
      ? (weights.etf / totalWeight) * etfEntries.reduce((sum, e) => sum + (e.krw / totalEtfKrw) * (e.series[index] ?? 0), 0) + nonEquityReturn
      : blendedBenchmark;

    return {
      label: point.label,
      portfolio:        roundPercent(portfolioReturn),
      blendedBenchmark: roundPercent(blendedBenchmark),
    };
  });
}

// ── 공통 weights (balanced 기준) ──────────────────────────────────────────
const WEIGHTS = { etf: 34, bond: 45, mmf: 8, gold: 7, dollar: 4, raw: 2 };

// ── 가상 섹터 ETF 데이터 (조선·방산이 시장보다 크게 오른 시나리오) ─────────
// 13개 포인트: 0%, +5%, +8%, ... → 조선ETF가 kospi보다 약 2배 상승
const SECTOR_SERIES_SHIP = [0, 3.2, 6.0, 10.5, 14.8, 12.0, 18.4, 16.9, 22.1, 19.7, 26.3, 23.1, 28.5];
const SECTOR_SERIES_DEF  = [0, 4.1, 7.8, 12.3, 17.2, 14.5, 21.0, 19.3, 25.4, 22.6, 30.1, 27.2, 33.7];
// market 폴백용: 섹터ETF 없음 (=sectorEtfData에 포함 안 됨)

// ── 테스트 러너 ───────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL  ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function printTable(rows) {
  const header = `  ${'월'.padEnd(8)} ${'portfolio'.padStart(10)} ${'benchmark'.padStart(10)} ${'diff'.padStart(8)}`;
  console.log(header);
  for (const r of rows) {
    const diff = roundPercent(r.portfolio - r.blendedBenchmark);
    const diffStr = diff === 0 ? '   0.0' : (diff > 0 ? '+' : '') + diff.toFixed(1);
    console.log(`  ${r.label.padEnd(8)} ${String(r.portfolio).padStart(10)} ${String(r.blendedBenchmark).padStart(10)} ${diffStr.padStart(8)}`);
  }
}

// ════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
console.log(' 선B vs 선A 분리 검증');
console.log('══════════════════════════════════════════════════\n');

// ── CASE 1: 종목 0개 → 선A == 선B ────────────────────────────────────────
console.log('▶ CASE 1: planSummary=[] — 선A == 선B (겹쳐야 함)');
{
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, [], {}
  );
  const allEqual = result.every(r => r.portfolio === r.blendedBenchmark);
  assert('종목 0개: 모든 포인트 portfolio === blendedBenchmark', allEqual);
  if (!allEqual) {
    const diffs = result.filter(r => r.portfolio !== r.blendedBenchmark);
    console.log('    불일치 포인트:', diffs.map(r => `${r.label}(P=${r.portfolio},B=${r.blendedBenchmark})`).join(', '));
  }
  console.log();
}

// ── CASE 2: 조선·방산 편입 → 선B가 선A와 갈라짐 ─────────────────────────
console.log('▶ CASE 2: 조선(441540)·방산(463250) 편입 — 선B ≠ 선A');
{
  const planSummary = [
    { etfCode: '441540', amountKrw: 30_000_000, isFallback: false },
    { etfCode: '463250', amountKrw: 20_000_000, isFallback: false },
  ];
  const sectorEtfData = {
    '441540': SECTOR_SERIES_SHIP,
    '463250': SECTOR_SERIES_DEF,
  };
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, sectorEtfData
  );
  const anyDiff = result.some(r => r.portfolio !== r.blendedBenchmark);
  const finalDiff = roundPercent(result[12].portfolio - result[12].blendedBenchmark);
  assert('섹터편입: 최소 1 포인트 portfolio ≠ blendedBenchmark', anyDiff);
  assert('섹터편입: 마지막 포인트 diff > 0 (조선·방산이 시장 상회)', finalDiff > 0,
    `마지막 diff=${finalDiff}`);
  console.log();
  console.log('  포인트별 수익률 비교:');
  printTable(result);
  console.log();
}

// ── CASE 3: market 폴백 종목만 → 섹터ETF 없음 → 선A == 선B 폴백 ──────────
console.log('▶ CASE 3: isFallback:true 종목만 편입 — 선A == 선B 유지');
{
  const planSummary = [
    { etfCode: '441540', amountKrw: 10_000_000, isFallback: true },  // 폴백 → 제외돼야
    { etfCode: '463250', amountKrw: 15_000_000, isFallback: true },  // 폴백 → 제외돼야
  ];
  const sectorEtfData = {
    '441540': SECTOR_SERIES_SHIP,
    '463250': SECTOR_SERIES_DEF,
  };
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, sectorEtfData
  );
  const allEqual = result.every(r => r.portfolio === r.blendedBenchmark);
  assert('isFallback:true 종목은 계산에서 제외 → 선A == 선B', allEqual);
  console.log();
}

// ── CASE 4: 섹터ETF 데이터가 비었을 때 NaN 없음 ─────────────────────────
console.log('▶ CASE 4: sectorEtfData={} — NaN/undefined 없음');
{
  const planSummary = [
    { etfCode: '441540', amountKrw: 50_000_000, isFallback: false },
  ];
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, {}
  );
  const hasNaN = result.some(r => isNaN(r.portfolio) || isNaN(r.blendedBenchmark));
  const hasUndef = result.some(r => r.portfolio === undefined || r.blendedBenchmark === undefined);
  assert('sectorEtfData={}: portfolio에 NaN 없음', !hasNaN);
  assert('sectorEtfData={}: portfolio에 undefined 없음', !hasUndef);
  assert('sectorEtfData={}: 폴백으로 선A == 선B', result.every(r => r.portfolio === r.blendedBenchmark));
  console.log();
}

// ── CASE 5: 섹터ETF 배열 길이 < 벤치마크 포인트 수 → index 초과 안 깨짐 ───
console.log('▶ CASE 5: 섹터ETF 배열이 짧을 때 (5개) — index 초과 방어');
{
  const shortSeries = [0, 2.1, 4.5, 8.3, 11.7]; // 5개뿐 (벤치 13개)
  const planSummary = [
    { etfCode: '441540', amountKrw: 30_000_000, isFallback: false },
  ];
  const sectorEtfData = { '441540': shortSeries };
  let threw = false;
  let result;
  try {
    result = buildSimplifiedBenchmarkChartData(
      FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, sectorEtfData
    );
  } catch (e) {
    threw = true;
    console.log('    예외:', e.message);
  }
  assert('배열 길이 불일치: 예외 발생 안 함', !threw);
  if (result) {
    const hasNaN = result.some(r => isNaN(r.portfolio) || isNaN(r.blendedBenchmark));
    assert('배열 길이 불일치: NaN 없음', !hasNaN);
    // index >= 5인 포인트는 hasSectorData=false → blendedBenchmark로 폴백
    const pt6 = result[6]; // series[6] 없음 → 폴백이어야
    assert('짧은 배열의 범위 초과 포인트 → 선A로 폴백', pt6 && pt6.portfolio === pt6.blendedBenchmark,
      `pt6: P=${pt6?.portfolio}, B=${pt6?.blendedBenchmark}`);
    // index < 5인 포인트는 섹터ETF 반영 (series.length >= 2이므로)
    const pt2 = result[2];
    assert('짧은 배열의 유효 포인트 → 섹터ETF 반영됨', pt2 && pt2.portfolio !== pt2.blendedBenchmark,
      `pt2: P=${pt2?.portfolio}, B=${pt2?.blendedBenchmark}`);
  }
  console.log();
}

// ── CASE 6: amountKrw=0 종목은 제외 ─────────────────────────────────────
console.log('▶ CASE 6: amountKrw=0 — 계산에서 제외');
{
  const planSummary = [
    { etfCode: '441540', amountKrw: 0, isFallback: false }, // 제외돼야
  ];
  const sectorEtfData = { '441540': SECTOR_SERIES_SHIP };
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, sectorEtfData
  );
  assert('amountKrw=0: 선A == 선B (제외)', result.every(r => r.portfolio === r.blendedBenchmark));
  console.log();
}

// ── CASE 7: 섞인 planSummary (유효+폴백+zero) ───────────────────────────
console.log('▶ CASE 7: 유효 종목 1개 + 폴백 1개 + zero 1개 혼합');
{
  const planSummary = [
    { etfCode: '441540', amountKrw: 40_000_000, isFallback: false },  // 유효
    { etfCode: '463250', amountKrw: 20_000_000, isFallback: true  },  // 폴백 → 제외
    { etfCode: '091160', amountKrw: 0,           isFallback: false },  // zero → 제외
  ];
  const sectorEtfData = {
    '441540': SECTOR_SERIES_SHIP,
    '463250': SECTOR_SERIES_DEF,
    '091160': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  };
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, planSummary, sectorEtfData
  );
  // 유효 종목 1개(441540)만 반영 → 선A ≠ 선B
  const anyDiff = result.some(r => r.portfolio !== r.blendedBenchmark);
  assert('혼합: 유효 종목만 반영 → 선A ≠ 선B', anyDiff);
  // 아무 NaN도 없어야
  const hasNaN = result.some(r => isNaN(r.portfolio));
  assert('혼합: NaN 없음', !hasNaN);
  console.log();
}

// ── CASE 8: 기존 동작 회귀 — 종목 0개일 때 benchmark 값이 이전과 동일 ───
console.log('▶ CASE 8: 회귀 — balanced weights, 종목 없음, 벤치마크 최종값');
{
  const result = buildSimplifiedBenchmarkChartData(
    FALLBACK_BENCHMARK_POINTS, WEIGHTS, 0, [], {}
  );
  // 마지막 포인트(현재): 비중×자산수익률 직접 계산으로 크로스체크
  const pt = FALLBACK_BENCHMARK_POINTS[12];
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0); // 100
  const len = FALLBACK_BENCHMARK_POINTS.length;
  const usTreasury10y = fixedIncomeProxy(12, len, 3.2);
  const mmf    = fixedIncomeProxy(12, len, 3.0);
  const gold   = pt.gold;
  const dollar = pt.dollar;
  const commodity = fixedIncomeProxy(12, len, 3.6);
  const expected = roundPercent(
    (WEIGHTS.etf    / total) * pt.kospi +
    (WEIGHTS.bond   / total) * usTreasury10y +
    (WEIGHTS.mmf    / total) * mmf +
    (WEIGHTS.gold   / total) * gold +
    (WEIGHTS.dollar / total) * dollar +
    (WEIGHTS.raw    / total) * commodity
  );
  const actual = result[12].blendedBenchmark;
  assert(`마지막 blendedBenchmark = ${actual}% (기대 ≈${expected}%)`, Math.abs(actual - expected) < 0.2,
    `actual=${actual}, expected=${expected}`);
  console.log();
}

// ── 요약 ──────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════');
console.log(` 결과: ${passed}개 통과 / ${failed}개 실패`);
console.log('══════════════════════════════════════════════════\n');
if (failed > 0) process.exit(1);
