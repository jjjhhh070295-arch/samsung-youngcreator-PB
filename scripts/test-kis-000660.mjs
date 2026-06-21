import { readFileSync } from "fs";
import { resolve } from "path";
const env = {};
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}
const KEY = env.KIS_APP_KEY, SEC = env.KIS_APP_SECRET;
const BASE = env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";

// 토큰
const tok = await fetch(`${BASE}/oauth2/tokenP`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ grant_type: "client_credentials", appkey: KEY, appsecret: SEC }),
}).then(r => r.json()).then(j => j.access_token);
console.log("token:", tok ? "OK" : "FAIL");

// 000660
const url = `${BASE}/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=000660`;
const res = await fetch(url, { headers: { authorization: `Bearer ${tok}`, appkey: KEY, appsecret: SEC, tr_id: "FHKST01010100" } });
const json = await res.json();
console.log("HTTP:", res.status);
console.log("rt_cd:", json.rt_cd, "| msg:", json.msg1);
console.log("stck_prpr (현재가):", json?.output?.stck_prpr);
console.log("full output:", JSON.stringify(json?.output ?? json).slice(0, 400));
