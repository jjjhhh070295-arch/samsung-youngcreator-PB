/**
 * test-krx-final.mjs
 * A. KRX OTP → CSV 다운로드 (구성종목 확인)
 * B. KODEX JS 번들에서 실제 API 엔드포인트 추출
 *
 * 실행: node scripts/test-krx-final.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160"; // KODEX 반도체

function todayKrx() {
  const d = new Date();
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() - 2);
  if (dow === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// ── A. KRX OTP + CSV 다운로드 ────────────────────────────────────────────
async function tryKrxCsv(bld, isuCd, trdDd) {
  // Step 1: OTP 발급
  const otpBody = new URLSearchParams({
    bld,
    name: "download",
    filePath: "/tmp/",
    fileName: `ETF_${isuCd}.csv`,
    isuCd,
    trdDd,
    share: "1",
    money: "1",
    csvxls_isNo: "false",
  });

  const otpRes = await fetch("https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": "https://data.krx.co.kr",
      "User-Agent": UA,
    },
    body: otpBody.toString(),
  });
  const otp = (await otpRes.text()).trim();
  console.log(`  OTP: HTTP ${otpRes.status}  token=${otp.slice(0, 40)}...`);

  if (!otp || otp.includes("<") || otp.toUpperCase().includes("LOGOUT")) {
    console.log("  OTP 실패\n");
    return null;
  }

  // Step 2: OTP로 CSV 다운로드
  const dlRes = await fetch("https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Referer": "https://data.krx.co.kr",
      "User-Agent": UA,
    },
    body: new URLSearchParams({ code: otp }).toString(),
  });

  const buf = await dlRes.arrayBuffer();
  let csv;
  try { csv = new TextDecoder("euc-kr").decode(buf); }
  catch { csv = new TextDecoder().decode(buf); }

  console.log(`  CSV: HTTP ${dlRes.status}  (${buf.byteLength}bytes)`);
  console.log(`  내용 (처음 600자):\n${csv.slice(0, 600)}\n`);
  return csv;
}

// ── B. KODEX JS 번들에서 API 추출 ────────────────────────────────────────
async function analyzeBundle() {
  console.log("[B] KODEX index.js 번들 분석...");
  const res = await fetch(`https://www.kodex.com/assets/js/index.js?v=20260619070656`, {
    headers: { "user-agent": UA, "Referer": "https://www.kodex.com" },
  });
  const text = await res.text();
  console.log(`  번들 크기: ${text.length.toLocaleString()} chars`);

  // API 관련 URL/path 탐색
  const patterns = [
    /["'](\/api\/v\d[^"']{0,80})["']/g,
    /["'](https?:\/\/[^"']*api[^"']{0,100})["']/g,
    /baseURL\s*[:=]\s*["']([^"']+)["']/g,
    /axios[^(]*\(["']([^"']{5,80})["']/g,
    /fetch\(["']([^"']{5,100})["']/g,
  ];

  const found = new Set();
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) {
      const s = (m[1] || m[2] || "").trim();
      if (s.length > 5 && s.length < 100 && !s.includes("\\n") && !s.includes(".jpg") && !s.includes(".png")) {
        found.add(s);
      }
    }
  }

  const apiPaths = [...found].filter(s =>
    s.includes("etf") || s.includes("fund") || s.includes("portfolio") ||
    s.includes("holding") || s.includes("product") || s.includes("pcf")
  ).slice(0, 20);

  console.log(`  ETF 관련 API 경로 (${apiPaths.length}개):`);
  apiPaths.forEach(p => console.log(`    ${p}`));

  // 전체 중 고유 도메인 추출
  const domains = [...new Set(
    [...text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)].map(m => m[1])
    .filter(d => d.includes("samsung") || d.includes("kodex") || d.includes("samsungfund"))
  )];
  console.log(`\n  Samsung 관련 도메인: ${domains.join(", ")}`);

  return { apiPaths, text };
}

async function main() {
  console.log("=== KRX OTP CSV + KODEX 번들 분석 ===\n");
  const trdDd = todayKrx();
  console.log(`조회일: ${trdDd}\n`);

  // A. KRX OTP CSV 다운로드 — bld 후보들 모두 시도
  console.log("[A] KRX OTP → CSV 다운로드");
  const bldCandidates = [
    "dbms/MDC/STAT/standard/MDCSTAT04601",
    "dbms/MDC/STAT/standard/MDCSTAT04602",
  ];
  let csvData = null;
  for (const bld of bldCandidates) {
    console.log(`\n  [bld=${bld.split("/").pop()}]`);
    csvData = await tryKrxCsv(bld, `KR7${CODE}003`, trdDd);
    if (csvData && !csvData.includes("LOGOUT") && csvData.length > 100) break;
  }

  // B. KODEX 번들 분석
  console.log("\n");
  const { apiPaths, text: bundle } = await analyzeBundle();

  // C. 발견된 API 경로 실제 호출 테스트
  if (apiPaths.length > 0) {
    console.log("\n[C] 발견된 API 경로 실제 테스트...");
    for (const path of apiPaths.slice(0, 5)) {
      const url = path.startsWith("http") ? path : `https://www.kodex.com${path}`;
      try {
        const r = await fetch(url.replace("{CODE}", CODE).replace(":code", CODE),
          { headers: { "user-agent": UA, "Referer": "https://www.kodex.com" } });
        const t = await r.text();
        const isData = t.includes("holding") || t.includes("portf") || t.includes("종목") || t.trim().startsWith("{");
        console.log(`  ${path} → HTTP ${r.status}  데이터=${isData}  ${t.slice(0,80)}`);
      } catch (e) {
        console.log(`  ${path} → ERROR: ${e.message}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
