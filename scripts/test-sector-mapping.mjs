/**
 * test-sector-mapping.mjs
 * lib/sectorMap.ts의 getSectorAnalysis 동작을 Node.js에서 검증.
 * (TypeScript 직접 import 불가 → 동일 로직 인라인 재현)
 *
 * 검증 항목:
 *   1. 삼성전자  (005930) → 반도체 → 091160.KS
 *   2. KB금융    (105560) → 금융   → 139270.KS
 *   3. 현대차    (005380) → 자동차 → 091180.KS
 *   4. 현대중공업 (009540) → 매핑 없음 → KOSPI 폴백
 *
 * 실행: node scripts/test-sector-mapping.mjs
 */

const UA   = "Mozilla/5.0 macro-stress/2.0";
const P1   = Math.floor(new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).getTime() / 1000);
const P2   = Math.floor(Date.now() / 1000);

// ── 매핑 테이블 (lib/sectorMap.ts와 동일) ─────────────────────────────────
const SECTOR_LABELS = {
  semiconductor: "반도체",
  battery:       "2차전지",
  bio:           "바이오·헬스케어",
  finance:       "금융",
  energy_chem:   "에너지화학",
  healthcare:    "헬스케어",
  steel:         "철강",
  it:            "IT",
  auto:          "자동차",
  market:        "시장 기준(섹터 미특정)",
};

const SECTOR_ETF = {
  semiconductor: "091160.KS",
  battery:       "305720.KS",
  bio:           "244580.KS",
  finance:       "139270.KS",
  energy_chem:   "117460.KS",
  healthcare:    "143860.KS",
  steel:         "117680.KS",
  it:            "266360.KS",
  auto:          "091180.KS",
};

const SECTOR_ETF_NAMES = {
  semiconductor: "KODEX 반도체",
  battery:       "KODEX 2차전지산업",
  bio:           "KODEX 바이오",
  finance:       "TIGER 금융",
  energy_chem:   "KODEX 에너지화학",
  healthcare:    "TIGER 헬스케어",
  steel:         "KODEX 철강",
  it:            "KODEX IT",
  auto:          "KODEX 자동차",
};

const STOCK_SECTOR_MAP = [
  { name: "삼성전자",         code: "005930", sector: "semiconductor" },
  { name: "SK하이닉스",       code: "000660", sector: "semiconductor" },
  { name: "삼성전기",         code: "009150", sector: "semiconductor" },
  { name: "한미반도체",       code: "042700", sector: "semiconductor" },
  { name: "LG에너지솔루션",   code: "373220", sector: "battery" },
  { name: "삼성SDI",          code: "006400", sector: "battery" },
  { name: "에코프로비엠",     code: "247540", sector: "battery" },
  { name: "에코프로",         code: "086520", sector: "battery" },
  { name: "LG화학",           code: "051910", sector: "battery" },
  { name: "포스코퓨처엠",     code: "003670", sector: "battery" },
  { name: "삼성바이오로직스", code: "207940", sector: "bio" },
  { name: "셀트리온",         code: "068270", sector: "bio" },
  { name: "유한양행",         code: "000100", sector: "bio" },
  { name: "한미약품",         code: "128940", sector: "bio" },
  { name: "KB금융",           code: "105560", sector: "finance" },
  { name: "신한지주",         code: "055550", sector: "finance" },
  { name: "하나금융지주",     code: "086790", sector: "finance" },
  { name: "우리금융지주",     code: "316140", sector: "finance" },
  { name: "삼성생명",         code: "032830", sector: "finance" },
  { name: "메리츠금융지주",   code: "138040", sector: "finance" },
  { name: "NAVER",            code: "035420", sector: "it" },
  { name: "카카오",           code: "035720", sector: "it" },
  { name: "SK텔레콤",         code: "017670", sector: "it" },
  { name: "LG전자",           code: "066570", sector: "it" },
  { name: "현대차",           code: "005380", sector: "auto" },
  { name: "기아",             code: "000270", sector: "auto" },
  { name: "현대모비스",       code: "012330", sector: "auto" },
  { name: "SK이노베이션",     code: "096770", sector: "energy_chem" },
  { name: "POSCO홀딩스",      code: "005490", sector: "steel" },
  { name: "고려아연",         code: "010130", sector: "steel" },
  { name: "삼성물산",         code: "028260", sector: "market" },
  { name: "HD현대",           code: "267250", sector: "market" },
  { name: "한화에어로스페이스",code: "012450", sector: "market" },
];

function findEntry(nameOrCode) {
  const q = nameOrCode.trim();
  return STOCK_SECTOR_MAP.find((e) => e.code === q || e.name === q) ?? null;
}

