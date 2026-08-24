/**
 * 상계주공7단지 MOLIT 실거래 원본 디버깅
 * node scripts/debug-sangye7.mjs
 */

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (name) => name === "item",
});

const SERVICE_KEY = "78881cc770809dcf1c56b17353a9e1d2c68810862353d8b8d6a0c0a39999b800";
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
// 노원구 = 11350
const LAWD_CD = "11350";

function lastNMonths(n) {
  const months = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

async function fetchMonth(ym) {
  const url =
    `${ENDPOINT}?serviceKey=${encodeURIComponent(SERVICE_KEY)}` +
    `&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=1000`;
  const res = await fetch(url);
  if (!res.ok) return { ym, items: [], error: `HTTP ${res.status}` };
  const xml = await res.text();

  // resultCode 체크
  const codeMatch = xml.match(/<resultCode>(\w+)<\/resultCode>/);
  if (codeMatch && codeMatch[1] !== "00" && codeMatch[1] !== "000") {
    return { ym, items: [], error: `resultCode=${codeMatch[1]}` };
  }

  try {
    const parsed = parser.parse(xml);
    const items = parsed?.response?.body?.items?.item;
    if (!Array.isArray(items)) return { ym, items: [], error: "items 없음" };

    return {
      ym,
      items: items.map((it) => ({
        name: String(it.aptNm ?? "").trim(),
        area: parseFloat(String(it.excluUseAr ?? "")),
        price: String(it.dealAmount ?? "").replace(/,/g, ""),
        year:  String(it.dealYear ?? ""),
        month: String(it.dealMonth ?? "").padStart(2, "0"),
        dong:  String(it.umdNm ?? ""),
        cancelled: String(it.cdealType ?? ""),
      })),
    };
  } catch (e) {
    return { ym, items: [], error: String(e) };
  }
}

function normalize(s) {
  return s.replace(/\s+/g, "").replace(/[()（）\-_]/g, "").toLowerCase();
}

async function main() {
  console.log("=== 상계주공7단지 MOLIT 실거래 원본 조회 ===\n");
  console.log(`조회 대상: LAWD_CD=${LAWD_CD} (노원구), 최근 36개월\n`);

  const months = lastNMonths(36);
  console.log(`조회 기간: ${months.at(-1)} ~ ${months[0]}\n`);

  // 병렬 호출
  const results = await Promise.all(months.map(fetchMonth));

  // 전체 아이템 합산
  const allItems = [];
  for (const r of results) {
    if (r.error) {
      console.warn(`  ⚠ ${r.ym}: ${r.error}`);
    }
    allItems.push(...r.items);
  }

  console.log(`총 거래 건수 (노원구 전체): ${allItems.length}\n`);

  // ── 상계주공7 관련 단지명 검색 ──────────────────────────────────────────
  const target = "상계주공7";
  const matchedNames = new Set();
  for (const it of allItems) {
    const n = normalize(it.name);
    if (n.includes(normalize(target)) || normalize(target).includes(n)) {
      matchedNames.add(it.name);
    }
  }

  console.log(`[1] "상계주공7" 관련 매칭된 단지명:`);
  if (matchedNames.size === 0) {
    console.log("  → 매칭 없음!\n");
    // 상계동에 있는 주공 단지 전부 출력
    const sangyeApts = new Set();
    for (const it of allItems) {
      if (it.dong.includes("상계") && it.name.includes("주공")) {
        sangyeApts.add(it.name);
      }
    }
    console.log(`[참고] 상계동 주공 단지 목록:`);
    for (const n of Array.from(sangyeApts).sort()) {
      console.log(`  - "${n}"`);
    }
  } else {
    for (const n of Array.from(matchedNames).sort()) {
      console.log(`  - "${n}"`);
    }
  }
  console.log();

  // 매칭된 단지 거래 전부 추출
  const complexTxns = allItems.filter((it) => {
    const n = normalize(it.name);
    return (
      n.includes(normalize(target)) ||
      normalize(target).includes(n) ||
      // 더 넓게 잡기: 상계 + 7단지
      (it.name.includes("상계") && it.name.includes("7단지"))
    );
  });

  console.log(`[2] 매칭된 거래 총 ${complexTxns.length}건`);

  // 면적별 그룹
  const byArea = new Map();
  for (const it of complexTxns) {
    if (it.cancelled !== "") continue; // 해제 거래 제외
    const k = Math.round(it.area);
    const arr = byArea.get(k) ?? [];
    arr.push(it);
    byArea.set(k, arr);
  }

  console.log(`\n[3] 면적별 거래 현황 (취소 제외):\n`);
  const sortedAreas = Array.from(byArea.entries()).sort((a, b) => b[0] - a[0]);
  for (const [area, txns] of sortedAreas) {
    const newestYm = txns.map(t => `${t.year}${t.month}`).sort().at(-1);
    const prices = txns.map(t => parseInt(t.price.replace(/,/g, ""), 10) * 10000);
    const med = prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    console.log(
      `  ${area}㎡ (약 ${Math.round(area/3.306)}평) — ${txns.length}건` +
      ` | 최신거래: ${newestYm?.slice(0,4)}-${newestYm?.slice(4)}` +
      ` | 중간가: ${Math.round(med / 1e8)}억${Math.round((med % 1e8) / 1e4) > 0 ? Math.round((med % 1e8) / 1e4) + "만" : ""}`
    );
  }

  // 59㎡ 범위 직접 확인
  console.log("\n[4] 원본에서 55~65㎡ 범위 거래:");
  const range59 = complexTxns.filter(it => it.cancelled === "" && it.area >= 55 && it.area <= 65);
  if (range59.length === 0) {
    console.log("  → 해당 범위 거래 없음 (원본에도 없음)");
  } else {
    for (const it of range59.sort((a, b) => `${b.year}${b.month}`.localeCompare(`${a.year}${a.month}`))) {
      console.log(`  ${it.year}-${it.month} | ${it.area}㎡ | ${it.price}만원 | "${it.name}"`);
    }
  }

  // 해제된 거래도 확인
  const cancelled59 = complexTxns.filter(it => it.cancelled !== "" && it.area >= 55 && it.area <= 65);
  if (cancelled59.length > 0) {
    console.log(`\n  [참고] 해제(취소)된 55~65㎡ 거래 ${cancelled59.length}건:`);
    for (const it of cancelled59) {
      console.log(`  ${it.year}-${it.month} | ${it.area}㎡ | ${it.price}만원 (해제) | "${it.name}"`);
    }
  }

  // 단지명 표기 전수 조사
  console.log("\n[5] 노원구에서 '7단지' 포함 단지명 전부:");
  const seventhDanji = new Set();
  for (const it of allItems) {
    if (it.name.includes("7단지")) seventhDanji.add(it.name);
  }
  for (const n of Array.from(seventhDanji).sort()) {
    console.log(`  - "${n}"`);
  }

  console.log("\n=== 완료 ===");
}

main().catch(console.error);
