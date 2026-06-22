/**
 * test-krx-etf.mjs
 * KRX ETF 구성종목 실제 fetch 테스트
 *
 * 사용 방법:
 *   node scripts/test-krx-etf.mjs                          # 자동 세션만
 *   KRX_COOKIE="JSESSIONID=xxx; __smVisitorID=yyy" node scripts/test-krx-etf.mjs
 *
 * 실행: node scripts/test-krx-etf.mjs
 */

const KRX_URL  = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KRX_HOME = "https://data.krx.co.kr";
const KRX_PAGE = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MKD13020101";
const BLD      = "dbms/MDC/STAT/standard/MDCSTAT05001";
const REFERER  = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MKD13020101";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// 사용자가 제공한 쿠키 (env로 주입)
const INJECTED_COOKIE = process.env.KRX_COOKIE ?? "";

const ETF_LIST = [
  ["091160", "KR7091160002", "KODEX 반도체"],
  ["305720", "KR7305720002", "KODEX 2차전지산업"],
  ["244580", "KR7244580002", "KODEX 바이오"],
  ["139270", "KR7139270002", "KODEX 은행"],
  ["266360", "KR7266360002", "KODEX IT"],
  ["091180", "KR7091180002", "KODEX 자동차"],
  ["117460", "KR7117460002", "KODEX 에너지화학"],
  ["117680", "KR7117680002", "KODEX 철강"],
];

function recentTradingDay() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const offset = day === 0 ? 2 : day === 6 ? 1 : 0;
  kst.setUTCDate(kst.getUTCDate() - offset);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
}

function extractCookies(headers) {
  const jar = {};
  for (const [k, v] of headers.entries()) {
    if (k.toLowerCase() === "set-cookie") {
      const name = v.split("=")[0].trim();
      const val  = v.split("=")[1]?.split(";")[0]?.trim() ?? "";
      jar[name] = val;
    }
  }
  return jar;
}

function jarToStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function buildAutoSession() {
  const jar = {};
  for (const url of [KRX_HOME, KRX_PAGE]) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":      UA,
          "Accept":          "text/html,*/*",
          "Accept-Language": "ko-KR,ko;q=0.9",
          ...(Object.keys(jar).length ? { "Cookie": jarToStr(jar) } : {}),
        },
        redirect: "follow",
      });
      Object.assign(jar, extractCookies(res.headers));
      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }
  return jar;
}

async function fetchEtf(isin, trdDd, cookieStr = "") {
  const body = new URLSearchParams({
    bld:         BLD, locale: "ko_KR",
    isuCd:       isin, isuCd2: isin,
    trdDd,       share: "1", money: "1", csvxls_isNo: "false",
  });

  const t0  = Date.now();
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type":     "application/x-www-form-urlencoded",
      "Referer":          REFERER,
      "Origin":           "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent":       UA,
      "Accept":           "application/json, text/javascript, */*; q=0.01",
      "Accept-Language":  "ko-KR,ko;q=0.9",
      ...(cookieStr ? { "Cookie": cookieStr } : {}),
    },
    body: body.toString(),
    redirect: "follow",
  });
  const ms  = Date.now() - t0;
  const buf = await res.arrayBuffer();
  let text;
  try { text = new TextDecoder("euc-kr").decode(buf); }
  catch { text = new TextDecoder().decode(buf); }
  return { status: res.status, ms, text, byteLen: buf.byteLength };
}

function parse(text) {
  if (!text?.trim())                                         return { kind: "empty" };
  if (text.trim().toUpperCase().includes("LOGOUT"))          return { kind: "logout" };
  if (!text.trim().startsWith("{") && !text.trim().startsWith("["))
    return { kind: "html", preview: text.slice(0, 200) };
  try {
    const j     = JSON.parse(text);
    const items = j?.OutBlock_1 ?? j?.output ?? j?.data ?? [];
    if (Array.isArray(items) && items.length > 0)
      return { kind: "ok", count: items.length, fields: Object.keys(items[0]), sample: items[0] };
    return { kind: "ok_empty", raw: JSON.stringify(j).slice(0, 300) };
  } catch (e) {
    return { kind: "parse_err", msg: e.message, preview: text.slice(0, 200) };
  }
}

async function runAll(cookieStr, trdDd) {
  const results = [];
  for (const [ticker, isin, label] of ETF_LIST) {
    process.stdout.write(`  ${label.padEnd(18)} (${isin}) → `);
    try {
      const r = await fetchEtf(isin, trdDd, cookieStr);
      const p = parse(r.text);
      if (p.kind === "ok") {
        const wF = p.fields.find(f => /COMPST|COMP_RT/i.test(f)) ?? p.fields.find(f => /_RT$/i.test(f)) ?? "?";
        const cF = p.fields.find(f => /ISU_CD/i.test(f)) ?? "?";
        const nF = p.fields.find(f => /ABBRV/i.test(f)) ?? "?";
        console.log(`✅ ${p.count}개  [code:${cF}  name:${nF}  weight:${wF}]`);
        results.push({ ticker, label, count: p.count, fields: p.fields, sample: p.sample });
      } else {
        console.log(`❌ ${p.kind}`);
        results.push({ ticker, label, count: 0, error: p.kind });
      }
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ ticker, label, count: 0, error: e.message });
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return results;
}

