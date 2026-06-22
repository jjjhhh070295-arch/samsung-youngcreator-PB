/**
 * test-krx-etf.mjs
 * KRX ETF 구성종목 fetch
 * Step 1: MDCSTAT04601 → 전종목 ISIN 맵
 * Step 2: MDCSTAT05001 × 8 → 구성종목
 * Step 3: scripts/etf-constituents.json 저장
 *
 * $env:KRX_COOKIE="..."; node scripts/test-krx-etf.mjs
 */
import { writeFileSync } from "fs";

const KRX_URL  = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const REFERER  = "https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd?menuId=MDC0201030105";
const UA       = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const COOKIE   = process.env.KRX_COOKIE ?? "";
const TRD_DD   = "20260622";

// 8개 타깃 섹터 ETF 단축코드
const ETF_TARGETS = [
  ["091160", "KODEX 반도체"],
  ["305720", "KODEX 2차전지산업"],
  ["244580", "KODEX 바이오"],
  ["139270", "KODEX 금융"],
  ["266360", "KODEX IT"],
  ["091180", "KODEX 자동차"],
  ["117460", "KODEX 에너지화학"],
  ["117680", "KODEX 철강"],
];

// MDCSTAT05001 응답 실제 필드명 (이전 실행에서 확인)
// COMPST_RTO는 "-" 문자열로 오는 경우가 많음 → VALU_AMT로 비중 계산
const F = { code: "COMPST_ISU_CD", name: "COMPST_ISU_NM", weight: "COMPST_RTO", mktval: "VALU_AMT" };

if (!COOKIE) { console.error("KRX_COOKIE 없음"); process.exit(1); }

async function krxPost(bld, bodyExtra = {}) {
  const body = new URLSearchParams({ bld, locale: "ko_KR", csvxls_isNo: "false", ...bodyExtra });
  const res = await fetch(KRX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": REFERER, "Origin": "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest", "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9",
      "Cookie": COOKIE,
    },
    body: body.toString(),
    redirect: "follow",
  });
  const buf = await res.arrayBuffer();
  // KRX 실제 응답은 UTF-8 (EUC-KR로 디코딩하면 한글 깨짐)
  const text = new TextDecoder("utf-8").decode(buf);
  return { status: res.status, text };
}

function getItems(text, ...keys) {
  if (!text?.trim() || text.trim().toUpperCase() === "LOGOUT") return null; // null = 세션만료
  try {
    const j = JSON.parse(text);
    for (const k of keys) {
      if (Array.isArray(j?.[k]) && j[k].length > 0) return j[k];
    }
    return []; // 파싱됐지만 데이터 없음
  } catch { return []; }
}

