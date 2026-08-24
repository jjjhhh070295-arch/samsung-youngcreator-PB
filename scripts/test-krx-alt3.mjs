/**
 * test-krx-alt3.mjs
 * 라운드 3:
 *  A. KODEX SPA 내부 API 엔드포인트 탐색 (HTML에서 apiBase 추출)
 *  B. Samsung 자산운용 공개 PDF API
 *  C. KRX 세션 강화 (JSESSIONID + Referer 체인)
 *  D. 운영사 공개 API (Mirae TIGER)
 *
 * 실행: node scripts/test-krx-alt3.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160";

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}]\n  ${url.slice(0, 100)}\n  → `);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const ms  = Date.now() - t0;
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const preview = text.replace(/\s+/g, " ").slice(0, 400);
    console.log(`HTTP ${res.status}  ${ms}ms  (${buf.byteLength}bytes)`);
    console.log(`  ${preview}\n`);
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, status: 0, text: "" };
  }
}

async function main() {
  console.log("=== 라운드 3 ===\n");

  // A. Samsung Asset Management 공개 API 패턴들
  const samHosts = [
    `https://www.samsungfunds.com/fund/etf/portfolio.do?fndCd=A${CODE}`,
    `https://www.samsungfunds.com/fund/etf/portfolioList.do?fndCd=A${CODE}`,
    `https://www.kodex.com/etf/json/portfolio?code=${CODE}`,
    `https://www.kodex.com/api/etf/portfolio?code=${CODE}`,
    `https://www.kodex.com/api/v2/etf/${CODE}/portfolio`,
  ];
  for (const url of samHosts) {
    await tryFetch("KODEX/SAM api", url, { headers: { "user-agent": UA, "Referer": "https://www.kodex.com" } });
  }

  // B. Mirae Asset TIGER
  await tryFetch("TIGER portfolio",
    `https://www.tigeretf.com/api/etf/portfolio?itemCode=305720`,  // KODEX 2차전지로 테스트
    { headers: { "user-agent": UA, "Referer": "https://www.tigeretf.com" } });

  // C. KRX 강화 세션 - MDCSTAT04602 (구성종목 전용일 수 있음)
  console.log("[KRX 강화 세션] 3단계 체인...");
  try {
    // 1단계: 메인 진입
    const r1 = await fetch("https://data.krx.co.kr", { headers: { "user-agent": UA } });
    const c1 = r1.headers.get("set-cookie") ?? "";
    const cookies1 = c1.split(",").map(c => c.trim().split(";")[0]).join("; ");

    // 2단계: 실제 데이터 페이지 진입
    const r2 = await fetch("https://data.krx.co.kr/contents/MDC/STAT/standard/MDCSTAT04602.cmd", {
      headers: { "user-agent": UA, "Referer": "https://data.krx.co.kr", "Cookie": cookies1 },
    });
    const c2 = r2.headers.get("set-cookie") ?? "";
    const cookies2 = [cookies1, ...c2.split(",").map(c => c.trim().split(";")[0])].filter(Boolean).join("; ");
    console.log(`  2단계 HTTP ${r2.status}, cookies: ${cookies2.slice(0, 100)}`);

    // 3단계: 구성종목 POST
    const trdDd = (() => { const d = new Date(); const dow = d.getDay(); if (dow === 0) d.setDate(d.getDate()-2); if (dow === 6) d.setDate(d.getDate()-1); return d.toISOString().slice(0,10).replace(/-/g,""); })();
    for (const bld of ["dbms/MDC/STAT/standard/MDCSTAT04601", "dbms/MDC/STAT/standard/MDCSTAT04602"]) {
      const body = new URLSearchParams({ bld, isuCd: `KR7${CODE}003`, trdDd, share:"1", money:"1", csvxls_isNo:"false" });
      const r3 = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": "https://data.krx.co.kr/contents/MDC/STAT/standard/MDCSTAT04602.cmd",
          "Origin": "https://data.krx.co.kr",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": UA,
          "Cookie": cookies2,
        },
        body: body.toString(),
      });
      const t3 = await r3.text();
      console.log(`  [${bld.split("/").pop()}] POST HTTP ${r3.status}: ${t3.slice(0,250)}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
