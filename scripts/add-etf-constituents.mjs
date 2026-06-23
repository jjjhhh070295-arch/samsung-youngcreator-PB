/**
 * add-etf-constituents.mjs
 * etf-constituents.json에 신규 ETF 2개 추가 (기존 8개 보존)
 *
 * $env:KRX_COOKIE="..."; node scripts/add-etf-constituents.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER  = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201030105";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE   = process.env.KRX_COOKIE ?? "";
const TRD_DD   = "20260624";

const NEW_TARGETS = [
  { code: "441540", label: "HANARO Fn조선해운" },
  { code: "463250", label: "TIGER K방산&우주"  },
];

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

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

async function main() {
  // 1. 기존 JSON 로드
  const jsonPath = join(__dirname, "etf-constituents.json");
  const existing = JSON.parse(readFileSync(jsonPath, "utf-8"));
  console.log(`기존 ETF 수: ${Object.keys(existing.etfs).length}개`);

  // 2. ETF 목록에서 ISIN 조회 (1회 호출)
  process.stdout.write("ISIN 조회 중... ");
  const j1 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT04601", { trdDd: TRD_DD, mktTp: "ETF" });
  const etfList = j1?.OutBlock_1 ?? j1?.output ?? [];
  const isinMap = {};
  for (const r of etfList) {
    const srt = String(r.ISU_SRT_CD ?? "").trim();
    if (NEW_TARGETS.some(t => t.code === srt)) {
      isinMap[srt] = { isin: String(r.ISU_CD ?? "").trim(), name: String(r.ISU_ABBRV ?? "").trim() };
    }
  }
  console.log(`완료 (${Object.keys(isinMap).length}/${NEW_TARGETS.length}개 매칭)\n`);

  // 3. 각 ETF 구성종목 수집
  for (const target of NEW_TARGETS) {
    const info = isinMap[target.code];
    if (!info) { console.log(`[${target.code}] ❌ 목록에 없음 — 스킵\n`); continue; }

    process.stdout.write(`[${target.code}] ${info.name} 구성종목 조회... `);
    const j2 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT05001", {
      isuCd: info.isin, isuCd2: info.isin, trdDd: TRD_DD, share: "1", money: "1",
    });
    const items = j2?.OutBlock_1 ?? j2?.output ?? [];
    console.log(`${items.length}개`);

    // KRD(현금·채권) 제외 + 비중 계산
    const stocks = items.filter(i => !String(i.COMPST_ISU_CD ?? "").trim().startsWith("KRD"));
    const useValu = stocks.every(i => !parseFloat(i.COMPST_RTO));
    const totalVal = useValu ? stocks.reduce((s, i) => s + (parseFloat(i.VALU_AMT) || 0), 0) : 0;

    const holdings = stocks.map(i => {
      const rawW = parseFloat(i.COMPST_RTO);
      const wPct = (!isNaN(rawW) && rawW > 0)
        ? rawW
        : (useValu && totalVal > 0 ? Math.round((parseFloat(i.VALU_AMT)||0) / totalVal * 10000) / 100 : 0);
      return {
        code:      String(i.COMPST_ISU_CD ?? "").trim(),
        name:      String(i.COMPST_ISU_NM ?? "").trim(),
        weightPct: wPct,
      };
    }).sort((a, b) => b.weightPct - a.weightPct);

    // 4. 기존 JSON에 추가/덮어쓰기
    existing.etfs[target.code] = {
      label:    target.label,
      isin:     info.isin,
      count:    holdings.length,
      holdings,
    };

    // top3 확인 출력
    console.log(`  top3: ${holdings.slice(0,3).map(h => `${h.name}(${h.weightPct.toFixed(1)}%)`).join(", ")}`);
  }

  // 5. 저장
  existing.capturedAt = new Date().toISOString();
  existing.trdDd      = TRD_DD;
  writeFileSync(jsonPath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`\n✅ etf-constituents.json 업데이트 완료 — 총 ${Object.keys(existing.etfs).length}개 ETF`);
}

main().catch(e => { console.error(e); process.exit(1); });
