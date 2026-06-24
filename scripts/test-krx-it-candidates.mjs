/**
 * test-krx-it-candidates.mjs
 * 266370(KODEX IT) · 157490(TIGER 소프트웨어) 2개만 조회
 *
 * $env:KRX_COOKIE="..."; node scripts/test-krx-it-candidates.mjs
 */

const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201030105";
const UA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE  = process.env.KRX_COOKIE ?? "";
const TRD_DD  = "20260624";

const TARGETS = ["266370", "157490"];

const CHECK_STOCKS = [
  { code: "035420", name: "NAVER" },
  { code: "035720", name: "카카오" },
  { code: "017670", name: "SK텔레콤" },
  { code: "066570", name: "LG전자" },
];

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

async function krxPost(bld, body) {
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": REFERER, "Origin": "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest", "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Cookie": COOKIE,
    },
    body: new URLSearchParams({ locale: "ko_KR", csvxls_isNo: "false", bld, ...body }).toString(),
  });
  const text = new TextDecoder("utf-8").decode(await res.arrayBuffer());
  if (text.trim().toUpperCase() === "LOGOUT") { console.error("❌ 세션 만료"); process.exit(1); }
  try { return JSON.parse(text); } catch { return null; }
}

async function main() {
  // Step 1: ISIN 조회 (전체 ETF 목록에서 2개 코드 추출)
  process.stdout.write("ISIN 조회 중... ");
  const j1 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT04601", { trdDd: TRD_DD, mktTp: "ETF" });
  const list = j1?.OutBlock_1 ?? j1?.output ?? [];
  const isinMap = {};
  for (const item of list) {
    const srt = String(item.ISU_SRT_CD ?? "").trim();
    if (TARGETS.includes(srt)) {
      isinMap[srt] = {
        isin: String(item.ISU_CD ?? "").trim(),
        name: String(item.ISU_ABBRV ?? item.ISU_NM ?? "").trim(),
      };
    }
  }
  console.log(`완료 (${list.length}개 중 ${Object.keys(isinMap).length}개 매칭)\n`);

  // Step 2: 각 ETF 구성종목 조회
  for (const srt of TARGETS) {
    const info = isinMap[srt];
    if (!info) { console.log(`[${srt}] ❌ 목록에 없음\n`); continue; }

    process.stdout.write(`[${srt}] ${info.name} 구성종목 조회... `);
    const j2 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT05001", {
      isuCd: info.isin, isuCd2: info.isin, trdDd: TRD_DD, share: "1", money: "1",
    });
    const items = j2?.OutBlock_1 ?? j2?.output ?? [];
    console.log(`${items.length}개\n`);

    // 비중 계산 (현금·채권 KRD 코드 제외)
    const stockItems = items.filter(i => !String(i.COMPST_ISU_CD ?? "").trim().startsWith("KRD"));
    const useValu    = stockItems.every(i => !parseFloat(i.COMPST_RTO));
    const totalVal   = useValu ? stockItems.reduce((s, i) => s + (parseFloat(i.VALU_AMT) || 0), 0) : 0;
    const holdings = stockItems.map(i => {
      const rawW = parseFloat(i.COMPST_RTO);
      const wPct = (!isNaN(rawW) && rawW > 0)
        ? rawW
        : (useValu && totalVal > 0 ? Math.round((parseFloat(i.VALU_AMT)||0) / totalVal * 10000) / 100 : 0);
      return { code: String(i.COMPST_ISU_CD ?? "").trim(), name: String(i.COMPST_ISU_NM ?? "").trim(), wPct };
    }).sort((a, b) => b.wPct - a.wPct);

    console.log(`  ┌ 실제 이름: ${info.name}  (ISIN: ${info.isin})`);
    console.log(`  ├ 총 편입: ${holdings.length}개`);
    console.log(`  ├─ Top 10 ─────────────────────────────`);
    holdings.slice(0, 10).forEach((h, i) =>
      console.log(`  │  ${String(i+1).padStart(2)}. ${h.code.padEnd(7)} ${h.name.padEnd(20)} ${h.wPct.toFixed(2).padStart(6)}%`)
    );
    console.log(`  ├─ 검사 종목 ────────────────────────────`);
    for (const t of CHECK_STOCKS) {
      const found = holdings.find(h => h.code.replace(/\s/g,"").includes(t.code));
      const result = found ? `✅  ${found.wPct.toFixed(2)}%  (${found.rank ?? holdings.indexOf(found)+1}위)` : "❌  없음";
      console.log(`  │  ${t.name.padEnd(10)} ${result}`);
    }
    console.log(`  └───────────────────────────────────────\n`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
