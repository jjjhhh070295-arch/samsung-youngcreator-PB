/**
 * test-sector-coverage.mjs
 * KOSPI 시총 상위 200종목 × 현재 섹터 매핑 커버리지 실측
 *
 * $env:KRX_COOKIE="..."; node scripts/test-sector-coverage.mjs
 */
import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER  = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020203";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE   = process.env.KRX_COOKIE ?? "";
const TRD_DD   = "20260624";

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

// ── ETF → 섹터 매핑 (autoSectorMap 동일) ─────────────────────────────────
const ETF_TO_SECTOR = {
  "091160": "semiconductor",
  "305720": "battery",
  "244580": "bio",
  "139270": "finance",
  "266360": "it",
  "091180": "auto",
  "117460": "energy_chem",
  "117680": "steel",
  "441540": "shipbuilding",
  "463250": "defense",
};

// ── 수동 STOCK_SECTOR_MAP (현재 lib/sectorMap.ts 기준, SK텔레콤·LG전자 제거됨) ──
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

// ── autoSectorMap 빌드 (etf-constituents.json 기반) ──────────────────────
const etfData = JSON.parse(readFileSync(join(__dirname, "etf-constituents.json"), "utf-8"));

const _allMemberships = new Map();
for (const [ticker, etf] of Object.entries(etfData.etfs)) {
  const sector = ETF_TO_SECTOR[ticker];
  if (!sector) continue;
  for (const h of etf.holdings) {
    if (!h.code || String(h.code).startsWith("KRD")) continue;
    const entry = _allMemberships.get(h.code) ?? { name: h.name, memberships: [] };
    entry.memberships.push({ sector, etfTicker: ticker, weightPct: h.weightPct ?? 0 });
    _allMemberships.set(h.code, entry);
  }
}

const _reverseMap = new Map();
const _nameMap    = new Map();
for (const [code, { name, memberships }] of _allMemberships) {
  const sorted  = [...memberships].sort((a, b) => b.weightPct - a.weightPct);
  const primary = sorted[0];
  const entry   = { code, name, sector: primary.sector, etfTicker: primary.etfTicker, weightPct: primary.weightPct };
  _reverseMap.set(code, entry);
  _nameMap.set(name, entry);
}

// ── findEntry 재현 ──────────────────────────────────────────────────────
function findEntry(code, name) {
  // 1순위: 코드 → autoSectorMap
  const auto = _reverseMap.get(code);
  if (auto) return { sector: auto.sector, via: "auto" };

  // 2순위: 수동 STOCK_SECTOR_MAP (코드)
  const manual = STOCK_SECTOR_MAP.find(e => e.code === code);
  if (manual) {
    const autoByCode = _reverseMap.get(manual.code);
    if (autoByCode) return { sector: autoByCode.sector, via: "auto(via-manual-code)" };
    return { sector: manual.sector, via: "manual" };
  }

  // 3순위: autoSectorMap 이름
  const autoByName = _nameMap.get(name);
  if (autoByName) return { sector: autoByName.sector, via: "auto(name)" };

  return null;
}

