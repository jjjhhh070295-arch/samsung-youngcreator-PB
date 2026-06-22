/**
 * test-krx-alt2.mjs
 * 라운드 2: 네이버 신규 API + KODEX 운용사 + KRX 세션 방식
 *
 * 실행: node scripts/test-krx-alt2.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160"; // KODEX 반도체

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}]\n  ${url}\n  → `);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const ms  = Date.now() - t0;
    const buf = await res.arrayBuffer();
    // EUC-KR 시도
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const preview = text.replace(/\s+/g, " ").slice(0, 300);
    console.log(`HTTP ${res.status}  ${ms}ms  (${buf.byteLength}bytes)`);
    console.log(`  ${preview}\n`);
    return { ok: res.ok, status: res.status, text, headers: Object.fromEntries(res.headers.entries()) };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, status: 0, text: "" };
  }
}

async function main() {
  console.log("=== 라운드 2: 네이버/운용사/KRX 세션 탐색 ===\n");

  // 1. Naver Finance 신규 패턴 (네이버 증권 리뉴얼 후 API)
  await tryFetch("NAVER new etf holdings",
    `https://api.stock.naver.com/etf/v1/${CODE}/holdings`,
    { headers: { "user-agent": UA, "Referer": "https://finance.naver.com" } });

  await tryFetch("NAVER new stock overview",
    `https://api.stock.naver.com/stock/${CODE}/overview`,
    { headers: { "user-agent": UA, "Referer": "https://finance.naver.com" } });

  await tryFetch("NAVER fnguide etf",
    `https://finance.naver.com/item/etf.naver?code=${CODE}`,
    { headers: { "user-agent": UA } });

  // 2. KODEX (삼성자산운용) 공식 사이트
  await tryFetch("KODEX portfolio API",
    `https://www.kodex.com/api/v1/fund/product/etf/${CODE}/portfolio`,
    { headers: { "user-agent": UA, "Referer": "https://www.kodex.com" } });

  await tryFetch("KODEX ETF detail",
    `https://www.kodex.com/etf/portfolio/${CODE}`,
    { headers: { "user-agent": UA, "Referer": "https://www.kodex.com" } });

  // 3. KRX 세션 방식: GET 먼저 → 쿠키 획득 → POST
  console.log("[KRX 세션 2단계] GET 메인 → 쿠키 획득 중...");
  try {
    const initRes = await fetch("https://data.krx.co.kr/contents/MDC/STAT/standard/MDCSTAT04601.cmd", {
      headers: { "user-agent": UA },
    });
    const setCookies = initRes.headers.get("set-cookie") ?? "";
    console.log(`  GET HTTP ${initRes.status}, cookies: ${setCookies.slice(0, 120)}`);

    if (setCookies) {
      // 쿠키를 갖고 POST
      const cookieStr = setCookies.split(";").filter(c => c.includes("=")).map(c => c.trim().split(";")[0]).join("; ");
      const body = new URLSearchParams({
        bld: "dbms/MDC/STAT/standard/MDCSTAT04601",
        isuCd: "KR7091160003",
        trdDd: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        share: "1",
        money: "1",
        csvxls_isNo: "false",
      });
      const postRes = await fetch("https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Referer": "https://data.krx.co.kr",
          "User-Agent": UA,
          "Cookie": cookieStr,
        },
        body: body.toString(),
      });
      const postText = await postRes.text();
      console.log(`  POST HTTP ${postRes.status}: ${postText.slice(0, 300)}\n`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}\n`);
  }

  // 4. Yahoo Finance topHoldings (확인 차원)
  await tryFetch("Yahoo topHoldings",
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${CODE}.KS?modules=topHoldings`,
    { headers: { "user-agent": UA } });
}

main().catch((e) => { console.error(e); process.exit(1); });
