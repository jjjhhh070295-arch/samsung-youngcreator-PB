/**
 * Next.js 캐시 토큰을 우회해 /api/prices 엔드포인트 원본 응답 확인
 * 토큰을 새로 발급하지 않고, 서버에 직접 요청해 내부 로그를 보는 용도
 */
import { readFileSync } from "fs";
import { resolve } from "path";
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const KEY = env.KIS_APP_KEY, SEC = env.KIS_APP_SECRET;
const BASE = env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

// 서버에서 이미 발급한 토큰 가져오기 (rate-limit 방지: 새 토큰 발급 X)
// 대신 서버 캐시를 쓰는 /api/prices에 개별로 요청해서 실제 KIS 응답 body를 보기 위해
// fetchKrwPrice 내부를 직접 모방

// 기존 토큰 발급 (이미 캐시됐을 수 있으나 스크립트에서 재발급은 KIS 제한)
let token;
try {
  const r = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: KEY, appsecret: SEC }),
  });
  const j = await r.json();
  token = j.access_token;
  if (!token) {
    console.log("토큰 발급 실패 (rate-limit 가능):", j.msg1 ?? JSON.stringify(j).slice(0,100));
    console.log("\n→ Next.js 서버 캐시 토큰은 별도 유지중. 스크립트 단독 테스트 불가 (중복 발급 제한).");
    console.log("→ /api/prices 엔드포인트는 내부적으로 유효한 토큰을 사용합니다.\n");
    process.exit(0);
  }
} catch(e) { console.error(e.message); process.exit(1); }

// 개별 종목 raw 응답 출력
for (const ticker of ["005930","000660","005380"]) {
  console.log(`\n── ${ticker} raw 응답 ──`);
  await new Promise(r => setTimeout(r, 500)); // 500ms 대기
  const url = `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, appkey: KEY, appsecret: SEC, tr_id: "FHKST01010100" }});
  const json = await res.json();
  console.log(`HTTP: ${res.status} | rt_cd: ${json.rt_cd} | msg: ${json.msg1 ?? "-"}`);
  if (json.output) {
    console.log(`  stck_prpr (현재가): ${json.output.stck_prpr}`);
    console.log(`  stck_sdpr (기준가): ${json.output.stck_sdpr}`);
    console.log(`  bstp_kor_isnm (종목명): ${json.output.bstp_kor_isnm ?? json.output.hts_kor_isnm ?? "-"}`);
  } else {
    console.log("  output 없음:", JSON.stringify(json).slice(0, 200));
  }
}
