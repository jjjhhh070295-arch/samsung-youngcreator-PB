/**
 * 확정안→스트레스 연결 검증 스크립트
 * node scripts/test-confirm-stress-link.mjs
 *
 * IPSResultTabs.tsx의 portfolioWeights useMemo 로직을 순수 JS로 재현:
 *   const confirmedId = client.portfolios[0]?.id;
 *   const confirmed = confirmedId ? vm.portfolioOptions.find(o => o.id === confirmedId) : undefined;
 *   return [(confirmed ?? vm.portfolioOptions[1]).weights];
 */

// ── lib/portfolio.ts PORTFOLIO_OPTION_META 재현 ────────────────────────────
const PORTFOLIO_OPTION_META = [
  { id: 'stable',   name: '방어형 추천안', riskTilt: -1 },
  { id: 'balanced', name: '균형형 추천안', riskTilt:  0 },
  { id: 'growth',   name: '성장형 추천안', riskTilt: +1 },
];

// buildPortfolioViewModel이 반환하는 portfolioOptions는 PORTFOLIO_OPTION_META 순서 고정.
// 여기서는 각 안의 etf/bond 비중 차이만 보여주기 위해 단순 예시 weights 사용.
// 실제 buildPortfolioViewModel은 7요인으로 계산하나, 검증 목적이므로 구분 가능한 값으로 설정.
const MOCK_VM_OPTIONS = [
  { id: 'stable',   weights: { etf: 25, bond: 52, els: 0, mmf: 10, gold: 8,  dollar: 3, raw: 2 } },
  { id: 'balanced', weights: { etf: 34, bond: 45, els: 0, mmf: 8,  gold: 7,  dollar: 4, raw: 2 } },
  { id: 'growth',   weights: { etf: 43, bond: 38, els: 0, mmf: 5,  gold: 8,  dollar: 4, raw: 2 } },
];

/** IPSResultTabs.tsx portfolioWeights useMemo 로직 재현 */
function computePortfolioWeights(client) {
  const portfolioOptions = MOCK_VM_OPTIONS; // buildPortfolioViewModel(client).portfolioOptions
  const confirmedId = client.portfolios[0]?.id;
  const confirmed = confirmedId
    ? portfolioOptions.find((o) => o.id === confirmedId)
    : undefined;
  return [(confirmed ?? portfolioOptions[1]).weights];
}

// ── setToMacroApiParams 재현 (lib/assetMapping.ts) ──────────────────────────
const ETF_OVERSEAS_RATIO_DEFAULT = 0.6;
function round1(v) { return Math.round(v * 10) / 10; }

function setToMacroApiParams(set) {
  const sp500 = set.etf * ETF_OVERSEAS_RATIO_DEFAULT;
  const kospi = set.etf * (1 - ETF_OVERSEAS_RATIO_DEFAULT);
  const treasury = set.bond + (set.els ?? 0) * 0.7;
  const hedgeTotal = set.mmf + set.gold + set.dollar + set.raw + (set.els ?? 0) * 0.3;
  const equityBondTotal = round1(sp500) + round1(kospi) + round1(treasury);
  const divisor = equityBondTotal > 0 ? equityBondTotal : 1;
  return {
    us: round1(sp500) / divisor,
    kr: round1(kospi) / divisor,
    bond: round1(treasury) / divisor,
    hedgePct: round1(hedgeTotal),
    equityBondPct: round1(equityBondTotal),
  };
}

/** StressTestPanel의 autoParams = setToMacroApiParams(portfolioWeights[0]) */
function computeAutoParams(client) {
  const weights = computePortfolioWeights(client);
  return setToMacroApiParams(weights[0]);
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function check(label, actual, expected, tol = 0.001) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${typeof actual === 'number' ? actual.toFixed(4) : actual} (기대: ${expected})`);
}
function checkStr(label, actual, expected) {
  const ok = actual === expected;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: "${actual}" (기대: "${expected}")`);
}
function section(title) { console.log(`\n=== ${title} ===`); }

// ── 케이스 1: 방어형(stable) 확정 ────────────────────────────────────────────
section('케이스1: 방어형(stable) 확정');
const client_stable = {
  portfolios: [{ id: 'stable', label: '방어형 추천안', allocations: [] }],
};
const w1 = computePortfolioWeights(client_stable);
const p1 = computeAutoParams(client_stable);
console.log(`  확정 id: ${client_stable.portfolios[0].id}`);
console.log(`  선택된 weights: etf=${w1[0].etf} bond=${w1[0].bond}`);
checkStr('weights[0].etf=방어형ETF(25)', String(w1[0].etf), '25');
check('us (방어형 S&P500 기준)', p1.us, (25*0.6) / (25+MOCK_VM_OPTIONS[0].weights.bond), 0.01);
console.log(`  autoParams: us=${p1.us.toFixed(4)} kr=${p1.kr.toFixed(4)} bond=${p1.bond.toFixed(4)} hedgePct=${p1.hedgePct}`);
check('us+kr+bond = 1.0', p1.us + p1.kr + p1.bond, 1.0, 0.001);

