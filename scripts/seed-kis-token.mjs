/**
 * KIS 토큰을 발급받아 파일 캐시에 저장 (Next.js 서버가 재사용 가능하도록)
 * node scripts/seed-kis-token.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { resolve } from "path";

const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const KEY  = env.KIS_APP_KEY;
const SEC  = env.KIS_APP_SECRET;
const BASE = env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const TOKEN_FILE = join(process.env.TEMP ?? process.env.TMPDIR ?? "/tmp", "kis-token-cache.json");

console.log("KIS 토큰 발급 시도...");
const res = await fetch(`${BASE}/oauth2/tokenP`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ grant_type: "client_credentials", appkey: KEY, appsecret: SEC }),
});

const json = await res.json();
console.log("HTTP:", res.status, "| rt_cd:", json.rt_cd, "| msg:", json.msg1 ?? "-");

if (!res.ok || !json.access_token) {
  console.error("❌ 토큰 발급 실패. KIS 일일 rate-limit 초과 가능.");
  console.error("   내일(자정 이후) 다시 시도하거나, 다른 시간대에 시도하세요.");
  process.exit(1);
}

const cached = {
  access_token: json.access_token,
  expires_at:   Date.now() + (json.expires_in ?? 86_400) * 1_000,
};
writeFileSync(TOKEN_FILE, JSON.stringify(cached), "utf-8");
console.log(`✓ 토큰 저장 완료 → ${TOKEN_FILE}`);
console.log(`  유효기간: ${json.expires_in ?? 86400}초 (~${Math.round((json.expires_in ?? 86400)/3600)}시간)`);
console.log("\n→ Next.js 서버가 이 파일을 자동으로 읽어 사용합니다.");
