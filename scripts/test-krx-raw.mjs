/**
 * test-krx-raw.mjs
 * KRX data.krx.co.kr ETF 구성종목 API 원시 응답 확인.
 * 어느 bld 파라미터가 구성종목을 반환하는지 탐색.
 *
 * 실행: node scripts/test-krx-raw.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

// 오늘 날짜 (주말이면 금요일로 보정)
function recentTradingDay() {
  const d = new Date();
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() - 2); // 일요일 → 금요일
  if (dow === 6) d.setDate(d.getDate() - 1); // 토요일 → 금요일
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

const trdDd = recentTradingDay();
console.log(`조회 날짜: ${trdDd}\n`);

// KODEX 반도체 (091160) ISIN 후보들
const ISINs = [
  "KR7091160003", // 일반적인 ETF ISIN 패턴
  "KR7091160008", // 대안
];

// 시도할 bld 파라미터 목록
const BLD_CANDIDATES = [
  "dbms/MDC/STAT/standard/MDCSTAT04601", // ETF 기본현황 (가격/NAV)
  "dbms/MDC/STAT/standard/MDCSTAT04602", // ETF PDF (구성종목) 후보
  "dbms/MDC/STAT/standard/MDCSTAT04603", // 대안
  "dbms/MDC/STAT/standard/MDCSTAT04605", // 대안
];

async function tryKrx(bld, isuCd) {
  const body = new URLSearchParams({
    bld,
    isuCd,
    trdDd,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
  });

  const t0 = Date.now();
  try {
    const res = await fetch(KRX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Referer": "https://data.krx.co.kr",
        "User-Agent": UA,
        "Accept": "application/json, text/javascript, */*",
        "Origin": "https://data.krx.co.kr",
      },
      body: body.toString(),
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    return { ok: res.ok, status: res.status, ms, text: text.slice(0, 800) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, text: `ERROR: ${e.message}` };
  }
}

async function main() {
  // 1. bld 탐색
  console.log("=== KRX bld 파라미터 탐색 ===\n");
  for (const bld of BLD_CANDIDATES) {
    process.stdout.write(`[${bld.split("/").pop()}] isuCd=${ISINs[0]} ... `);
    const r = await tryKrx(bld, ISINs[0]);
    console.log(`HTTP ${r.status}  ${r.ms}ms`);
    console.log(`  응답: ${r.text.slice(0, 300)}\n`);
  }

  // 2. ISIN 형식 탐색 (bld가 작동하는 걸로)
  console.log("=== ISIN 형식 확인 ===\n");
  for (const isuCd of ISINs) {
    process.stdout.write(`[${isuCd}] ... `);
    const r = await tryKrx(BLD_CANDIDATES[1], isuCd);
    console.log(`HTTP ${r.status}  ${r.ms}ms`);
    const snippet = r.text.slice(0, 200);
    console.log(`  응답: ${snippet}\n`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