// ── KRX POST ─────────────────────────────────────────────────────────────
async function krxPost(bld, bodyExtra = {}) {
  const body = new URLSearchParams({ bld, locale: "ko_KR", csvxls_isNo: "false", ...bodyExtra });
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": REFERER, "Origin": "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest", "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Cookie": COOKIE,
    },
    body: body.toString(),
  });
  const text = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  if (text.trim().toUpperCase() === "LOGOUT") { console.error("❌ 세션 만료"); process.exit(1); }
  try { return JSON.parse(text); } catch { return null; }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  // Step 1: KODEX200(069500) ISIN 조회
  console.log("▶ KODEX200 ISIN 조회 중...");
  const j1 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT04601", { trdDd: TRD_DD, mktTp: "ETF" });
  const etfList = j1?.OutBlock_1 ?? j1?.output ?? [];
  const kodex200 = etfList.find(r => String(r.ISU_SRT_CD ?? "").trim() === "069500");
  if (!kodex200) { console.error("KODEX200(069500) 없음"); process.exit(1); }
  const isin = String(kodex200.ISU_CD ?? "").trim();
  console.log(`  → ISIN: ${isin}\n`);

  // Step 2: KODEX200 구성종목 조회 (= KOSPI200 = 시총 상위 200, 비중≈시총)
  console.log("▶ KOSPI200 구성종목 조회 중...");
  const j2 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT05001", {
    isuCd: isin, isuCd2: isin, trdDd: TRD_DD, share: "1", money: "1",
  });
  const holdings = j2?.OutBlock_1 ?? j2?.output ?? [];
  if (!holdings.length) { console.error("응답 없음:", JSON.stringify(j2).slice(0, 200)); process.exit(1); }

  const top200 = holdings
    .filter(r => {
      const cd = String(r.COMPST_ISU_CD ?? "").trim();
      return cd && /^\d{6}$/.test(cd);
    })
    .map((r, i) => ({
      rank:      i + 1,
      code:      String(r.COMPST_ISU_CD ?? "").trim(),
      name:      String(r.COMPST_ISU_NM ?? "").trim(),
      weightPct: parseFloat(String(r.COMPST_RTO ?? "0").replace(/,/g, "")) || 0,
      ind:       "",
    }));

  console.log(`  → ${top200.length}개 로드 완료\n`);

  // ── 분류 ──────────────────────────────────────────────────────────────
  const sectorBuckets = {};
  const marketFallback = [];

  for (const stock of top200) {
    const result = findEntry(stock.code, stock.name);
    const sector = result?.sector ?? "market";

    if (sector === "market" || !result) {
      marketFallback.push(stock);
    } else {
      if (!sectorBuckets[sector]) sectorBuckets[sector] = [];
      sectorBuckets[sector].push(stock);
    }
  }

  const SECTOR_LABELS = {
    semiconductor: "반도체",
    battery:       "2차전지",
    bio:           "바이오·헬스케어",
    finance:       "금융",
    energy_chem:   "에너지화학",
    steel:         "철강",
    it:            "IT",
    auto:          "자동차",
    shipbuilding:  "조선",
    defense:       "방산",
    market:        "market 폴백",
  };

  // ── 리포트 ────────────────────────────────────────────────────────────
  const covered = top200.length - marketFallback.length;
  console.log("════════════════════════════════════════════════════════");
  console.log(` KOSPI 시총 상위 ${top200.length}종목  커버리지 리포트`);
  console.log("════════════════════════════════════════════════════════");
  console.log(` 섹터 커버:  ${covered}개 (${(covered/top200.length*100).toFixed(1)}%)`);
  console.log(` market 폴백: ${marketFallback.length}개 (${(marketFallback.length/top200.length*100).toFixed(1)}%)`);
  console.log();

  console.log("┌─ 섹터별 분포 ──────────────────────────────────────────");
  const sectorOrder = ["semiconductor","battery","bio","finance","it","auto","energy_chem","steel","shipbuilding","defense"];
  for (const s of sectorOrder) {
    const bucket = sectorBuckets[s] ?? [];
    if (!bucket.length) continue;
    const names = bucket.slice(0,6).map(x => x.name).join(", ");
    const more  = bucket.length > 6 ? ` …+${bucket.length-6}` : "";
    console.log(`│  ${(SECTOR_LABELS[s]||s).padEnd(14)} ${String(bucket.length).padStart(3)}개  ${names}${more}`);
  }
  console.log("└────────────────────────────────────────────────────────\n");

  console.log("┌─ market 폴백 종목 (시총순) ─────────────────────────────────────────────────");
  console.log("│  순위  코드    종목명                    업종(KRX)");
  console.log("│  ────  ──────  ────────────────────────  ─────────────────────────────");
  for (const s of marketFallback) {
    const rank = String(s.rank).padStart(4);
    const name = s.name.padEnd(24);
    const ind  = s.ind || "-";
    console.log(`│  ${rank}  ${s.code}  ${name}  ${ind}`);
  }
  console.log("└──────────────────────────────────────────────────────────────────────────────");
  console.log();
  console.log(`autoSectorMap 커버 종목 수: ${_reverseMap.size}개 (8 ETF 구성종목 역매핑)`);
}

main().catch(e => { console.error(e); process.exit(1); });