// ── Yahoo fetch ────────────────────────────────────────────────────────────
async function yahooMonthly(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${P1}&period2=${P2}&interval=1mo&events=history`;
  const t0  = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA } });
  const ms  = Date.now() - t0;
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = await res.json();
  const result  = payload?.chart?.result?.[0];
  if (!result)  throw new Error(`Yahoo ${symbol}: no data`);
  const timestamps = result.timestamp ?? [];
  const prices =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  const pts = timestamps
    .map((ts, i) => ({ month: new Date(ts * 1000).toISOString().slice(0, 7), price: Number(prices[i]) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
  return { pts, ms };
}

// ── OLS ───────────────────────────────────────────────────────────────────
function computeOls(etfPts, benchPts) {
  const toRets = (pts) =>
    pts.slice(1).map((p, i) => ({ month: p.month, ret: p.price / pts[i].price - 1 }))
       .filter((r) => Number.isFinite(r.ret));

  const etfRets   = toRets(etfPts);
  const benchRets = toRets(benchPts);
  const bMap      = new Map(benchRets.map((r) => [r.month, r.ret]));
  const pairs     = etfRets.filter((r) => bMap.has(r.month)).map((r) => ({ month: r.month, a: r.ret, b: bMap.get(r.month) }));

  if (pairs.length < 6) throw new Error("관측값 부족");
  const n  = pairs.length;
  const mA = pairs.reduce((s, p) => s + p.a, 0) / n;
  const mB = pairs.reduce((s, p) => s + p.b, 0) / n;
  let cov = 0, varB = 0;
  for (const p of pairs) { cov += (p.a - mA) * (p.b - mB); varB += (p.b - mB) ** 2; }
  const beta  = varB > 0 ? cov / varB : NaN;
  const alpha = mA - beta * mB;
  const ssRes = pairs.reduce((s, p) => s + (p.a - (alpha + beta * p.b)) ** 2, 0);
  const ssTot = pairs.reduce((s, p) => s + (p.a - mA) ** 2, 0);
  const r2    = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
  const etfVar = etfRets.reduce((s, r) => s + (r.ret - mA) ** 2, 0) / (etfRets.length - 1);

  return {
    beta, alphaAnnual: ((1 + alpha) ** 12 - 1) * 100,
    r2,  volAnnual: Math.sqrt(etfVar * 12) * 100,
    n, start: pairs[0].month, end: pairs.at(-1).month,
  };
}

// ── getSectorAnalysis (인라인, lib/sectorMap.ts와 동일 로직) ──────────────
async function getSectorAnalysis(nameOrCode) {
  const entry      = findEntry(nameOrCode);
  const sector     = entry?.sector ?? "market";
  const isFallback = !entry || sector === "market";
  const etfTicker  = sector === "market" ? "^KS11" : SECTOR_ETF[sector];
  const etfName    = sector === "market" ? "KOSPI (^KS11)" : SECTOR_ETF_NAMES[sector];

  const fetches = [yahooMonthly(etfTicker)];
  if (etfTicker !== "^KS11") fetches.push(yahooMonthly("^KS11"));
  const [etfFetch, kospiFetch] = await Promise.all(fetches);

  const etfPts   = etfFetch.pts;
  const benchPts = etfTicker === "^KS11" ? etfFetch.pts : kospiFetch.pts;
  const ols      = computeOls(etfPts, benchPts);

  return {
    stockName: entry?.name ?? nameOrCode,
    stockCode: entry?.code ?? nameOrCode,
    sector, sectorLabel: SECTOR_LABELS[sector],
    etfTicker, etfName, isFallback,
    ...ols,
    fetchMs: etfFetch.ms,
  };
}

// ── main ──────────────────────────────────────────────────────────────────
const TESTS = [
  { input: "005930", label: "삼성전자(코드)" },
  { input: "KB금융", label: "KB금융(이름)" },
  { input: "현대차", label: "현대차(이름)" },
  { input: "009540", label: "현대중공업(매핑없음→폴백)" }, // 매핑 없음
];

async function main() {
  console.log("=== getSectorAnalysis 동작 검증 ===\n");

  for (const t of TESTS) {
    process.stdout.write(`[${t.label}] 분석 중... `);
    try {
      const r = await getSectorAnalysis(t.input);
      const fallbackBadge = r.isFallback ? " ⚠️ 폴백" : "";
      console.log(`완료 (${r.fetchMs}ms)`);
      console.log(`  종목    : ${r.stockName} (${r.stockCode})`);
      console.log(`  섹터    : ${r.sectorLabel}${fallbackBadge}`);
      console.log(`  ETF     : ${r.etfName} (${r.etfTicker})`);
      console.log(`  기간    : ${r.start} ~ ${r.end}  ${r.n}개월`);
      console.log(`  베타    : ${r.beta.toFixed(3)}`);
      console.log(`  변동성  : ${r.volAnnual.toFixed(1)}% (연율화)`);
      console.log(`  alpha   : ${r.alphaAnnual >= 0 ? "+" : ""}${r.alphaAnnual.toFixed(2)}%/yr`);
      console.log(`  R²      : ${r.r2.toFixed(3)}`);
    } catch (e) {
      console.log(`실패 ❌\n  ${e.message}`);
    }
    console.log();
  }

  // 매핑 테이블 전체 출력
  console.log("=== KOSPI 상위 30개 매핑 테이블 ===");
  const bySector = {};
  for (const e of STOCK_SECTOR_MAP) {
    (bySector[e.sector] ??= []).push(e.name);
  }
  for (const [sector, names] of Object.entries(bySector)) {
    const etfCode = SECTOR_ETF[sector] ?? "^KS11(폴백)";
    const etfName = SECTOR_ETF_NAMES[sector] ?? "KOSPI";
    console.log(`  [${SECTOR_LABELS[sector]}] → ${etfName}(${etfCode})`);
    console.log(`    ${names.join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