function printSummary(results, cookieSource) {
  const ok = results.filter(r => r.count > 0);
  console.log(`\n── 최종 요약 (쿠키: ${cookieSource}) ──`);
  console.log(`성공: ${ok.length}/8`);
  for (const r of results)
    console.log(`  ${r.count > 0 ? "✅" : "❌"}  ${r.label.padEnd(18)}  ${r.count > 0 ? r.count + "개" : r.error}`);
  if (ok.length > 0) {
    console.log(`\n── 응답 필드 (${ok[0].label}) ──\n  ${ok[0].fields.join(", ")}`);
    console.log(`\n── 첫 샘플 ──`);
    console.log(JSON.stringify(ok[0].sample, null, 2));
  }
}

async function tryCookie(label, cookieStr, trdDd) {
  console.log(`\n[${label}]`);
  console.log(`  쿠키: ${cookieStr.slice(0, 80)}${cookieStr.length > 80 ? "..." : ""}`);
  const r = await fetchEtf("KR7091160002", trdDd, cookieStr);
  const p = parse(r.text);
  console.log(`  HTTP ${r.status}  ${r.ms}ms  ${r.byteLen}b  → ${p.kind}`);
  if (p.kind === "ok") {
    console.log(`  ✅ 성공! ${p.count}개`);
  } else {
    console.log(`  원문: ${r.text.slice(0, 100)}`);
  }
  return p.kind === "ok";
}

async function main() {
  const trdDd = recentTradingDay();
  console.log(`=== KRX ETF 구성종목 fetch 테스트 ===`);
  console.log(`조회일(trdDd): ${trdDd}  BLD: ${BLD}`);
  console.log(`KRX_COOKIE: ${INJECTED_COOKIE ? "주입됨 (" + INJECTED_COOKIE.slice(0, 40) + "...)" : "없음"}\n`);

  // ── 1. 쿠키 없이 ──────────────────────────────────────────────
  await tryCookie("Step 1: 쿠키 없이", "", trdDd);

  // ── 2. 자동 세션 warm-up ──────────────────────────────────────
  console.log(`\n[Step 2: 자동 세션 warm-up]`);
  process.stdout.write("  홈 + ETF 페이지 순차 GET... ");
  const jar = await buildAutoSession();
  const autoStr = jarToStr(jar);
  console.log(`완료  쿠키: ${autoStr.slice(0, 60)}`);
  const step2ok = await tryCookie("Step 2a: 자동 warm-up 세션", autoStr, trdDd);

  // ── 3. 사용자 제공 쿠키 (있으면) ──────────────────────────────
  let finalOk = step2ok;
  let finalCookie = autoStr;
  let cookieSource = "자동 warm-up";

  if (INJECTED_COOKIE) {
    const step3ok = await tryCookie("Step 3: 사용자 제공 쿠키(KRX_COOKIE)", INJECTED_COOKIE, trdDd);
    if (step3ok) { finalOk = true; finalCookie = INJECTED_COOKIE; cookieSource = "사용자 제공 쿠키"; }
  }

  // ── 4. 성공 시 8개 전체 ───────────────────────────────────────
  if (finalOk) {
    console.log(`\n── Step 4: 8개 ETF 전체 조회 ──\n`);
    const results = await runAll(finalCookie, trdDd);
    printSummary(results, cookieSource);
  } else {
    console.log(`\n══════════════════════════════════════`);
    console.log(`[ 결론 ]`);
    console.log(`- 자동 세션(Node.js 발급): LOGOUT — IP/세션 바인딩으로 거부`);
    console.log(`- 완전 자동화: 불가`);
    console.log(``);
    console.log(`[ 브라우저 쿠키 직접 테스트 방법 ]`);
    console.log(`1. Chrome에서 https://data.krx.co.kr ETF 구성종목 조회`);
    console.log(`2. DevTools (F12) > Network > getJsonData.cmd 클릭`);
    console.log(`3. Headers > Request Headers > Cookie 값 복사`);
    console.log(`4. 아래 명령어 실행:`);
    console.log(`   KRX_COOKIE="붙여넣은쿠키값" node scripts/test-krx-etf.mjs`);
    console.log(``);
    console.log(`→ 같은 브라우저 세션(같은 IP)에서 실행하면 성공 예상`);
    console.log(`→ 성공하면 8개 ETF 구성종목 전부 받아 scripts/etf-constituents.json으로 저장 가능`);
    console.log(`══════════════════════════════════════`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