async function main() {
  console.log("=== KRX ETF 구성종목 fetch ===");
  console.log(`trdDd: ${TRD_DD}  Cookie: ${COOKIE.slice(0, 40)}...\n`);

  // ── Step 1: 전종목 ISIN 맵 ────────────────────────────────────
  console.log("── Step 1: MDCSTAT04601 → 전종목 ISIN 맵 ──");
  const r1 = await krxPost("dbms/MDC/STAT/standard/MDCSTAT04601", { trdDd: TRD_DD, mktTp: "ETF" });
  const list = getItems(r1.text, "OutBlock_1", "output", "block1");

  if (list === null) { console.error("❌ 세션 만료 — LOGOUT"); process.exit(1); }
  if (!list.length)  { console.error("❌ 빈 응답"); process.exit(1); }
  console.log(`  ✅ ${list.length}개 ETF 수신\n`);

  // 단축코드 → ISIN 맵
  const isinMap = {};
  for (const item of list) {
    const srt  = String(item.ISU_SRT_CD ?? "").trim();
    const isin = String(item.ISU_CD     ?? "").trim();
    const name = String(item.ISU_ABBRV ?? item.ISU_NM ?? "").trim();
    if (srt && isin) isinMap[srt] = { isin, name };
  }

  // 8개 타깃 ISIN 출력
  console.log("── 타깃 ETF ISIN 확인 ──\n");
  for (const [ticker, label] of ETF_TARGETS) {
    const info = isinMap[ticker];
    console.log(`  ${ticker}  ${info ? `✅ ${info.isin}  ${info.name}` : "❌ 없음"}`);
  }

  // ── Step 2: MDCSTAT05001 × 8 구성종목 ──────────────────────
  console.log(`\n── Step 2: 구성종목 fetch (MDCSTAT05001) ──\n`);
  const allData = {};

  for (const [ticker, label] of ETF_TARGETS) {
    const info = isinMap[ticker];
    if (!info) { console.log(`  ${label}: ISIN 없음 — 스킵`); continue; }

    process.stdout.write(`  ${label.padEnd(20)} (${info.isin}) → `);
    const r = await krxPost("dbms/MDC/STAT/standard/MDCSTAT05001", {
      isuCd:  info.isin,
      isuCd2: info.isin,
      trdDd:  TRD_DD,
      share:  "1",
      money:  "1",
    });

    const items = getItems(r.text, "OutBlock_1", "output");
    if (items === null) {
      console.log("❌ LOGOUT — 세션 만료");
      break;
    }
    if (!items.length) {
      // raw 확인
      const raw = r.text.slice(0, 80).replace(/\s+/g," ");
      console.log(`❌ empty  (${raw})`);
      continue;
    }

    console.log(`✅ ${items.length}개`);
    allData[ticker] = { label: info.name || label, isin: info.isin, items };
    await new Promise(res => setTimeout(res, 350));
  }

  // ── Step 3: 결과 출력 + 저장 ──────────────────────────────────
  const okEntries = Object.entries(allData);
  console.log(`\n── 요약: ${okEntries.length}/8 성공 ──\n`);

  for (const [ticker, label] of ETF_TARGETS) {
    const d = allData[ticker];
    console.log(`  ${d ? "✅" : "❌"}  ${label.padEnd(20)}  ${d ? d.items.length + "개" : "실패"}`);
  }

  // 반도체 상위 5개 검증
  const semi = allData["091160"];
  if (semi) {
    const sorted = [...semi.items].sort(
      (a, b) => parseFloat(b[F.weight] ?? 0) - parseFloat(a[F.weight] ?? 0)
    );
    console.log(`\n── KODEX 반도체 상위 5개 ──\n`);
    for (const item of sorted.slice(0, 5))
      console.log(`  ${String(item[F.code]).padEnd(14)} ${String(item[F.name]).padEnd(18)} ${item[F.weight]}%`);

    const hynix   = semi.items.find(i => String(i[F.code]).includes("000660"));
    const samsung = semi.items.find(i => String(i[F.code]).includes("005930"));
    console.log(`\n  SK하이닉스: ${hynix  ? `✅ ${hynix[F.weight]}%`  : "❌"}`);
    console.log(`  삼성전자:   ${samsung ? `✅ ${samsung[F.weight]}%` : "❌"}`);
  }

  if (okEntries.length === 0) { console.log("\n저장 생략 (성공 없음)"); return; }

  // JSON 저장
  const out = {
    capturedAt: new Date().toISOString(),
    trdDd:      TRD_DD,
    note:       "KRX MDCSTAT04601(ISIN맵) + MDCSTAT05001(구성종목) 브라우저 세션 캡처. 분기마다 갱신 권장.",
    etfs:       {},
  };

  for (const [ticker, d] of okEntries) {
    // COMPST_RTO가 "-"면 VALU_AMT(평가금액)으로 비중 계산
    const totalVal = d.items.reduce((s, i) => s + (parseFloat(i[F.mktval]) || 0), 0);
    const useValu  = d.items.every(i => !parseFloat(i[F.weight]));

    out.etfs[ticker] = {
      label:    d.label,
      isin:     d.isin,
      count:    d.items.length,
      holdings: [...d.items]
        .map(item => {
          const rawWgt = parseFloat(item[F.weight]);
          const valu   = parseFloat(item[F.mktval]) || 0;
          const wPct   = (!isNaN(rawWgt) && rawWgt > 0)
            ? rawWgt
            : (useValu && totalVal > 0 ? Math.round(valu / totalVal * 10000) / 100 : null);
          return {
            code:      (item[F.code] ?? "").trim(),
            name:      (item[F.name] ?? "").trim(),
            weightPct: wPct,
          };
        })
        .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0)),
    };
  }

  const outPath = "scripts/etf-constituents.json";
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(`\n✅ 저장: ${outPath}  (${Buffer.byteLength(JSON.stringify(out)).toLocaleString()} bytes)`);
}

main().catch(e => { console.error(e); process.exit(1); });
