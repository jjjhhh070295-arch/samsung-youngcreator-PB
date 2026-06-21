/**
 * KIS OpenAPI 연결 테스트 (토큰 → 삼성전자 시세)
 * node scripts/test-kis.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// .env.local 파싱
const envPath = resolve(process.cwd(), ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const APP_KEY    = env.KIS_APP_KEY;
const APP_SECRET = env.KIS_APP_SECRET;
const BASE_URL   = env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

if (!APP_KEY || !APP_SECRET) {
  console.error("❌ KIS_APP_KEY 또는 KIS_APP_SECRET 가 .env.local에 없습니다.");
  process.exit(1);
}

// 키 마스킹 (앞 6자리만 표시)
const mask = (s) => s.slice(0, 6) + "…(hidden)";
console.log(`\n=== KIS 연결 테스트 ===`);
console.log(`BASE_URL   : ${BASE_URL}`);
console.log(`APP_KEY    : ${mask(APP_KEY)}`);
console.log(`APP_SECRET : ${mask(APP_SECRET)}\n`);

// ── Step 1: 토큰 발급 ──────────────────────────────────────────────────────
console.log("[1/3] 토큰 발급 중...");
let token;
try {
  const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: APP_KEY,
      appsecret: APP_SECRET,
    }),
  });

  const json = await res.json();
  if (!res.ok || !json.access_token) {
    console.error("❌ 토큰 발급 실패:", JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }

  token = json.access_token;
  const expiresIn = json.expires_in ?? "(unknown)";
  console.log(`✓ 토큰 발급 성공 (유효: ${expiresIn}초)\n`);
} catch (e) {
  console.error("❌ 토큰 요청 에러:", e.message);
  process.exit(1);
}

// ── Step 2: 삼성전자(005930) 현재가 ───────────────────────────────────────
console.log("[2/3] 삼성전자(005930) 현재가 조회...");
try {
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price` +
              `?fid_cond_mrkt_div_code=J&fid_input_iscd=005930`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: "FHKST01010100",
    },
  });

  const json = await res.json();
  if (!res.ok) {
    console.error("❌ 시세 조회 실패:", JSON.stringify(json).slice(0, 200));
    process.exit(1);
  }

  const o = json?.output ?? {};
  const price     = parseFloat(o.stck_prpr);
  const prevClose = parseFloat(o.stck_sdpr);
  const chg       = parseFloat(o.prdy_ctrt); // 전일비 등락률
  const vol       = parseInt(o.acml_vol, 10);

  if (!isFinite(price)) {
    console.error("❌ 가격 파싱 실패. 응답:", JSON.stringify(json).slice(0, 300));
    process.exit(1);
  }

  const sign = chg >= 0 ? "▲" : "▼";
  console.log(`✓ 삼성전자(005930) 현재가: ${price.toLocaleString("ko-KR")}원`);
  console.log(`  전일종가: ${prevClose.toLocaleString("ko-KR")}원`);
  console.log(`  등락률  : ${sign} ${Math.abs(chg).toFixed(2)}%`);
  console.log(`  누적거래량: ${vol.toLocaleString("ko-KR")}주\n`);
} catch (e) {
  console.error("❌ 시세 조회 에러:", e.message);
  process.exit(1);
}

// ── Step 3: KOSPI 지수 (선택) ─────────────────────────────────────────────
console.log("[3/3] KOSPI 지수 조회...");
try {
  const url = `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-index-price` +
              `?fid_cond_mrkt_div_code=U&fid_input_iscd=0001`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: "FHPUP02100000",
    },
  });

  const json = await res.json();
  const o = json?.output ?? {};
  const idx = parseFloat(o.bstp_nmix_prpr);
  if (isFinite(idx)) {
    const chg = parseFloat(o.bstp_nmix_prdy_ctrt);
    const sign = chg >= 0 ? "▲" : "▼";
    console.log(`✓ KOSPI: ${idx.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} (${sign}${Math.abs(chg).toFixed(2)}%)\n`);
  } else {
    console.log(`  KOSPI 지수: 파싱 불가 (${JSON.stringify(json).slice(0, 100)})\n`);
  }
} catch (e) {
  console.log(`  KOSPI 조회 에러: ${e.message}\n`);
}

console.log("=== 테스트 완료 ✓ — /api/prices 엔드포인트 연결 준비 완료 ===");
