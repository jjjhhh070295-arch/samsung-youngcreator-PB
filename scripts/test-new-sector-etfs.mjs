/**
 * test-new-sector-etfs.mjs
 * 조선·방산·통신 섹터 ETF 후보 실물 검증
 *
 * $env:KRX_COOKIE="..."; node scripts/test-new-sector-etfs.mjs
 */

const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER  = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201030105";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE   = process.env.KRX_COOKIE ?? "";
const TRD_DD   = "20260624";

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

// ── 검사 대상 종목 ───────────────────────────────────────────────────────
const CHECK = {
  shipbuilding: [
    { code: "009540", name: "HD한국조선해양" },
    { code: "329180", name: "HD현대중공업" },
    { code: "042660", name: "한화오션" },
    { code: "011200", name: "HMM" },
    { code: "071970", name: "HD현대마린엔진" },
    { code: "267270", name: "HD건설기계" },
  ],
  defense: [
    { code: "012450", name: "한화에어로스페이스" },
    { code: "047810", name: "한국항공우주" },
    { code: "272210", name: "한화시스템" },
    { code: "082740", name: "한화엔진" },
    { code: "064350", name: "현대로템" },
    { code: "079550", name: "LIG디펜스앤에어로스페이스" },
  ],
  telecom: [
    { code: "030200", name: "KT" },
    { code: "017670", name: "SK텔레콤" },
    { code: "032640", name: "LG유플러스" },
    { code: "033780", name: "KT&G" },
  ],
};

// ── 키워드 ──────────────────────────────────────────────────────────────
const SECTORS = [
  {
    id: "shipbuilding",
    label: "조선",
    keywords: ["조선", "K-조선", "Shipbuilding", "shipbuilding", "선박"],
  },
  {
    id: "defense",
    label: "방산",
    keywords: ["방산", "K-방산", "우주항공", "디펜스", "Defense", "defense", "항공우주"],
  },
  {
    id: "telecom",
    label: "통신",
    keywords: ["통신", "5G", "Telecom", "telecom", "ICT"],
  },
];

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

// ── 비중 계산 (KRD 현금 제외) ────────────────────────────────────────────
function calcHoldings(items) {
  const stocks = items.filter(i => !String(i.COMPST_ISU_CD ?? "").trim().startsWith("KRD"));
  const useValu = stocks.every(i => !parseFloat(i.COMPST_RTO));
  const totalVal = useValu ? stocks.reduce((s, i) => s + (parseFloat(i.VALU_AMT) || 0), 0) : 0;
  return stocks.map(i => {
    const rawW = parseFloat(i.COMPST_RTO);
    const wPct = (!isNaN(rawW) && rawW > 0)
      ? rawW
      : (useValu && totalVal > 0 ? Math.round((parseFloat(i.VALU_AMT)||0) / totalVal * 10000) / 100 : 0);
    return {
      code: String(i.COMPST_ISU_CD ?? "").trim(),
      name: String(i.COMPST_ISU_NM ?? "").trim(),
      wPct,
    };
  }).sort((a, b) => b.wPct - a.wPct);
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  // Step 1: 전체 ETF 목록 1회 조회
  process.stdout.write("▶ ETF 전체 목록 조회... ");
  const j = await krxPost("dbms/MDC/STAT/standard/MDCSTAT04601", { trdDd: TRD_DD, mktTp: "ETF" });
  const etfList = j?.OutBlock_1 ?? j?.output ?? [];
  console.log(`${etfList.length}개\n`);

  // Step 2: 섹터별 키워드 필터
  const sectorCandidates = {};
  for (const sec of SECTORS) {
    const matched = etfList.filter(r => {
      const nm = String(r.ISU_ABBRV ?? r.ISU_NM ?? "");
      return sec.keywords.some(kw => nm.includes(kw));
    }).map(r => ({
      code: String(r.ISU_SRT_CD ?? "").trim(),
      isin: String(r.ISU_CD ?? "").trim(),
      name: String(r.ISU_ABBRV ?? r.ISU_NM ?? "").trim(),
    }));
    sectorCandidates[sec.id] = matched;

    console.log(`━━ [${sec.label}] 키워드 후보 (${matched.length}개) ━━`);
    if (!matched.length) console.log("  (없음)");
    matched.forEach(e => console.log(`  ${e.code}  ${e.name}`));
    console.log();
  }

  // Step 3: 섹터별 대표 ETF 1개 구성종목 조회
  // - 여러 후보 중 첫 번째(보통 순수 섹터 ETF)를 선택. 단, 지수 추종 ETF 우선.
  console.log("════════════════════════════════════════════════");
  console.log(" 대표 ETF 구성종목 실물 검증");
  console.log("════════════════════════════════════════════════\n");

  for (const sec of SECTORS) {
    const candidates = sectorCandidates[sec.id];
    if (!candidates.length) {
      console.log(`[${sec.label}] ❌ 후보 없음\n`);
      continue;
    }

    // 후보 전체에 대해 구성종목 조회 (최대 4개까지, 과부하 방지)
    const toQuery = candidates.slice(0, 4);
    const results = [];

    for (const etf of toQuery) {
      process.stdout.write(`  [${sec.label}] ${etf.code} ${etf.name} 조회... `);
      const j2 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT05001", {
        isuCd: etf.isin, isuCd2: etf.isin, trdDd: TRD_DD, share: "1", money: "1",
      });
      const items = j2?.OutBlock_1 ?? j2?.output ?? [];
      console.log(`${items.length}개`);
      const holdings = calcHoldings(items);
      results.push({ etf, holdings });
    }
    console.log();

    const checkList = CHECK[sec.id];

    for (const { etf, holdings } of results) {
      console.log(`  ┌ ${etf.code}  ${etf.name}  (편입 ${holdings.length}개)`);
      console.log(`  ├─ Top 10 ────────────────────────────────────`);
      holdings.slice(0, 10).forEach((h, i) =>
        console.log(`  │  ${String(i+1).padStart(2)}. ${h.code}  ${h.name.padEnd(20)} ${h.wPct.toFixed(2).padStart(6)}%`)
      );
      console.log(`  ├─ 검사 종목 ─────────────────────────────────`);
      for (const t of checkList) {
        const found = holdings.find(h => h.code === t.code);
        const line = found
          ? `✅  ${found.wPct.toFixed(2).padStart(5)}%  (${holdings.indexOf(found)+1}위)`
          : "❌  없음";
        console.log(`  │  ${t.name.padEnd(18)} ${line}`);
      }
      console.log(`  └─────────────────────────────────────────────\n`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