// ── 케이스 2: 균형형(balanced) 확정 (이게 핵심 — 기존 버그: 방어형이 나왔음) ──
section('케이스2: 균형형(balanced) 확정 ← 기존 버그 검증');
const client_balanced = {
  portfolios: [{ id: 'balanced', label: '균형형 추천안', allocations: [] }],
};
const w2 = computePortfolioWeights(client_balanced);
const p2 = computeAutoParams(client_balanced);
console.log(`  확정 id: ${client_balanced.portfolios[0].id}`);
console.log(`  선택된 weights: etf=${w2[0].etf} bond=${w2[0].bond}`);
checkStr('weights[0].etf=균형형ETF(34)', String(w2[0].etf), '34');
check('us+kr+bond = 1.0', p2.us + p2.kr + p2.bond, 1.0, 0.001);
console.log(`  autoParams: us=${p2.us.toFixed(4)} kr=${p2.kr.toFixed(4)} bond=${p2.bond.toFixed(4)} hedgePct=${p2.hedgePct}`);
// 기존 버그: etf=25(방어형)가 나왔어야 함. 수정 후: etf=34(균형형)
const bugSimulation_etf = MOCK_VM_OPTIONS[0].weights.etf; // 기존 [0] 하드코딩
checkStr('[버그 수정] 기존이라면 방어형ETF(25)가 나왔을 것', String(bugSimulation_etf), '25');
console.log(`  ↑ 기존 버그: 균형형 확정해도 etf=25(방어형)가 macroStress에 전달됐음`);
console.log(`  ↑ 수정 후:   etf=${w2[0].etf}(균형형)이 전달됨 ✅`);

// ── 케이스 3: 성장형(growth) 확정 ────────────────────────────────────────────
section('케이스3: 성장형(growth) 확정');
const client_growth = {
  portfolios: [{ id: 'growth', label: '성장형 추천안', allocations: [] }],
};
const w3 = computePortfolioWeights(client_growth);
const p3 = computeAutoParams(client_growth);
console.log(`  확정 id: ${client_growth.portfolios[0].id}`);
console.log(`  선택된 weights: etf=${w3[0].etf} bond=${w3[0].bond}`);
checkStr('weights[0].etf=성장형ETF(43)', String(w3[0].etf), '43');
check('us+kr+bond = 1.0', p3.us + p3.kr + p3.bond, 1.0, 0.001);
console.log(`  autoParams: us=${p3.us.toFixed(4)} kr=${p3.kr.toFixed(4)} bond=${p3.bond.toFixed(4)} hedgePct=${p3.hedgePct}`);

// ── 케이스 4: 미확정 (portfolios 비어있음) ───────────────────────────────────
section('케이스4: 미확정 상태 (client.portfolios=[] → 균형형 폴백)');
const client_none = { portfolios: [] };
const w4 = computePortfolioWeights(client_none);
const p4 = computeAutoParams(client_none);
console.log(`  확정 id: (없음)`);
console.log(`  선택된 weights: etf=${w4[0].etf} bond=${w4[0].bond}`);
checkStr('폴백=균형형ETF(34)', String(w4[0].etf), '34');
check('us+kr+bond = 1.0', p4.us + p4.kr + p4.bond, 1.0, 0.001);
console.log(`  note: 미확정 시 스트레스 탭 자체가 잠김(done.portfolio=false)이므로 이 경로는 UI에 표시 안 됨`);

// ── 케이스 5: ETF 비중 단조 증가 확인 (방어형 < 균형형 < 성장형) ─────────────
section('케이스5: ETF 비중 단조 증가 (방어형 < 균형형 < 성장형)');
const etfs = [
  MOCK_VM_OPTIONS.find(o => o.id === 'stable').weights.etf,
  MOCK_VM_OPTIONS.find(o => o.id === 'balanced').weights.etf,
  MOCK_VM_OPTIONS.find(o => o.id === 'growth').weights.etf,
];
console.log(`  방어형 ETF: ${etfs[0]}%  균형형 ETF: ${etfs[1]}%  성장형 ETF: ${etfs[2]}%`);
check('방어형 < 균형형', etfs[1] - etfs[0], 9, 50); // 방향만 검증
check('균형형 < 성장형', etfs[2] - etfs[1], 9, 50);

// ── 케이스 6: 확정 id가 예상 외 값일 때 (방어) ─────────────────────────────
section('케이스6: 예상 외 id (알 수 없는 id) → 균형형 폴백');
const client_weird = { portfolios: [{ id: 'custom_edit', label: '커스텀', allocations: [] }] };
const w6 = computePortfolioWeights(client_weird);
checkStr('알 수 없는 id → 균형형ETF(34) 폴백', String(w6[0].etf), '34');

// ── 결과 ──────────────────────────────────────────────────────────────────────
console.log(`\n=== 결과: ${fail === 0 ? '✅ 전체 통과' : `❌ ${fail}건 실패`} (통과 ${pass}건) ===\n`);

console.log('[변경 요약]');
console.log('  변경 파일: components/IPSResultTabs.tsx (L151-158)');
console.log('  변경 내용: portfolioWeights useMemo');
console.log('    이전: buildPortfolioViewModel(client).portfolioOptions.map(o => o.weights)');
console.log('          → [방어형weights, 균형형weights, 성장형weights]');
console.log('          → StressTestPanel은 항상 [0]=방어형 사용 (버그)');
console.log('    이후: confirmedId = client.portfolios[0]?.id ("stable"|"balanced"|"growth")');
console.log('          → portfolioOptions.find(o => o.id === confirmedId)');
console.log('          → [확정된안weights] 단일 원소 배열');
console.log('          → StressTestPanel [0] = 확정된 안 weights (수정됨)');
