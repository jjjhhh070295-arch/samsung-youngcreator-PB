/**
 * test-auto-sector-map.mjs
 * 자동 섹터 역매핑 검증:
 * - 수동 33개 vs 자동 매핑 비교
 * - 주요 종목 분류 확인
 * - 커버리지 확인
 *
 * 실행: node scripts/test-auto-sector-map.mjs
 */
import { readFileSync } from "fs";

// ── 자동 매핑 빌드 (autoSectorMap.ts 인라인 재현) ─────────────────────────
const etfData = JSON.parse(readFileSync("scripts/etf-constituents.json", "utf8"));

const ETF_TO_SECTOR = {
  "091160": "semiconductor",
  "305720": "battery",
  "244580": "bio",
  "139270": "finance",
  "266360": "it",
  "091180": "auto",
  "117460": "energy_chem",
  "117680": "steel",
};

const SECTOR_LABELS = {
  semiconductor: "반도체",
  battery:       "2차전지",
  bio:           "바이오",
  finance:       "금융",
  energy_chem:   "에너지화학",
  steel:         "철강",
  it:            "IT",
  auto:          "자동차",
  market:        "시장(폴백)",
};

// 역매핑 빌드
const reverseMap = new Map(); // code → { name, sector, etfTicker, weightPct }
for (const [ticker, etf] of Object.entries(etfData.etfs)) {
  const sector = ETF_TO_SECTOR[ticker];
  if (!sector) continue;
  for (const h of etf.holdings) {
    if (!h.code || h.code.startsWith("KRD")) continue;
    const w = h.weightPct ?? 0;
    const ex = reverseMap.get(h.code);
    if (!ex || ex.weightPct < w) {
      reverseMap.set(h.code, { name: h.name, sector, etfTicker: ticker, weightPct: w });
    }
  }
}

// ── 수동 매핑 33개 ────────────────────────────────────────────────────────
const MANUAL = [
  { name: "삼성전자",          code: "005930", sector: "semiconductor" },
  { name: "SK하이닉스",        code: "000660", sector: "semiconductor" },
  { name: "삼성전기",          code: "009150", sector: "semiconductor" },
  { name: "한미반도체",        code: "042700", sector: "semiconductor" },
  { name: "LG에너지솔루션",    code: "373220", sector: "battery" },
  { name: "삼성SDI",           code: "006400", sector: "battery" },
  { name: "에코프로비엠",      code: "247540", sector: "battery" },
  { name: "에코프로",          code: "086520", sector: "battery" },
  { name: "LG화학",            code: "051910", sector: "battery" },
  { name: "포스코퓨처엠",      code: "003670", sector: "battery" },
  { name: "삼성바이오로직스",  code: "207940", sector: "bio" },
  { name: "셀트리온",          code: "068270", sector: "bio" },
  { name: "유한양행",          code: "000100", sector: "bio" },
  { name: "한미약품",          code: "128940", sector: "bio" },
  { name: "KB금융",            code: "105560", sector: "finance" },
  { name: "신한지주",          code: "055550", sector: "finance" },
  { name: "하나금융지주",      code: "086790", sector: "finance" },
  { name: "우리금융지주",      code: "316140", sector: "finance" },
  { name: "삼성생명",          code: "032830", sector: "finance" },
  { name: "메리츠금융지주",    code: "138040", sector: "finance" },
  { name: "NAVER",             code: "035420", sector: "it" },
  { name: "카카오",            code: "035720", sector: "it" },
  { name: "SK텔레콤",          code: "017670", sector: "it" },
  { name: "LG전자",            code: "066570", sector: "it" },
  { name: "현대차",            code: "005380", sector: "auto" },
  { name: "기아",              code: "000270", sector: "auto" },
  { name: "현대모비스",        code: "012330", sector: "auto" },
  { name: "SK이노베이션",      code: "096770", sector: "energy_chem" },
  { name: "POSCO홀딩스",       code: "005490", sector: "steel" },
  { name: "고려아연",          code: "010130", sector: "steel" },
  { name: "삼성물산",          code: "028260", sector: "market" },
  { name: "HD현대",            code: "267250", sector: "market" },
  { name: "한화에어로스페이스", code: "012450", sector: "market" },
];

console.log("=== 자동 역매핑 검증 ===\n");

// ── 1. 커버리지 ───────────────────────────────────────────────────────────
console.log(`── 커버리지 ──`);
console.log(`  자동 매핑: ${reverseMap.size}개 유니크 종목`);
const manualCovered = MANUAL.filter(m => reverseMap.has(m.code));
console.log(`  수동 33개 중 자동 커버: ${manualCovered.length}개`);
console.log(`  수동 33개 중 자동 미커버: ${33 - manualCovered.length}개\n`);

