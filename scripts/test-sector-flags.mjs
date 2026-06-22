/**
 * test-sector-flags.mjs
 * 섹터 플래그 검증:
 *   LG화학(051910)      → 주섹터: 에너지화학, 복수섹터에 2차전지
 *   SK텔레콤(017670)    → 미커버 (isUncovered)
 *   바이오ETF(244580)   → R²낮음 플래그
 *   삼성전자(005930)    → 반도체 단일, 플래그 없음
 *
 * 실행: node scripts/test-sector-flags.mjs
 */
import { readFileSync } from "fs";

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
  market:        "시장(미특정)",
};

const ETF_LABELS = {
  "091160": "KODEX 반도체",
  "305720": "KODEX 2차전지산업",
  "244580": "KODEX 바이오",
  "139270": "TIGER 금융",
  "266360": "KODEX IT",
  "091180": "KODEX 자동차",
  "117460": "KODEX 에너지화학",
  "117680": "KODEX 철강",
};

// ── 자동 역매핑 빌드 (autoSectorMap.ts 인라인 재현) ──────────────────────
const _all = new Map(); // code → { name, memberships: [{sector, etfTicker, weightPct}] }

for (const [ticker, etf] of Object.entries(etfData.etfs)) {
  const sector = ETF_TO_SECTOR[ticker];
  if (!sector) continue;
  for (const h of etf.holdings) {
    if (!h.code || h.code.startsWith("KRD")) continue;
    const entry = _all.get(h.code) ?? { name: h.name, memberships: [] };
    entry.memberships.push({ sector, etfTicker: ticker, weightPct: h.weightPct ?? 0 });
    _all.set(h.code, entry);
  }
}

const reverseMap = new Map();
for (const [code, { name, memberships }] of _all) {
  const sorted = [...memberships].sort((a, b) => b.weightPct - a.weightPct);
  const [primary, ...secondary] = sorted;
  reverseMap.set(code, { code, name, sector: primary.sector, etfTicker: primary.etfTicker, weightPct: primary.weightPct, secondarySectors: secondary });
}

// ── getSectorByCode 인라인 ──────────────────────────────────────────────
function getSectorByCode(code) {
  return reverseMap.get(code.trim()) ?? null;
}

// ── isUncovered ────────────────────────────────────────────────────────
function isUncovered(code) {
  return !reverseMap.has(code);
}

// ── multiSector 변환 ──────────────────────────────────────────────────
function getMultiSector(code) {
  const e = getSectorByCode(code);
  if (!e || e.secondarySectors.length === 0) return null;
  return e.secondarySectors.map(s => ({
    sector:      s.sector,
    sectorLabel: SECTOR_LABELS[s.sector] ?? s.sector,
    etfTicker:   s.etfTicker,
    etfLabel:    ETF_LABELS[s.etfTicker],
    weightPct:   s.weightPct,
  }));
}

// ── 검증 케이스 ──────────────────────────────────────────────────────
console.log("=== 섹터 플래그 검증 ===\n");

const cases = [
  { code: "051910", name: "LG화학",      expect: "에너지화학 주섹터 + 2차전지 복수" },
  { code: "017670", name: "SK텔레콤",    expect: "미커버 (isUncovered)" },
  { code: "005930", name: "삼성전자",    expect: "반도체 단일, 복수없음" },
  { code: "000660", name: "SK하이닉스",  expect: "반도체 단일 (최고비중)" },
  { code: "373220", name: "LG에너지솔루션", expect: "2차전지 주섹터" },
  { code: "096770", name: "SK이노베이션",  expect: "에너지화학 or 2차전지 — 복수섹터 확인" },
  { code: "005490", name: "POSCO홀딩스",   expect: "철강 or 2차전지 — 복수섹터 확인" },
];

for (const { code, name, expect } of cases) {
  const auto   = getSectorByCode(code);
  const uncov  = isUncovered(code);
  const multi  = getMultiSector(code);

  console.log(`── ${name} (${code}) ──`);
  console.log(`   기대: ${expect}`);

  if (uncov) {
    console.log(`   isUncovered: ✅ true`);
    console.log(`   → 시장 기준(섹터 미특정) 폴백`);
  } else {
    const primaryLabel = SECTOR_LABELS[auto.sector] ?? auto.sector;
    const etfLabel     = ETF_LABELS[auto.etfTicker];
    console.log(`   주 섹터: ${primaryLabel}  [${etfLabel}]  ${auto.weightPct}%`);

    if (multi) {
      const secondaryStr = multi.map(s => `${SECTOR_LABELS[s.sector]}(${s.etfLabel}) ${s.weightPct}%`).join(", ");
      console.log(`   복수 섹터: ${secondaryStr}`);
    } else {
      console.log(`   복수 섹터: 없음 (단일 섹터)`);
    }
  }

  // R² 신뢰도는 실제 Yahoo Finance 데이터 없이는 계산 불가 → 바이오 케이스 별도 안내
  console.log();
}

// ── R² 플래그 안내 ────────────────────────────────────────────────────
console.log("── R² 신뢰도 플래그 ──");
console.log("   R² 계산은 Yahoo Finance 월봉 fetch 필요 → getSectorAnalysis() 실제 호출 시 반환");
console.log("   임계값: R² < 0.3 → isLow: true");
console.log("   바이오ETF(244580)는 종목 다양성으로 R²가 낮을 가능성이 높음");
console.log("   (검증은 서버사이드 getSectorAnalysis('244580') 결과로 확인 필요)\n");

// ── 전체 복수섹터 보유 종목 목록 ─────────────────────────────────────
console.log("── 복수섹터 편입 종목 전체 목록 ──\n");
let multiCount = 0;
const multiList = [];
for (const [code, e] of reverseMap) {
  if (e.secondarySectors.length > 0) {
    multiCount++;
    const all = [{ sector: e.sector, etfTicker: e.etfTicker, weightPct: e.weightPct }, ...e.secondarySectors];
    multiList.push({ code, name: e.name, all });
  }
}
multiList.sort((a, b) => a.name.localeCompare(b.name));
for (const { code, name, all } of multiList) {
  const sectors = all.map(s => `${SECTOR_LABELS[s.sector]}:${s.weightPct}%`).join(" / ");
  console.log(`   ${name.padEnd(16)} (${code})  ${sectors}`);
}
console.log(`\n   총 ${multiCount}개 종목이 복수 섹터ETF에 편입됨`);
console.log(`   총 ${reverseMap.size}개 종목 커버`);
