/**
 * test-krx-alt.mjs
 * KRX 세션 필요 → 대안 소스 탐색
 *   A. 네이버 금융 ETF 구성종목 API (기존 etfItemList와 동일 패턴)
 *   B. 네이버 모바일 API
 *   C. KRX open data (다른 엔드포인트)
 *
 * 실행: node scripts/test-krx-alt.mjs
 */

const UA_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const UA_MOBILE  = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const ETF_CODE   = "091160"; // KODEX 반도체

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}] ... `);
  const t0 = Date.now();
  try {
    const res = await fetch(url, opts);
    const ms  = Date.now() - t0;
    const text = await res.text();
    console.log(`HTTP ${res.status}  ${ms}ms  (${text.length}bytes)`);
    console.log(`  ${text.slice(0, 400)}\n`);
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, text: "" };
  }
}

async function main() {
  console.log(`=== ETF 구성종목 데이터 소스 탐색 (KODEX 반도체 ${ETF_CODE}) ===\n`);

  // A-1. 네이버 금융 ETF 포트폴리오 API (공식 패턴 변형)
  await tryFetch(
    "NAVER etfPortfolioList",
    `https://finance.naver.com/api/sise/etfPortfolioList.naver?etfcode=${ETF_CODE}`,
    { headers: { "user-agent": UA_DESKTOP, "Referer": "https://finance.naver.com" } },
  );

  // A-2. 네이버 금융 ETF 상세페이지 (HTML) — 구성종목 테이블 있음
  await tryFetch(
    "NAVER etfItemDetail HTML",
    `https://finance.naver.com/fund/etfItemDetail.naver?itemCode=${ETF_CODE}`,
    { headers: { "user-agent": UA_DESKTOP, "Referer": "https://finance.naver.com" } },
  );

  // A-3. 네이버 시세 API 변형
  await tryFetch(
    "NAVER sise etfItem",
    `https://finance.naver.com/api/sise/etfItem.naver?itemCode=${ETF_CODE}`,
    { headers: { "user-agent": UA_DESKTOP, "Referer": "https://finance.naver.com" } },
  );

  // B-1. 네이버 모바일 증권 API (종종 구성종목 반환)
  await tryFetch(
    "NAVER mobile etfPortfolio",
    `https://m.stock.naver.com/api/stock/${ETF_CODE}/etfPortfolio`,
    { headers: { "user-agent": UA_MOBILE, "Referer": "https://m.stock.naver.com" } },
  );

  // B-2. 네이버 모바일 ETF 상세
  await tryFetch(
    "NAVER mobile etfDetail",
    `https://m.stock.naver.com/api/stock/${ETF_CODE}/etfDetail`,
    { headers: { "user-agent": UA_MOBILE, "Referer": "https://m.stock.naver.com" } },
  );

  // C. KRX OpenAPI 다른 경로
  await tryFetch(
    "KRX openapi etf",
    `https://openapi.krx.co.kr/contents/OPP/USES/info/EQY_IND_INFO_CSV_GENERATOR.cmd?operclas=ETFTN&isucod=${ETF_CODE}`,
    { headers: { "user-agent": UA_DESKTOP } },
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