// ── 2. 수동 vs 자동 비교 ─────────────────────────────────────────────────
console.log("── 수동 33개 vs 자동 매핑 비교 ──\n");
console.log("  " + "종목".padEnd(18) + "코드".padEnd(8) + "수동".padEnd(16) + "자동".padEnd(16) + "일치?");
console.log("  " + "─".repeat(70));

let match = 0, diff = 0, noAuto = 0;
const diffs = [];

for (const m of MANUAL) {
  const auto    = reverseMap.get(m.code);
  const autoSec = auto?.sector ?? "없음";
  const isMatch = auto ? m.sector === auto.sector : false;
  const mark    = !auto ? "⚪" : isMatch ? "✅" : "❌";

  if (!auto) noAuto++;
  else if (isMatch) match++;
  else { diff++; diffs.push({ ...m, autoSector: auto.sector, autoW: auto.weightPct }); }

  const manLabel  = SECTOR_LABELS[m.sector]  ?? m.sector;
  const autoLabel = auto ? (SECTOR_LABELS[auto.sector] ?? auto.sector) : "(없음)";
  console.log(`  ${mark} ${m.name.padEnd(16)} ${m.code}  ${manLabel.padEnd(14)} ${autoLabel}`);
}

console.log(`\n  ✅ 일치: ${match}개  ❌ 불일치: ${diff}개  ⚪ 미커버: ${noAuto}개\n`);

// ── 3. 불일치 상세 ───────────────────────────────────────────────────────
if (diffs.length > 0) {
  console.log("── 불일치 상세 (수동 ≠ 자동) ──\n");
  for (const d of diffs) {
    // 해당 종목이 속한 ETF 비중 전체 나열
    const inEtfs = [];
    for (const [ticker, etf] of Object.entries(etfData.etfs)) {
      const h = etf.holdings.find(h => h.code === d.code);
      if (h) inEtfs.push(`${ETF_TO_SECTOR[ticker]}(${ticker}) ${h.weightPct}%`);
    }
    console.log(`  ${d.name}(${d.code})`);
    console.log(`    수동: ${SECTOR_LABELS[d.sector]}`);
    console.log(`    자동: ${SECTOR_LABELS[d.autoSector]} (${d.autoSector} ETF에서 ${d.autoW}%)`);
    console.log(`    ETF 비중: ${inEtfs.join(" / ")}`);
    console.log();
  }
}

// ── 4. 미커버 종목 ────────────────────────────────────────────────────────
const uncovered = MANUAL.filter(m => !reverseMap.has(m.code));
if (uncovered.length > 0) {
  console.log("── 자동 미커버 (수동에만 있는 종목) ──\n");
  for (const m of uncovered)
    console.log(`  ${m.name.padEnd(16)} ${m.code}  수동: ${SECTOR_LABELS[m.sector]}`);
  console.log();
}

// ── 5. 주요 종목 검증 ────────────────────────────────────────────────────
console.log("── 주요 종목 자동 매핑 결과 ──\n");
const checks = [
  ["005930", "삼성전자",    "semiconductor"],
  ["000660", "SK하이닉스",  "semiconductor"],
  ["051910", "LG화학",      "?? (2차전지vs에너지화학)"],
  ["005490", "POSCO홀딩스", "?? (철강vs2차전지)"],
  ["373220", "LG에너지솔루션", "battery"],
  ["105560", "KB금융",      "finance"],
  ["055550", "신한지주",    "finance"],
  ["035420", "NAVER",       "it"],
  ["005380", "현대차",      "auto"],
  ["096770", "SK이노베이션","?? (에너지화학vs2차전지)"],
];

for (const [code, label, expected] of checks) {
  const auto = reverseMap.get(code);
  if (!auto) { console.log(`  ⚪ ${label.padEnd(16)} (${code}) → 자동 미커버`); continue; }
  const etfBuckets = [];
  for (const [ticker, etf] of Object.entries(etfData.etfs)) {
    const h = etf.holdings.find(h => h.code === code);
    if (h) etfBuckets.push(`${ETF_TO_SECTOR[ticker]}:${h.weightPct}%`);
  }
  const label2 = SECTOR_LABELS[auto.sector];
  console.log(`  ${label.padEnd(16)} (${code}) → ${label2.padEnd(12)} (최대비중 ${auto.weightPct}%)`);
  if (etfBuckets.length > 1) console.log(`    └ 복수 ETF: ${etfBuckets.join(" / ")}`);
}

// ── 6. 섹터별 자동 매핑 종목 수 ──────────────────────────────────────────
console.log("\n── 섹터별 자동 매핑 종목 수 ──\n");
const bySector = {};
for (const [, e] of reverseMap) {
  bySector[e.sector] = (bySector[e.sector] ?? 0) + 1;
}
for (const [sec, cnt] of Object.entries(bySector).sort((a,b) => b[1]-a[1]))
  console.log(`  ${(SECTOR_LABELS[sec] ?? sec).padEnd(14)} ${cnt}개`);
console.log(`  ${"합계".padEnd(14)} ${reverseMap.size}개`);
