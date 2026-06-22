/**
 * test-kis-etf-tr.mjs
 * KIS 실계좌로 ETF 구성종목 TR 실제 호출
 * - TR 후보: FHKST12010100, FHKST11130200, FHKST11130000, FHPST12010000
 * - 엔드포인트 후보: inquire-etf-pdf, inquire-etfNlst, inquire-etfcomponent 등
 *
 * 실행: node scripts/test-kis-etf-tr.mjs
 */
import { readFileSync } from "fs";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const BASE = "https://openapi.koreainvestment.com:9443";
const ETF_CODE = "091160"; // KODEX 반도체

async function getToken() {
  const res = await fetch(`${BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: env.KIS_APP_KEY,
      appsecret: env.KIS_APP_SECRET,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(j).slice(0,100)}`);
  return j.access_token;
}

async function kisGet(token, path, params, trId, label) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  process.stdout.write(`\n[${label}]\n  TR: ${trId}\n  URL: ${url.pathname}?${url.searchParams}\n  → `);
  const t0 = Date.now();
  try {
    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        appkey:    env.KIS_APP_KEY,
        appsecret: env.KIS_APP_SECRET,
        tr_id:     trId,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
    const ms = Date.now() - t0;
    const json = await res.json();
    const rtCd    = json?.rt_cd ?? json?.msg_cd ?? "?";
    const msg1    = json?.msg1  ?? json?.msg  ?? "";
    const hasData = json?.output || json?.output1 || json?.output2;
    console.log(`HTTP ${res.status}  ${ms}ms  rt_cd=${rtCd}`);
    console.log(`  msg: ${msg1}`);
    if (hasData) {
      const data = json.output || json.output1 || json.output2;
      if (Array.isArray(data)) {
        console.log(`  배열 ${data.length}개, 첫 항목: ${JSON.stringify(data[0]).slice(0, 200)}`);
      } else {
        console.log(`  객체: ${JSON.stringify(data).slice(0, 300)}`);
      }
    } else {
      console.log(`  전체 응답: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  const appKey = env.KIS_APP_KEY;
  const appSecret = env.KIS_APP_SECRET;
  if (!appKey || !appSecret) { console.error("KIS_APP_KEY / KIS_APP_SECRET 없음"); process.exit(1); }

  console.log("=== KIS 실계좌 ETF TR 실제 호출 테스트 ===");
  console.log(`대상: KODEX 반도체 (${ETF_CODE})\n`);

  const token = await getToken();
  console.log("토큰 발급 성공\n");

  // ── 1. 사용자가 지정한 TR: FHKST12010100 ─────────────────────────────────
  // ETF PDF (Portfolio Disclosure File) 조회 — 여러 엔드포인트 시도
  const etfEndpoints = [
    ["/uapi/domestic-stock/v1/quotations/inquire-daily-price",         { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE, fid_period_div_code: "D", fid_org_adj_prc: "0" }],
    ["/uapi/domestic-stock/v1/quotations/inquire-price",               { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE }],
    ["/uapi/etfetn/v1/quotations/inquire-etf-daily-price",             { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE, fid_period_div_code: "D" }],
    ["/uapi/etfetn/v1/quotations/inquire-etf-component",               { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE }],
    ["/uapi/etfetn/v1/quotations/inquire-member",                      { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE }],
    ["/uapi/etfetn/v1/quotations/inquire-etf-portfolio",               { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE }],
    ["/uapi/domestic-stock/v1/quotations/etf-portfolio",               { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE }],
  ];

  console.log("=== 1. FHKST12010100 (사용자 지정 TR) — 엔드포인트 전수 조사 ===");
  for (const [path, params] of etfEndpoints) {
    await kisGet(token, path, params, "FHKST12010100",
      `FHKST12010100 @ ${path.split("/").pop()}`);
  }

  // ── 2. ETF 관련 가능한 TR ID 전수 시도 ───────────────────────────────────
  console.log("\n\n=== 2. ETF TR ID 전수 시도 — 가장 유력한 엔드포인트 고정 ===");
  const trCandidates = [
    "FHKST12010100", // 사용자 지정
    "FHKST11130200", // ETF/ETN 기간별
    "FHKST11130000", // 변형
    "FHPST12010000", // 변형
    "FHKST01010100", // 현재가 (기준점 — 정상 작동 확인용)
    "FHKST01020100", // ETF 변형 후보
    "FHKST01020200", // 변형
    "FHKST11130100", // 변형
    "FHKST11130300", // 변형
    "FHKST12020100", // 변형
  ];

  for (const trId of trCandidates) {
    await kisGet(token,
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE },
      trId,
      trId,
    );
  }

  // ── 3. ETF 전용 path 체계적 탐색 ─────────────────────────────────────────
  console.log("\n\n=== 3. /uapi/etfetn/ 하위 엔드포인트 탐색 ===");
  const etfSubPaths = [
    "inquire-price",
    "inquire-daily-price",
    "inquire-etf-daily-price",
    "inquire-etf-component",
    "inquire-etf-pdf",
    "inquire-member",
    "inquire-etf-portfolio",
    "inquire-etf-constituent",
    "inquire-nav",
  ];

  for (const sub of etfSubPaths) {
    await kisGet(token,
      `/uapi/etfetn/v1/quotations/${sub}`,
      { fid_cond_mrkt_div_code: "J", fid_input_iscd: ETF_CODE },
      "FHKST12010100",
      `/etfetn/${sub}`,
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
