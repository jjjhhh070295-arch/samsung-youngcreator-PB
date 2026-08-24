/**
 * test-holding-sector-analysis.mjs
 * analyzeHoldingsBySector() 동작 검증 (인라인 재현)
 *
 * 검증 시나리오
 *   시나리오 A — 반도체 쏠림 경고 (삼성전자+SK하이닉스+LG에너지솔루션+셀트리온+매핑없는종목)
 *   시나리오 B — 균형 포트 (반도체/금융/자동차 분산)
 *
 * 실행: node scripts/test-holding-sector-analysis.mjs
 */

// ── 매핑 테이블 (lib/sectorMap.ts 동일) ──────────────────────────────────
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
  const q = (nameOrCode ?? "").trim();
  return STOCK_SECTOR_MAP.find((e) => e.code === q || e.name === q) ?? null;
}

// ── Yahoo 월봉 fetch ──────────────────────────────────────────────────────
const UA = "Mozilla/5.0 macro-stress/2.0";
const P1 = Math.floor(new Date(Date.now() - 5 * 365.25 * 24 * 3600 * 1000).getTime() / 1000);
const P2 = Math.floor(Date.now() / 1000);

async function yahooMonthly(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${P1}&period2=${P2}&interval=1mo&events=history`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const payload = await res.json();
  const result  = payload?.chart?.result?.[0];
  if (!result)  throw new Error(`Yahoo ${symbol}: no data`);
  const timestamps = result.timestamp ?? [];
  const prices =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  return timestamps
    .map((ts, i) => ({ month: new Date(ts * 1000).toISOString().slice(0, 7), price: Number(prices[i]) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0);
}

// ── OLS ───────────────────────────────────────────────────────────────────
function computeOls(etfPts, benchPts) {
  const toRets = (pts) =>
    pts.slice(1).map((p, i) => ({ month: p.month, ret: p.price / pts[i].price - 1 }))
       .filter((r) => Number.isFinite(r.ret));
  const etfRets   = toRets(etfPts);
  const benchRets = toRets(benchPts);
  const bMap      = new Map(benchRets.map((r) => [r.month, r.ret]));
  const pairs     = etfRets.filter((r) => bMap.has(r.month)).map((r) => ({ a: r.ret, b: bMap.get(r.month) }));
  if (pairs.length < 6) throw new Error("관측값 부족");
  const n = pairs.length;
  const mA = pairs.reduce((s, p) => s + p.a, 0) / n;
  const mB = pairs.reduce((s, p) => s + p.b, 0) / n;
  let cov = 0, varB = 0;
  for (const p of pairs) { cov += (p.a - mA) * (p.b - mB); varB += (p.b - mB) ** 2; }
  const beta  = varB > 0 ? cov / varB : NaN;
  const alpha = mA - beta * mB;
  const ssRes = pairs.reduce((s, p) => s + (p.a - (alpha + beta * p.b)) ** 2, 0);
  const ssTot = pairs.reduce((s, p) => s + (p.a - mA) ** 2, 0);
  const r2    = ssTot > 0 ? 1 - ssRes / ssTot : NaN;
  const etfV  = etfRets.reduce((s, r) => s + (r.ret - mA) ** 2, 0) / (etfRets.length - 1);
  return { beta, alphaAnnual: ((1 + alpha) ** 12 - 1) * 100, r2, volAnnual: Math.sqrt(etfV * 12) * 100 };
}

// ── getSectorAnalysis (인라인) ─────────────────────────────────────────────
const _cache = new Map();
async function getSectorAnalysis(nameOrCode) {
  const key    = (nameOrCode ?? "").trim().toLowerCase();
  if (_cache.has(key)) return _cache.get(key);

  const entry      = findEntry(nameOrCode);
  const sector     = entry?.sector ?? "market";
  const isFallback = !entry || sector === "market";
  const etfTicker  = sector === "market" ? "^KS11" : SECTOR_ETF[sector];
  const etfName    = sector === "market" ? "KOSPI (^KS11)" : SECTOR_ETF_NAMES[sector];

  const [etfPts, kospiPts] = await Promise.all([
    yahooMonthly(etfTicker),
    etfTicker !== "^KS11" ? yahooMonthly("^KS11") : Promise.resolve([]),
  ]);
  const benchPts = etfTicker === "^KS11" ? etfPts : kospiPts;
  const ols = computeOls(etfPts, benchPts);

  const result = {
    sector, sectorLabel: SECTOR_LABELS[sector],
    etfCode: etfTicker, etfName, isFallback,
    beta: ols.beta, volatilityAnnual: ols.volAnnual,
    alphaAnnual: ols.alphaAnnual, r2: ols.r2,
  };
  _cache.set(key, result);
  return result;
}

// ── analyzeHoldingsBySector (인라인, lib/holdingSectorAnalysis.ts 동일 로직) ──
const CONCENTRATION_THRESHOLD = 50;
const LOW_R2_THRESHOLD = 0.3;

async function analyzeHoldingsBySector(holdings) {
  const valued = holdings
    .map((h) => {
      const price    = h.currentPriceKrw ?? h.avgPriceKrw ?? 0;
      const valueKrw = Math.max(0, h.quantity * price);
      const entry    = findEntry(h.ticker ?? h.name);
      const sector   = entry?.sector ?? "market";
      return { name: entry?.name ?? h.name, ticker: h.ticker, valueKrw, sector };
    })
    .filter((h) => h.valueKrw > 0);

  const totalValueKrw = valued.reduce((s, h) => s + h.valueKrw, 0);
  if (totalValueKrw === 0) return null;

  // 섹터별 그룹핑
  const sectorGroups = {};
  for (const h of valued) {
    (sectorGroups[h.sector] ??= []).push(h);
  }

  // 섹터별 getSectorAnalysis (섹터당 1회, 캐시 활용)
  const analysisMap = {};
  await Promise.all(
    Object.keys(sectorGroups).map(async (sector) => {
      const rep = sectorGroups[sector][0];
      try {
        analysisMap[sector] = await getSectorAnalysis(rep.ticker ?? rep.name);
      } catch {
        analysisMap[sector] = null;
      }
    }),
  );

  // SectorBucket 조립
  const buckets = Object.entries(sectorGroups).map(([sector, group]) => {
    const sectorValue = group.reduce((s, h) => s + h.valueKrw, 0);
    const weightPct   = (sectorValue / totalValueKrw) * 100;
    const a = analysisMap[sector];
    return {
      sector,
      sectorLabel:   SECTOR_LABELS[sector],
      valueKrw:      sectorValue,
      weightPct,
      holdings:      group.map((h) => ({ name: h.name, ticker: h.ticker, valueKrw: h.valueKrw, weightPct: (h.valueKrw / totalValueKrw) * 100 })),
      beta:          a?.beta          ?? null,
      volAnnual:     a?.volatilityAnnual ?? null,
      alphaAnnual:   a?.alphaAnnual   ?? null,
      r2:            a?.r2            ?? null,
      etfTicker:     a?.etfCode       ?? "^KS11",
      isFallback:    a?.isFallback    ?? true,
      lowReliability: a?.r2 != null ? a.r2 < LOW_R2_THRESHOLD : true,
    };
  });
  buckets.sort((a, b) => b.weightPct - a.weightPct);

  const top = buckets[0] ?? null;
  const fallbackHoldings = (sectorGroups["market"] ?? []).map((h) => ({ name: h.name, ticker: h.ticker, valueKrw: h.valueKrw }));

  let betaSum = 0, betaW = 0, volSum = 0, volW = 0;
  for (const b of buckets) {
    if (b.beta !== null)      { betaSum += b.beta      * b.valueKrw; betaW += b.valueKrw; }
    if (b.volAnnual !== null) { volSum  += b.volAnnual * b.valueKrw; volW  += b.valueKrw; }
  }

  return {
    sectorBuckets: buckets,
    topSector: top ? { sector: top.sector, sectorLabel: top.sectorLabel, weightPct: top.weightPct } : null,
    concentrationWarning: (top?.weightPct ?? 0) >= CONCENTRATION_THRESHOLD,
    concentrationThreshold: CONCENTRATION_THRESHOLD,
    fallbackHoldings,
    totalValueKrw,
    avgBeta:      betaW > 0 ? betaSum / betaW : null,
    avgVolAnnual: volW  > 0 ? volSum  / volW  : null,
  };
}

// ── 출력 헬퍼 ─────────────────────────────────────────────────────────────
const krw = (v) => `${Math.round(v / 10000).toLocaleString()}만원`;
const pct = (v, d = 1) => v == null ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
const fix = (v, d = 3) => v == null ? "N/A" : v.toFixed(d);

function printResult(result, label) {
  if (!result) { console.log(`  [결과 없음]\n`); return; }
  console.log(`\n${"─".repeat(60)}`);
  console.log(`시나리오: ${label}`);
  console.log(`총 주식 평가금액: ${krw(result.totalValueKrw)}  (${Math.round(result.totalValueKrw / 10000).toLocaleString()}만원)`);
  console.log(`포트폴리오 평균 베타: ${fix(result.avgBeta, 3)}  변동성: ${pct(result.avgVolAnnual)}`);

  if (result.concentrationWarning) {
    console.log(`⚠️  쏠림 경고: ${result.topSector.sectorLabel} ${result.topSector.weightPct.toFixed(1)}% ≥ ${result.concentrationThreshold}%`);
  } else {
    console.log(`✅ 쏠림 없음: 최대 섹터 ${result.topSector?.sectorLabel ?? "-"} ${result.topSector?.weightPct.toFixed(1) ?? 0}%`);
  }

  console.log(`\n섹터별 비중:`);
  for (const b of result.sectorBuckets) {
    const bar    = "█".repeat(Math.round(b.weightPct / 5));
    const rel    = b.lowReliability ? " ⚠️참고" : "";
    const fallb  = b.isFallback     ? " [KOSPI폴백]" : "";
    const r2str  = b.r2 != null ? ` R²=${b.r2.toFixed(2)}` : "";
    console.log(
      `  ${b.sectorLabel.padEnd(14)} ${b.weightPct.toFixed(1).padStart(5)}%  ${bar.padEnd(12)}` +
      `  beta=${fix(b.beta, 2)}  vol=${pct(b.volAnnual)}  α=${pct(b.alphaAnnual, 1)}${r2str}${rel}${fallb}`
    );
    for (const h of b.holdings) {
      console.log(`      └ ${h.name} (${h.ticker ?? "??"})  ${krw(h.valueKrw)}  ${h.weightPct.toFixed(1)}%`);
    }
  }

  if (result.fallbackHoldings.length > 0) {
    console.log(`\n폴백 종목 (섹터 미특정):`);
    for (const h of result.fallbackHoldings) {
      console.log(`  └ ${h.name} (${h.ticker ?? "??"})  ${krw(h.valueKrw)}`);
    }
  }
}

// ── 시나리오 정의 ─────────────────────────────────────────────────────────
const SCENARIO_A = {
  label: "A — 반도체 쏠림 경고 (반도체 50%, 2차전지 28%, 바이오 17%, 폴백 6%)",
  holdings: [
    { name: "삼성전자",     ticker: "005930", quantity: 100,  avgPriceKrw: 80_000 },   // 8,000,000
    { name: "SK하이닉스",   ticker: "000660", quantity: 50,   avgPriceKrw: 200_000 },  // 10,000,000 → 반도체 합계 18,000,000
    { name: "LG에너지솔루션", ticker: "373220", quantity: 20, avgPriceKrw: 500_000 },  // 10,000,000 → 2차전지
    { name: "셀트리온",     ticker: "068270", quantity: 30,   avgPriceKrw: 200_000 },  // 6,000,000 → 바이오
    { name: "두산밥캣",     ticker: "241560", quantity: 40,   avgPriceKrw: 50_000 },   // 2,000,000 → 매핑없음 폴백
    // 합계 36,000,000원: 반도체 50%, 2차전지 27.8%, 바이오 16.7%, 폴백 5.6%
  ],
};

const SCENARIO_B = {
  label: "B — 균형 분산 (반도체/금융/자동차 ~33% 각각)",
  holdings: [
    { name: "삼성전자",   ticker: "005930", quantity: 100, avgPriceKrw: 80_000 },  // 8,000,000 → 반도체
    { name: "KB금융",     ticker: "105560", quantity: 100, avgPriceKrw: 90_000 },  // 9,000,000 → 금융
    { name: "현대차",     ticker: "005380", quantity: 60,  avgPriceKrw: 120_000 }, // 7,200,000 → 자동차
    // 합계 24,200,000: 금융 37%, 반도체 33%, 자동차 30%
  ],
};

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== 보유종목 섹터 분석 검증 ===\n");
  console.log("Yahoo Finance 섹터ETF 데이터 수신 중 (최초 실행 시 ~2초)...");

  const [resA, resB] = await Promise.all([
    analyzeHoldingsBySector(SCENARIO_A.holdings),
    analyzeHoldingsBySector(SCENARIO_B.holdings),
  ]);

  printResult(resA, SCENARIO_A.label);
  printResult(resB, SCENARIO_B.label);

  console.log(`\n${"─".repeat(60)}`);
  console.log("검증 항목:");
  console.log(`  시나리오A 쏠림경고 발동:    ${resA?.concentrationWarning ? "✅ 정상 (반도체 ≥50%)" : "❌ 미발동"}`);
  console.log(`  시나리오A 폴백종목 존재:    ${resA?.fallbackHoldings.length > 0 ? "✅ 정상" : "❌ 없음"}`);
  console.log(`  시나리오B 쏠림경고 없음:    ${!resB?.concentrationWarning ? "✅ 정상" : "❌ 예상치 못한 경고"}`);
  console.log(`  평균베타 정상:             ${resA?.avgBeta != null ? `✅ ${resA.avgBeta.toFixed(3)}` : "❌ null"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
