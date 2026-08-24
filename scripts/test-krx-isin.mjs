/**
 * test-krx-isin.mjs
 * KRX ETF 전종목 목록에서 ISIN 한 번에 추출
 * 빠르게 실행 (세션 TTL 3~5분)
 *
 * $env:KRX_COOKIE="..."; node scripts/test-krx-isin.mjs
 */

const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201020101";
const UA      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE  = process.env.KRX_COOKIE ?? "";

// 찾고 싶은 8개 ETF 단축코드
const TARGETS = new Set(["091160","305720","244580","139270","266360","091180","117460","117680"]);

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

async function post(bld, extraBody = {}) {
  const body = new URLSearchParams({
    bld,
    locale:      "ko_KR",
    mktTp:       "ETF",        // ETF 전종목 필터
    trdDd:       "20260620",
    csvxls_isNo: "false",
    ...extraBody,
  });

  const t0 = Date.now();
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
      "Cookie":           COOKIE,
    },
    body: body.toString(),
    redirect: "follow",
  });
  const ms  = Date.now() - t0;
  const buf = await res.arrayBuffer();
  let text;
  try { text = new TextDecoder("euc-kr").decode(buf); }
  catch { text = new TextDecoder().decode(buf); }
  return { status: res.status, ms, text };
}

function tryParse(text) {
  if (!text?.trim())                               return { kind: "empty" };
  if (text.trim().toUpperCase() === "LOGOUT")      return { kind: "logout" };
  if (!text.trim().startsWith("{") && !text.trim().startsWith("["))
    return { kind: "html" };
  try {
    const j = JSON.parse(text);
    // 가능한 배열 키들
    const arr = j?.OutBlock_1 ?? j?.output ?? j?.block1 ?? j?.data ?? [];
    if (Array.isArray(arr) && arr.length > 0)
      return { kind: "ok", count: arr.length, fields: Object.keys(arr[0]), items: arr };
    // 빈 배열이지만 JSON 자체는 파싱됨
    const keys = Object.keys(j);
    return { kind: "ok_empty", keys, raw: JSON.stringify(j).slice(0, 150) };
  } catch (e) {
    return { kind: "parse_err", preview: text.slice(0, 150) };
  }
}

function printResult(label, bld, r, p) {
  process.stdout.write(`[${label}]\n  bld: ${bld}\n  HTTP ${r.status}  ${r.ms}ms  → `);
  if (p.kind === "ok") {
    // ISU_CD(ISIN), ISU_SRT_CD(단축코드), ISU_ABBRV(종목명) 있는지
    const hasIsin = p.fields.some(f => f === "ISU_CD");
    const hasSrt  = p.fields.some(f => f === "ISU_SRT_CD");
    const hasAbbrv= p.fields.some(f => f === "ISU_ABBRV" || f === "ISU_NM");
    console.log(`✅ ${p.count}개  fields: ${p.fields.join(", ")}`);
    console.log(`  ISIN(ISU_CD)=${hasIsin}  단축코드(ISU_SRT_CD)=${hasSrt}  이름=${hasAbbrv}`);

    // 타깃 ETF 찾기
    const srtField  = p.fields.find(f => f === "ISU_SRT_CD") ?? p.fields.find(f => f.includes("SRT"));
    const isinField = p.fields.find(f => f === "ISU_CD")     ?? p.fields.find(f => f === "ISIN");

    if (srtField && isinField) {
      const found = p.items.filter(item => TARGETS.has(String(item[srtField]).trim()));
      if (found.length > 0) {
        console.log(`\n  🎯 타깃 ETF ${found.length}개 발견:`);
        for (const item of found)
          console.log(`    ${String(item[srtField]).padEnd(8)}  ${item[isinField]}  ${item["ISU_ABBRV"] ?? item["ISU_NM"] ?? ""}`);
      } else {
        console.log(`  타깃 ETF 없음 (srtField=${srtField}, 첫 항목: ${JSON.stringify(p.items[0]).slice(0, 100)})`);
      }
    } else {
      console.log(`  ISIN/단축코드 필드 없음, 첫 항목: ${JSON.stringify(p.items[0]).slice(0, 200)}`);
    }
  } else if (p.kind === "ok_empty") {
    console.log(`empty JSON  keys: ${p.keys?.join(",")}  ${p.raw}`);
  } else {
    console.log(`${p.kind}  ${p.preview ?? ""}`);
  }
  console.log();
}

async function main() {
  console.log("=== KRX ETF ISIN 전종목 조회 ===");
  console.log(`Cookie: ${COOKIE.slice(0, 50)}...\n`);

  // ── 후보 BLD 목록 ──────────────────────────────────────────────
  // MDCSTAT04601: ETF 전종목 기본정보 (ETF 전종목 시세 메뉴)
  // MDCSTAT04001: ETF 기본정보
  // MDCSTAT04801: ETF 시가총액/거래량
  // finderETFStkInfo: finder 검색 API
  // MDCSTAT04501: 또 다른 후보

  const candidates = [
    // [bld, extraBody, label]
    ["dbms/MDC/STAT/standard/MDCSTAT04601", {}, "MDCSTAT04601 (ETF전종목시세)"],
    ["dbms/MDC/STAT/standard/MDCSTAT04001", {}, "MDCSTAT04001 (ETF기본정보)"],
    ["dbms/MDC/STAT/standard/MDCSTAT04801", {}, "MDCSTAT04801"],
    ["dbms/MDC/STAT/standard/MDCSTAT04501", {}, "MDCSTAT04501"],
    ["dbms/MDC/STAT/standard/MDCSTAT04701", {}, "MDCSTAT04701"],
    ["dbms/MDC/STAT/standard/MDCSTAT04901", {}, "MDCSTAT04901"],
    // finder API — 단축코드로 ISIN 바로 조회
    ["dbms/comm/finder/finderETFStkInfo",
      { searchText: "", typeCode: "E" }, "finder/finderETFStkInfo"],
    ["dbms/comm/finder/finderStkInfo",
      { searchText: "", brdId: "" }, "finder/finderStkInfo"],
    // trdDd 없이 순수 기본정보
    ["dbms/MDC/STAT/standard/MDCSTAT04601",
      { trdDd: "", mktTp: "ETF" }, "MDCSTAT04601 (trdDd 없이)"],
  ];

  for (const [bld, extra, label] of candidates) {
    const r = await post(bld, extra);
    const p = tryParse(r.text);
    printResult(label, bld, r, p);

    // LOGOUT이면 즉시 중단
    if (p.kind === "logout") {
      console.log("⚠️ 세션 만료 — 나머지 생략");
      break;
    }

    // 타깃 ETF 전부 찾으면 즉시 종료
    if (p.kind === "ok") {
      const srtField = p.fields.find(f => f === "ISU_SRT_CD");
      if (srtField) {
        const found = p.items.filter(i => TARGETS.has(String(i[srtField]).trim()));
        if (found.length === 8) {
          console.log("✅ 8개 전부 발견! 나머지 BLD 생략");
          break;
        }
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
