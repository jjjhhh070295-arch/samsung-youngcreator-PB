/**
 * test-krx-alt6b.mjs — .env.local 직접 파싱 버전
 * 실행: node scripts/test-krx-alt6b.mjs
 */
import { readFileSync } from "fs";

// .env.local 직접 파싱 (dotenv 불필요)
const env = {};
try {
  const lines = readFileSync(".env.local", "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160";

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}]\n  ${url}\n  → `);
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");
    console.log(`HTTP ${res.status}  (${buf.byteLength}b)  JSON=${isJson}`);
    if (isJson) console.log(`  ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    console.log();
    return { ok: res.ok, status: res.status, text, isJson };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, text: "" };
  }
}

async function main() {
  console.log("=== samsungfund.com + KIS 업종코드 ===\n");

  // A. samsungfund.com
  const samUrls = [
    [`samsungfund holdingList`,  `https://www.samsungfund.com/fund/etf/holdingList.do?fndCd=A${CODE}`],
    [`samsungfund portfolio.do`, `https://www.samsungfund.com/fund/etf/portfolio.do?fndCd=A${CODE}`],
    [`samsungfund main`,         `https://www.samsungfund.com`],
  ];
  for (const [label, url] of samUrls) {
    await tryFetch(label, url, { headers: { "user-agent": UA, "Referer": "https://www.samsungfund.com" } });
  }

  // B. KIS 업종코드
  console.log("[B] KIS 업종코드 필드 탐색\n");
  const appKey    = env.KIS_APP_KEY;
  const appSecret = env.KIS_APP_SECRET;
  if (!appKey || !appSecret) { console.log("  KIS 키 없음\n"); return; }

  const tokenRes = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  const tokenJson = await tokenRes.json();
  const token = tokenJson.access_token;
  if (!token) { console.log(`  토큰 실패: ${JSON.stringify(tokenJson).slice(0, 100)}`); return; }
  console.log("  토큰 발급 OK\n");

  // 삼성전자, SK하이닉스, KB금융 — 업종코드 비교
  for (const ticker of ["005930", "000660", "105560"]) {
    const r = await fetch(
      `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`,
      { headers: { authorization: `Bearer ${token}`, appkey: appKey, appsecret: appSecret, tr_id: "FHKST01010100" } },
    );
    const j = await r.json();
    const o = j?.output ?? {};
    // 업종 관련 필드 (bstp = 업종)
    const bstpFields = Object.entries(o).filter(([k]) => k.includes("bstp"));
    console.log(`  ${ticker}: ${JSON.stringify(Object.fromEntries(bstpFields))}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
