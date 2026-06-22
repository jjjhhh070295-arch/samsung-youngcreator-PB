/**
 * test-sector-pipeline.mjs
 * 섹터ETF 파이프라인 검증: 베타 + 변동성 + 누적 초과수익 (3개 섹터)
 *
 * 검증 대상:
 *   반도체  SK하이닉스   → KODEX 반도체  (091160.KS)
 *   바이오  삼성바이오   → KODEX 바이오  (244580.KS)
 *   2차전지 에코프로비엠 → KODEX 2차전지 (305720.KS)
 * 벤치마크: KOSPI (^KS11)
 *
 * 실행: node scripts/test-sector-pipeline.mjs
 */

const UA      = "Mozilla/5.0 macro-stress/2.0";
const P1      = Math.floor(new Date("2019-01-01").getTime() / 1000); // 5년
const P2      = Math.floor(Date.now() / 1000);
const SECTORS = [
  { label: "반도체  (SK하이닉스)", etf: "091160.KS", name: "KODEX 반도체" },
  { label: "바이오  (삼성바이오)", etf: "244580.KS", name: "KODEX 바이오" },
  { label: "2차전지 (에코프로비엠)", etf: "305720.KS", name: "KODEX 2차전지" },
];

// ── Yahoo Finance 월봉 (data.ts yahooMonthly와 동일 패턴) ─────────────────
async function yahooMonthly(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${P1}&period2=${P2}&interval=1mo&events=history`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA } });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = await res.json();
  const result  = payload?.chart?.result?.[0];
  if (!result)  throw new Error(`Yahoo ${symbol}: no chart result`);
  const timestamps = result.timestamp ?? [];
  const prices     =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  const points = timestamps
    .map((ts, i) => ({ month: new Date(ts * 1000).toISOString().slice(0, 7), price: Number(prices[i]) }))
    .filter(p => Number.isFinite(p.price) && p.price > 0);
  return { points, latencyMs };
}

// ── 월별 수익률 변환 ────────────────────────────────────────────────────────
function toReturns(points) {
  return points.slice(1).map((p, i) => ({
    month: p.month,
    ret:   p.price / points[i].price - 1,
  })).filter(r => Number.isFinite(r.ret));
}

// ── 두 시리즈 align (공통 월만) ────────────────────────────────────────────
function align(a, b) {
  const mb = new Map(b.map(r => [r.month, r.ret]));
  return a.filter(r => mb.has(r.month)).map(r => ({ month: r.month, a: r.ret, b: mb.get(r.month) }));
}

// ── OLS 1요인: a = alpha + beta × b ─────────────────────────────────────
// engine.ts fit()은 6요인+MacroRow 전용 → 재활용 불가. Cov/Var 공식으로 직접 계산.
function ols(pairs) {
  const n    = pairs.length;
  const mA   = pairs.reduce((s, p) => s + p.a, 0) / n;
  const mB   = pairs.reduce((s, p) => s + p.b, 0) / n;
  let covAB  = 0, varB = 0;
  for (const p of pairs) { covAB += (p.a - mA) * (p.b - mB); varB += (p.b - mB) ** 2; }
  const beta  = varB > 0 ? covAB / varB : NaN;
  const alpha = mA - beta * mB;
  const ssRes = pairs.reduce((s, p) => s + (p.a - (alpha + beta * p.b)) ** 2, 0);
  const ssTot = pairs.reduce((s, p) => s + (p.a - mA) ** 2, 0);
  return { beta, alpha, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN, n };
}

// ── 연율화 변동성: 월별 표준편차 × √12 ───────────────────────────────────
function annualVol(rets) {
  const n  = rets.length;
  const mu = rets.reduce((s, r) => s + r, 0) / n;
  const v  = rets.reduce((s, r) => s + (r - mu) ** 2, 0) / (n - 1);
  return Math.sqrt(v * 12) * 100; // %
}

// ── 누적 수익률 ─────────────────────────────────────────────────────────
function cumRet(rets) { return rets.reduce((w, r) => w * (1 + r), 1) - 1; }

// ── 숫자 포맷 ───────────────────────────────────────────────────────────
const pct = (v, d = 1) => `${v >= 0 ? "+" : ""}${(v).toFixed(d)}%`;
const fix = (v, d = 3) => v.toFixed(d);

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== 섹터ETF 파이프라인 검증 (3종) ===\n");

  // 1. KOSPI 벤치마크 fetch
  process.stdout.write("벤치마크 KOSPI(^KS11) fetch 중... ");
  const { points: kospiPts, latencyMs: kospiMs } = await yahooMonthly("^KS11");
  const kospiRets = toReturns(kospiPts);
  console.log(`완료 (${kospiPts.length}개월, ${kospiMs}ms)`);
  console.log(`  범위: ${kospiPts[0]?.month} ~ ${kospiPts.at(-1)?.month}`);
  console.log(`  KOSPI 연율화 변동성: ${annualVol(kospiRets.map(r => r.ret)).toFixed(1)}%`);
  console.log(`  KOSPI 누적수익: ${pct(cumRet(kospiRets.map(r => r.ret)) * 100)}\n`);

  // 2. 섹터별 검증
  const results = [];
  for (const sector of SECTORS) {
    process.stdout.write(`${sector.label} (${sector.etf}) fetch 중... `);
    let fetchOk = true;
    let pts, latMs;
    try {
      ({ points: pts, latencyMs: latMs } = await yahooMonthly(sector.etf));
      console.log(`완료 (${pts.length}개월, ${latMs}ms)`);
    } catch (e) {
      console.log(`실패 ❌ — ${e.message}`);
      fetchOk = false;
    }
    if (!fetchOk) { results.push({ ...sector, ok: false }); continue; }

    const etfRets = toReturns(pts);
    const pairs   = align(etfRets, kospiRets);

    if (pairs.length < 12) {
      console.log(`  ⚠️  공통 월 ${pairs.length}개 — 데이터 부족`);
      results.push({ ...sector, ok: false });
      continue;
    }

    const { beta, alpha, r2, n } = ols(pairs);
    const vol      = annualVol(etfRets.map(r => r.ret));
    const kospiVol = annualVol(pairs.map(p => p.b));
    const etfCum   = cumRet(pairs.map(p => p.a)) * 100;
    const kospiCum = cumRet(pairs.map(p => p.b)) * 100;
    const excess   = etfCum - kospiCum;

    console.log(`  범위  : ${pts[0]?.month} ~ ${pts.at(-1)?.month}  공통 ${n}개월`);
    console.log(`  베타  : ${fix(beta)}  (1 초과=시장 대비 고변동)`);
    console.log(`  변동성: ETF ${vol.toFixed(1)}% / KOSPI ${kospiVol.toFixed(1)}% (연율화)`);
    console.log(`  alpha : ${pct(alpha * 100 * 12, 2)}  (월간 ${pct(alpha * 100, 3)}, R²=${fix(r2)})`);
    console.log(`  누적  : ETF ${pct(etfCum)} / KOSPI ${pct(kospiCum)} → 초과 ${pct(excess)}`);
    console.log(`  판정  : ${excess >= 0 ? "아웃퍼폼 ✅" : "언더퍼폼 ❌"}\n`);

    results.push({ ...sector, ok: true, beta, alpha, r2, vol, excess, latMs, n });
  }

  // 3. 파이프라인 종합 판단
  console.log("=== 파이프라인 안정성 종합 ===");
  const allOk = results.every(r => r.ok);
  const avgLatency = results.filter(r => r.ok).reduce((s, r) => s + r.latMs, 0) /
                     Math.max(results.filter(r => r.ok).length, 1);

  for (const r of results) {
    if (!r.ok) { console.log(`  ${r.name}: ❌ 실패`); continue; }
    const status = Number.isFinite(r.beta) && Number.isFinite(r.alpha) && r.r2 > 0 ? "✅" : "⚠️";
    console.log(`  ${r.name}: ${status}  beta=${fix(r.beta)} vol=${r.vol.toFixed(1)}% alpha=${pct(r.alpha * 1200, 2)}/yr R²=${fix(r.r2)}`);
  }
  console.log(`\n  Yahoo 평균 응답: ${avgLatency.toFixed(0)}ms`);
  console.log(`  병렬 fetch 아님 (순차) — 실 운용 시 Promise.all 전환 권장\n`);

  if (allOk) {
    console.log("결론: ✅ 3종 섹터 ETF 파이프라인 모두 정상.");
    console.log("  ticker-map.ts에 [종목, 섹터ETF] 매핑만 추가하면 전체 종목 아웃퍼폼 계산 가능.");
  } else {
    const failed = results.filter(r => !r.ok).map(r => r.name).join(", ");
    console.log(`결론: ⚠️  일부 실패 — ${failed}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
