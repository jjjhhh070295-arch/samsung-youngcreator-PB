/**
 * KIS 종목 검색 API 테스트
 * node scripts/test-kis-search.mjs
 */
import { readFileSync } from "fs";
import { join, resolve } from "path";
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const KEY  = env.KIS_APP_KEY;
const SEC  = env.KIS_APP_SECRET;
const BASE = env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const TOKEN_FILE = join(process.env.TEMP ?? "/tmp", "kis-token-cache.json");

// 캐시 토큰 읽기
const token = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")).access_token;
console.log("캐시 토큰 사용:", token ? "OK" : "없음");

const headers = { authorization: `Bearer ${token}`, appkey: KEY, appsecret: SEC };

// 시도 1: psearch-title (종목명 검색)
console.log("\n[1] psearch-title — NAVER 검색");
const r1 = await fetch(`${BASE}/uapi/domestic-stock/v1/quotations/psearch-title?AUTH=&USER_ID=&SEQ=1`, {
  headers: { ...headers, tr_id: "CTPF1604R", custtype: "P" }
});
const j1 = await r1.json();
console.log(`HTTP:${r1.status} | rt_cd:${j1.rt_cd} | msg:${j1.msg1}`);

// 시도 2: search-stock-info (6자리 종목코드 → 이름 반대 방향)
console.log("\n[2] search-stock-info — 035420 조회");
const r2 = await fetch(`${BASE}/uapi/domestic-stock/v1/quotations/search-stock-info?PRDT_TYPE_CD=300&PDNO=035420`, {
  headers: { ...headers, tr_id: "CTPF1604R" }
});
const j2 = await r2.json();
console.log(`HTTP:${r2.status} | rt_cd:${j2.rt_cd} | msg:${j2.msg1}`);
if (j2.output) console.log("output:", JSON.stringify(j2.output).slice(0,200));

// 시도 3: inquire-price로 종목명 확인 (코드→이름)
console.log("\n[3] inquire-price 005930 → 종목명 필드 확인");
const r3 = await fetch(`${BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=005930`, {
  headers: { ...headers, tr_id: "FHKST01010100" }
});
const j3 = await r3.json();
console.log(`종목명 필드들:`, {
  hts_kor_isnm: j3?.output?.hts_kor_isnm,
  stck_shrn_iscd: j3?.output?.stck_shrn_iscd,
});
