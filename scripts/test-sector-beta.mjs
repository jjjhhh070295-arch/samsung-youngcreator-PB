/**
 * test-sector-beta.mjs
 * 파이프라인 검증: 종목→섹터ETF→KOSPI 대비 베타/아웃퍼폼
 * 대상: SK하이닉스(반도체) → KODEX 반도체(091160.KS) vs KOSPI(^KS11)
 *
 * 실행: node scripts/test-sector-beta.mjs
 */

const UA = "Mozilla/5.0 macro-stress/2.0";
const START_UNIX = Math.floor(new Date("2019-01-01").getTime() / 1000); // 5년치
const END_UNIX = Math.floor(Date.now() / 1000);

// ── 1. Yahoo Finance 월봉 fetch (data.ts의 yahooMonthly와 동일 패턴) ─────────
async function yahooMonthly(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${START_UNIX}&period2=${END_UNIX}&interval=1mo&events=history`;

  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);

  const payload = await res.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  // adjclose 우선, 없으면 close (data.ts와 동일)
  const prices =
    result?.indicators?.adjclose?.[0]?.adjclose ??
    result?.indicators?.quote?.[0]?.close ??
    [];

  const points = timestamps
    .map((ts, i) => ({
      month: new Date(ts * 1000).toISOString().slice(0, 7),
      value: Number(prices[i]),
    }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0);

  return points;
}

// ── 2. 월별 수익률 계산 ────────────────────────────────────────────────────
function toReturns(points) {
  const returns = [];
  for (let i = 1; i < points.length; i++) {
    const ret = points[i].value / points[i - 1].value - 1;
    if (Number.isFinite(ret)) {
      returns.push({ month: points[i].month, ret });
    }
  }
  return returns;
}

// ── 3. 두 시리즈를 월 기준으로 align ─────────────────────────────────────
function align(seriesA, seriesB) {
  const mapB = new Map(seriesB.map((r) => [r.month, r.ret]));
  return seriesA
    .filter((r) => mapB.has(r.month))
    .map((r) => ({ month: r.month, a: r.ret, b: mapB.get(r.month) }));
}

// ── 4. 단순 1요인 OLS: a = alpha + beta * b ───────────────────────────────
// engine.ts의 fit()은 6요인+MacroRow 전용이라 재활용 불가.
// Cov(a,b)/Var(b) 공식으로 직접 계산.
function olsBeta(pairs) {
  const n = pairs.length;
  const meanA = pairs.reduce((s, p) => s + p.a, 0) / n;
  const meanB = pairs.reduce((s, p) => s + p.b, 0) / n;

  let covAB = 0, varB = 0;
  for (const p of pairs) {
    covAB += (p.a - meanA) * (p.b - meanB);
    varB  += (p.b - meanB) ** 2;
  }
  const beta  = varB > 0 ? covAB / varB : NaN;
  const alpha = meanA - beta * meanB; // 월간 alpha

  // R²
  const ssRes = pairs.reduce((s, p) => {
    const pred = alpha + beta * p.b;
    return s + (p.a - pred) ** 2;
  }, 0);
  const ssTot = pairs.reduce((s, p) => s + (p.a - meanA) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

  return { beta, alpha, r2, n };
}

// ── 5. 누적 수익률 ────────────────────────────────────────────────────────
function cumReturn(rets) {
  return rets.reduce((wealth, r) => wealth * (1 + r), 1) - 1;
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== 섹터ETF 베타 파이프라인 검증 ===");
  console.log("대상: SK하이닉스(반도체) → KODEX 반도체(091160.KS) vs KOSPI(^KS11)\n");

  // 1. 데이터 수신
  console.log("[1] Yahoo Finance 월봉 fetch 중...");
  const [semiPts, kospiPts] = await Promise.all([
    yahooMonthly("091160.KS"),
    yahooMonthly("^KS11"),
  ]);
  console.log(`  KODEX 반도체(091160.KS): ${semiPts.length}개월치`);
  console.log(`    범위: ${semiPts[0]?.month} ~ ${semiPts.at(-1)?.month}`);
  console.log(`  KOSPI(^KS11)           : ${kospiPts.length}개월치`);
  console.log(`    범위: ${kospiPts[0]?.month} ~ ${kospiPts.at(-1)?.month}\n`);

  // 2. 월별 수익률
  const semiRets  = toReturns(semiPts);
  const kospiRets = toReturns(kospiPts);

  // 3. Align
  const pairs = align(semiRets, kospiRets);
  console.log(`[2] 공통 월 수 (align 후): ${pairs.length}개월\n`);

  if (pairs.length < 12) {
    console.error("데이터 부족 — 최소 12개월 필요. 중단.");
    process.exit(1);
  }

  // 4. OLS 베타
  const { beta, alpha, r2, n } = olsBeta(pairs);
  const annualAlpha = (1 + alpha) ** 12 - 1; // 연환산
  console.log("[3] OLS 결과 (KODEX반도체 = alpha + beta × KOSPI):");
  console.log(`  beta        : ${beta.toFixed(3)}  (1 초과 → 시장보다 변동성 큼)`);
  console.log(`  alpha(월간) : ${(alpha * 100).toFixed(3)}%`);
  console.log(`  alpha(연환산): ${(annualAlpha * 100).toFixed(2)}% (KOSPI 초과수익)`);
  console.log(`  R²          : ${r2.toFixed(3)}`);
  console.log(`  관측수       : ${n}개월\n`);

  // 5. 누적 수익률 비교
  const semiCum  = cumReturn(pairs.map((p) => p.a));
  const kospiCum = cumReturn(pairs.map((p) => p.b));
  const excess   = semiCum - kospiCum;

  console.log("[4] 누적 수익률 비교:");
  console.log(`  KODEX 반도체 누적: ${(semiCum  * 100).toFixed(1)}%`);
  console.log(`  KOSPI 누적        : ${(kospiCum * 100).toFixed(1)}%`);
  console.log(`  초과수익률(단순)   : ${excess >= 0 ? "+" : ""}${(excess * 100).toFixed(1)}%`);
  console.log(`  판정: KODEX반도체가 KOSPI 대비 ${excess >= 0 ? "아웃퍼폼 ✅" : "언더퍼폼 ❌"}\n`);

  // 6. 파이프라인 안정성 판단
  console.log("[5] 파이프라인 안정성 판단:");
  const ok = semiPts.length >= 24 && pairs.length >= 24 && Number.isFinite(beta) && Number.isFinite(alpha) && r2 > 0;
  if (ok) {
    console.log("  ✅ 데이터 수신 안정 / OLS 정상 / R² > 0");
    console.log("  → 종목→섹터ETF→베타/아웃퍼폼 전체 경로 작동 확인.");
    console.log("  → 섹터 매핑 테이블(ticker-map 확장) 추가하면 전 종목 커버 가능.");
  } else {
    console.log("  ❌ 파이프라인 이상 — 위 수치 확인 필요.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
