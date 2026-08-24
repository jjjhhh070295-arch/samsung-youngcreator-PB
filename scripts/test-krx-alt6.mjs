/**
 * test-krx-alt6.mjs
 * A. www.samsungfund.com (KODEX 번들에서 발견된 실제 도메인)
 * B. KIS API 업종코드 — 이미 있는 infrastructure 활용
 *    stck_prpr 응답의 bstp_cls_code, bstp_kor_isnm 필드 확인
 *
 * 실행: node scripts/test-krx-alt6.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160";

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}] ${url.slice(0, 80)}\n  → `);
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");
    console.log(`HTTP ${res.status}  (${buf.byteLength}b)  JSON=${isJson}`);
    console.log(`  ${text.replace(/\s+/g," ").slice(0,300)}\n`);
    return { ok: res.ok, status: res.status, text, isJson };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, status: 0, text: "" };
  }
}

// ── KIS 현재가 API에서 업종코드 추출 ─────────────────────────────────────
async function testKisIndustryCode() {
  console.log("\n[B] KIS API 업종코드 필드 확인\n");
  const appKey    = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  if (!appKey || !appSecret) {
    console.log("  KIS_APP_KEY / KIS_APP_SECRET 환경변수 없음 — .env.local 로드 필요\n");
    return;
  }

  // 토큰 발급
  const tokenRes = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  const tokenJson = await tokenRes.json();
  const token = tokenJson.access_token;
  if (!token) { console.log(`  토큰 발급 실패: ${JSON.stringify(tokenJson).slice(0,100)}\n`); return; }
  console.log(`  토큰 발급 성공\n`);

  // 삼성전자 현재가 조회 → 업종코드 포함 필드 전체 출력
  const priceRes = await fetch(
    "https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=005930",
    {
      headers: {
        authorization: `Bearer ${token}`,
        appkey: appKey,
        appsecret: appSecret,
        tr_id: "FHKST01010100",
      },
    },
  );
  const priceJson = await priceRes.json();
  const output = priceJson?.output ?? {};
  console.log("  삼성전자(005930) output 주요 필드:");
  // 업종 관련 필드만 필터링
  for (const [k, v] of Object.entries(output)) {
    if (k.includes("bstp") || k.includes("iscd") || k.includes("name") || k.includes("cls")) {
      console.log(`    ${k}: ${v}`);
    }
  }
  // 전체 필드명 목록
  console.log(`\n  전체 필드명: ${Object.keys(output).join(", ")}`);
}

async function main() {
  console.log("=== Samsung Fund 도메인 + KIS 업종코드 탐색 ===\n");

  // A. samsungfund.com 패턴
  await tryFetch("samsungfund ETF portfolio",
    `https://www.samsungfund.com/fund/etf/portfolio.do?fndCd=A${CODE}`,
    { headers: { "user-agent": UA, "Referer": "https://www.samsungfund.com" } });

  await tryFetch("samsungfund ETF API JSON",
    `https://www.samsungfund.com/api/v1/etf/portfolio?code=${CODE}`,
    { headers: { "user-agent": UA, "Referer": "https://www.samsungfund.com" } });

  await tryFetch("samsungfund ETF detail",
    `https://www.samsungfund.com/etf/${CODE}`,
    { headers: { "user-agent": UA, "Referer": "https://www.samsungfund.com" } });

  await tryFetch("samsungfund ETF holding list",
    `https://www.samsungfund.com/fund/etf/holdingList.do?fndCd=A${CODE}`,
    { headers: { "user-agent": UA, "Referer": "https://www.samsungfund.com" } });

  // B. KIS 업종코드
  await testKisIndustryCode();
}

main().catch(e => { console.error(e); process.exit(1); });
