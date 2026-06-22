/**
 * test-krx-alt4.mjs
 * 라운드 4:
 *  A. KODEX SPA HTML에서 실제 백엔드 API URL 추출
 *  B. KRX HTML 페이지에서 CSRF 토큰/bld 파라미터 탐색
 *  C. FnGuide / WiseFN 등 제3자 소스
 *  D. 직접 네트워크로 확인 불가한 소스 정리
 *
 * 실행: node scripts/test-krx-alt4.mjs
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const CODE = "091160";

async function fetchText(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, redirect: "follow" });
    const buf = await res.arrayBuffer();
    let text;
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { text = new TextDecoder().decode(buf); }
    return { ok: res.ok, status: res.status, text, headers: res.headers };
  } catch (e) { return { ok: false, status: 0, text: "", error: e.message }; }
}

function extractApiHints(html) {
  const hints = [];
  // API base URL 패턴
  const patterns = [
    /apiBase['":\s]+(["'])([^'"]+)\1/gi,
    /API_URL['":\s]+(["'])([^'"]+)\1/gi,
    /"baseURL":\s*(["'])([^'"]+)\1/gi,
    /axios\.defaults\.baseURL\s*=\s*(["'])([^'"]+)\1/gi,
    /fetch\(["']([^"']+api[^"']+)["']/gi,
    /["'](https:\/\/[a-z0-9.]+\.[a-z]{2,}\/api[^"']{0,80})["']/gi,
    /["'](https:\/\/api\.[a-z0-9.-]+[^"']{0,80})["']/gi,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(html)) !== null) {
      const url = m[2] || m[1];
      if (url && !hints.includes(url)) hints.push(url);
      if (hints.length >= 20) break;
    }
  }
  return hints;
}

async function main() {
  console.log("=== 라운드 4: KODEX SPA 백엔드 API + KRX 토큰 탐색 ===\n");

  // A. KODEX SPA HTML에서 JS 번들 URL 추출 → 번들에서 API host 탐색
  console.log("[A] KODEX SPA HTML 분석...");
  const kodex = await fetchText(`https://www.kodex.com/etf/${CODE}`, {
    headers: { "user-agent": UA, "Referer": "https://www.kodex.com" },
  });
  if (kodex.ok) {
    // JS 번들 파일 URL 찾기
    const scripts = [...kodex.text.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
    console.log(`  SPA JS 번들: ${scripts.slice(0, 4).join(", ")}\n`);

    // HTML에서 직접 API hint 탐색
    const hints = extractApiHints(kodex.text);
    if (hints.length > 0) {
      console.log(`  API hints in HTML: ${hints.join(", ")}\n`);
    } else {
      console.log("  HTML에서 API URL 직접 탐색 실패 (번들 분리됨)\n");
    }

    // JS 번들 중 첫 번째에서 API 주소 탐색
    const firstBundle = scripts.find(s => s.includes("chunk") || s.includes("main") || s.includes("app"));
    if (firstBundle) {
      const bundleUrl = firstBundle.startsWith("http") ? firstBundle : `https://www.kodex.com${firstBundle}`;
      console.log(`  [JS 번들 탐색] ${bundleUrl.slice(0, 80)}...`);
      const bundle = await fetchText(bundleUrl, { headers: { "user-agent": UA } });
      if (bundle.ok) {
        const bundleHints = extractApiHints(bundle.text);
        console.log(`  번들 API hints: ${bundleHints.slice(0, 6).join("\n              ")}\n`);

        // 더 넓은 패턴으로 도메인 탐색
        const domains = [...bundle.text.matchAll(/["'](https?:\/\/[a-zA-Z0-9.-]+)["']/g)]
          .map(m => m[1])
          .filter(d => d.includes("samsung") || d.includes("kodex") || d.includes("samsungfund"))
          .filter((d, i, arr) => arr.indexOf(d) === i)
          .slice(0, 10);
        console.log(`  Samsung 관련 도메인: ${domains.join(", ")}\n`);
      }
    }
  }

  // B. KRX 데이터 페이지 HTML에서 bld/CSRF 탐색
  console.log("[B] KRX MDCSTAT04602 페이지 HTML 분석...");
  const krx = await fetchText(
    "https://data.krx.co.kr/contents/MDC/STAT/standard/MDCSTAT04602.cmd",
    { headers: { "user-agent": UA, "Referer": "https://data.krx.co.kr" } },
  );
  if (krx.ok) {
    const html = krx.text;
    // bld, csrf, token 패턴
    const bldMatches = [...html.matchAll(/bld['":\s]+["']([^'"]{10,60})["']/g)].map(m => m[1]);
    const tokenMatches = [...html.matchAll(/(?:csrf|token|_token)['":\s]+["']([^'"]{8,60})["']/gi)].map(m => m[1]);
    console.log(`  bld 값들: ${bldMatches.slice(0, 5).join(", ") || "없음"}`);
    console.log(`  토큰류: ${tokenMatches.slice(0, 3).join(", ") || "없음"}`);
    const cookie = krx.headers.get("set-cookie") ?? "";
    console.log(`  set-cookie: ${cookie.slice(0, 150)}`);
    console.log(`  HTML 200자: ${html.replace(/\s+/g, " ").slice(0, 200)}\n`);
  } else {
    console.log(`  실패 HTTP ${krx.status}: ${krx.error ?? ""}\n`);
  }

  // C. FnGuide 공개 ETF 데이터
  console.log("[C] FnGuide/WiseFN 탐색...");
  const candidates = [
    ["FnGuide ETF", `https://comp.fnguide.com/SVO2/ASP/SVD_etfmain.asp?pGB=1&gicode=A${CODE}`],
    ["WiseFN ETF", `https://www.wisefn.net/etf/etfMain.do?cmpCd=${CODE}`],
    ["Infostock ETF", `https://www.infostock.co.kr/site/etf/etf_info.asp?Stkcode=${CODE}`],
  ];
  for (const [label, url] of candidates) {
    const r = await fetchText(url, { headers: { "user-agent": UA } });
    const hasData = r.text.includes("편입비율") || r.text.includes("구성종목") || r.text.includes("COMPST");
    console.log(`  [${label}] HTTP ${r.status}  구성종목 데이터: ${hasData ? "✅ 있음" : "❌ 없음"}  ${r.error ?? ""}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
