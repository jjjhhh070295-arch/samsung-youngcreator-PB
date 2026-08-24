/**
 * test-datagokr.mjs
 * 공공데이터포털(data.go.kr) 금융/KRX 관련 공개 API 탐색
 * - 인증키 없이 접근 가능한 엔드포인트 확인
 * - 인증키 필요한 API의 존재 여부 파악
 *
 * 실행: node scripts/test-datagokr.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`\n[${label}]\n  ${url}\n  → `);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const ms  = Date.now() - t0;
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const isJson = text.trim().startsWith("{") || text.trim().startsWith("[") || text.includes("<response>");
    const isXml  = text.trim().startsWith("<?xml") || text.trim().startsWith("<response");
    console.log(`HTTP ${res.status}  ${ms}ms  (${buf.byteLength}b)  JSON/XML=${isJson||isXml}`);
    console.log(`  ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return { ok: false, text: "" };
  }
}

async function main() {
  console.log("=== 공공데이터포털(data.go.kr) 금융/KRX API 탐색 ===\n");

  // 1. 금융위원회 주식시세 공공 API (인증키 없이 구조 확인)
  // https://www.data.go.kr/data/15094808/openapi.do — 주식시세정보
  await tryFetch("금융위 주식시세 (no key)",
    "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo" +
    "?serviceKey=INVALID&numOfRows=3&pageNo=1&resultType=json&beginBasDt=20260601&itmsNm=삼성전자",
    { headers: { "user-agent": UA } });

  // 2. 금융위원회 ETF 정보 API
  // https://www.data.go.kr/data/15094832/openapi.do — ETF정보
  await tryFetch("금융위 ETF정보 (no key)",
    "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getEtfPriceInfo" +
    "?serviceKey=INVALID&numOfRows=3&pageNo=1&resultType=json&isinCd=KR7091160003",
    { headers: { "user-agent": UA } });

  // 3. 한국거래소 업종분류현황 공공 API
  await tryFetch("KRX 업종분류 (no key)",
    "https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo" +
    "?serviceKey=INVALID&numOfRows=3&pageNo=1&resultType=json&mrktCls=KOSPI&itmsNm=삼성전자",
    { headers: { "user-agent": UA } });

  // 4. data.go.kr 자체 검색 — 어떤 API가 있나
  await tryFetch("data.go.kr 검색 (ETF 구성종목)",
    "https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15094832",
    { headers: { "user-agent": UA } });

  // 5. 금융감독원 DART OpenAPI (전자공시)
  await tryFetch("DART API 목록",
    "https://opendart.fss.or.kr/api/list.json?corp_code=00126380&bgn_de=20260101&pblntf_ty=A&crtfc_key=INVALID",
    { headers: { "user-agent": UA } });

  // 6. 세이브로 (증권정보포털) 펀드정보
  await tryFetch("세이브로 펀드정보",
    "https://www.fundservice.co.kr/fundinfo/fundInfo.do?fundCd=K55S001CE8H3",
    { headers: { "user-agent": UA } });

  // 7. 금융투자협회 종합통계포털 (비공개 API 가능성)
  await tryFetch("KOFIA 통계 ETF",
    "https://freesis.kofia.or.kr/svc/statistics/stat/etf/listThemeEtfInfo.do",
    {
      method: "POST",
      headers: { "user-agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Referer": "https://freesis.kofia.or.kr" },
      body: "fromDate=20260601&toDate=20260622&etfItmsNm=KODEX반도체",
    });
}

main().catch(e => { console.error(e); process.exit(1); });
