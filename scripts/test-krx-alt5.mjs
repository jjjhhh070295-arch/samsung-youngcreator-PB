/**
 * test-krx-alt5.mjs
 * 최종 탐색:
 *  A. KRX CSV 다운로드 2단계 (OTP → download)
 *  B. etfcheck.co.kr (한국 ETF 분석 사이트)
 *  C. KOSCOM 공공 API
 *  D. Samsung funds 모바일/앱 API 패턴
 *  E. KODEX 사이트 스크립트 번들에서 API 추출 (module 태그 등)
 *
 * 실행: node scripts/test-krx-alt5.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160";

async function tryFetch(label, url, opts = {}) {
  process.stdout.write(`[${label}] ... `);
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    const isJson = text.trim().startsWith("{") || text.trim().startsWith("[");
    const hasData = text.includes("편입비율") || text.includes("ISU_CD") || text.includes("COMPST") ||
                    text.includes("holding") || text.includes("portfolio") || text.includes("weight");
    const preview = text.replace(/\s+/g, " ").slice(0, 300);
    console.log(`HTTP ${res.status}  (${buf.byteLength}b)  JSON=${isJson}  ETF데이터=${hasData}`);
    if (isJson || hasData) console.log(`  ${preview}`);
    console.log();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.log(`ERROR: ${e.message}\n`);
    return { ok: false, text: "" };
  }
}

async function main() {
  console.log("=== 최종 탐색 ===\n");

  // A. KRX CSV OTP 다운로드 방식
  console.log("[A] KRX CSV 다운로드 (OTP 방식)");
  const krxOtpBody = new URLSearchParams({
    bld: "dbms/MDC/STAT/standard/MDCSTAT04602",
    name: "download",
    filePath: "/tmp/",
    fileName: "ETF_구성종목.csv",
    isuCd: `KR7${CODE}003`,
    trdDd: new Date().toISOString().slice(0,10).replace(/-/g,""),
    share: "1", money: "1",
  });
  const otpRes = await fetch("https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": "https://data.krx.co.kr",
      "User-Agent": UA,
    },
    body: krxOtpBody.toString(),
  });
  const otp = await otpRes.text();
  console.log(`  OTP 응답: HTTP ${otpRes.status}  "${otp.slice(0,100)}"\n`);

  // B. etfcheck.co.kr
  await tryFetch("etfcheck portfolio",
    `https://www.etfcheck.co.kr/etf/home/${CODE}`,
    { headers: { "user-agent": UA } });

  await tryFetch("etfcheck API",
    `https://www.etfcheck.co.kr/api/etf/${CODE}/holding`,
    { headers: { "user-agent": UA, "Referer": "https://www.etfcheck.co.kr" } });

  // C. KOSCOM API (공공 API)
  await tryFetch("KOSCOM etf holding",
    `https://api.koscom.co.kr/v1/market/etf/${CODE}/holding`,
    { headers: { "user-agent": UA } });

  // D. Samsung funds 모바일 앱 API (앱 트래픽 패턴)
  const samMobileUrls = [
    `https://m.samsungfunds.com/api/etf/portfolio?code=${CODE}`,
    `https://m.kodex.com/api/v1/etf/${CODE}/portfolio`,
    `https://www.kodex.com/_next/data/latest/etf/${CODE}/portfolio.json`,
  ];
  for (const url of samMobileUrls) {
    await tryFetch("SAM mobile", url, { headers: { "user-agent": UA, "Referer": "https://www.kodex.com" } });
  }

  // E. KODEX 전체 HTML에서 <script type="module"> 패턴
  console.log("[E] KODEX HTML module script 탐색...");
  const r = await fetch(`https://www.kodex.com/etf/${CODE}`, {
    headers: { "user-agent": UA },
  });
  const html = await r.text();
  // module 스크립트
  const modules = [...html.matchAll(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  console.log(`  모든 script src: ${modules.join(" | ").slice(0, 400)}`);
  // inline JSON/config
  const jsonBlocks = [...html.matchAll(/window\.__([A-Z_]+)__\s*=\s*({[^;]{0,500}})/g)].map(m => `${m[1]}: ${m[2].slice(0,100)}`);
  console.log(`  window config: ${jsonBlocks.join(", ") || "없음"}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
