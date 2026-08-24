/**
 * test-krx-alt7.mjs — 최종 결론 도출
 * A. samsungfund.com HTML에서 신규 API 경로 추출
 * B. KIS 업종코드 전체 탐색 (SK하이닉스 포함 5종목)
 *
 * 실행: node scripts/test-krx-alt7.mjs
 */
import { readFileSync } from "fs";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.+)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

async function main() {
  console.log("=== 최종 결론 도출 ===\n");

  // A. samsungfund.com JS에서 API 경로 추출
  console.log("[A] samsungfund.com 신규 API 경로 탐색...");
  const mainRes = await fetch("https://www.samsungfund.com", { headers: { "user-agent": UA } });
  const mainHtml = await mainRes.text();

  // script src 추출
  const scripts = [...mainHtml.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
  console.log(`  JS 파일: ${scripts.slice(0,5).join(", ")}`);

  // 인라인 API 힌트
  const apiHints = [...mainHtml.matchAll(/["'](\/api\/[^"']{5,60})["']/g)].map(m => m[1]);
  console.log(`  인라인 API 힌트: ${apiHints.slice(0,8).join(", ") || "없음"}\n`);

  // JS 번들 분석
  for (const src of scripts.slice(0,3)) {
    const url = src.startsWith("http") ? src : `https://www.samsungfund.com${src}`;
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      const text = await r.text();
      // ETF/portfolio 관련 API 경로만 추출
      const paths = [...new Set([
        ...[...text.matchAll(/["'](\/v\d\/[^"']{5,80})["']/g)].map(m => m[1]),
        ...[...text.matchAll(/["'](\/api\/[^"']{5,80})["']/g)].map(m => m[1]),
        ...[...text.matchAll(/["'](https?:\/\/[a-zA-Z0-9.-]+\/[^"']{5,80})["']/g)].map(m => m[1]),
      ])].filter(p =>
        p.includes("etf") || p.includes("fund") || p.includes("portf") ||
        p.includes("holding") || p.includes("product")
      ).slice(0, 10);

      if (paths.length > 0) {
        console.log(`  [${src.split("/").pop().slice(0,30)}] ETF API:\n    ${paths.join("\n    ")}`);
      }
    } catch {}
  }

  // B. KIS 업종코드 — SK하이닉스 포함 5종목 전체 bstp 필드 확인
  console.log("\n[B] KIS 업종코드 5종목 상세 탐색\n");
  const appKey    = env.KIS_APP_KEY;
  const appSecret = env.KIS_APP_SECRET;
  if (!appKey || !appSecret) { console.log("  KIS 키 없음\n"); return; }

  const tokenRes = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: appKey, appsecret: appSecret }),
  });
  const token = (await tokenRes.json()).access_token;
  if (!token) { console.log("  토큰 실패"); return; }

  // 삼성전자, SK하이닉스, LG에너지솔루션, 셀트리온, 현대차, KB금융, POSCO홀딩스
  const TEST_TICKERS = [
    ["005930", "삼성전자"],
    ["000660", "SK하이닉스"],
    ["373220", "LG에너지솔루션"],
    ["068270", "셀트리온"],
    ["005380", "현대차"],
    ["105560", "KB금융"],
    ["005490", "POSCO홀딩스"],
  ];

  for (const [ticker, name] of TEST_TICKERS) {
    const r = await fetch(
      `https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=${ticker}`,
      { headers: { authorization: `Bearer ${token}`, appkey: appKey, appsecret: appSecret, tr_id: "FHKST01010100" } },
    );
    const json = await r.json();
    const o = json?.output ?? {};
    // 업종 관련 모든 필드
    const bstp = Object.entries(o)
      .filter(([k]) => k.startsWith("bstp"))
      .reduce((acc, [k,v]) => { acc[k] = v; return acc; }, {});
    const industryName = bstp.bstp_kor_isnm ?? bstp.bstp_cls_code ?? "(없음)";
    const cls = bstp.bstp_cls_code ?? "-";
    console.log(`  ${name.padEnd(12)} (${ticker})  업종: "${industryName}"  업종코드: ${cls}`);
  }

  console.log("\n── 요약 ──");
  console.log("bstp_kor_isnm: KIS가 반환하는 업종명. ETF 구성종목 없이도 섹터 분류 가능여부 판단 기준.");
}

main().catch(e => { console.error(e); process.exit(1); });
