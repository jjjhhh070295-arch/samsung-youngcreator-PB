/**
 * normalize 수정 후 상계주공7단지 면적 선택지 시뮬레이션
 */
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (name) => name === "item",
});

const SERVICE_KEY = "78881cc770809dcf1c56b17353a9e1d2c68810862353d8b8d6a0c0a39999b800";
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
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

// ── 수정된 normalize ──
function normalize(s) {
  return s
    .replace(/\s+/g, "")
    .replace(/[()（）\-_]/g, "")
    .replace(/단지|아파트|APT/gi, "")
    .replace(/고층|저층/g, "");
}

async function fetchMonth(ym) {
  const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(SERVICE_KEY)}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&numOfRows=1000`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const xml = await res.text();
  const codeMatch = xml.match(/<resultCode>(\w+)<\/resultCode>/);
  if (codeMatch && codeMatch[1] !== "00" && codeMatch[1] !== "000") return [];
  try {
    const parsed = parser.parse(xml);
    const items = parsed?.response?.body?.items?.item;
    if (!Array.isArray(items)) return [];
    return items.map((it) => ({
      name:      String(it.aptNm ?? "").trim(),
      area:      parseFloat(String(it.excluUseAr ?? "")),
      price:     parseInt(String(it.dealAmount ?? "").replace(/,/g, ""), 10) * 10000,
      ym:        `${it.dealYear}${String(it.dealMonth).padStart(2,"0")}`,
      cancelled: String(it.cdealType ?? ""),
    }));
  } catch { return []; }
}

function buildAreaGroups(items) {
  const raw = new Map();
  for (const it of items) {
    if (it.cancelled !== "") continue;
    const k = Math.round(it.area);
    const arr = raw.get(k) ?? [];
    arr.push(it);
    raw.set(k, arr);
  }
  const keys = Array.from(raw.keys()).sort((a, b) => a - b);
  const merged = new Map();
  for (const k of keys) {
    let found = false;
    for (const mk of Array.from(merged.keys())) {
      if (Math.abs(k - mk) <= 2) {
        merged.get(mk).push(...raw.get(k));
        found = true;
        break;
      }
    }
    if (!found) merged.set(k, [...raw.get(k)]);
  }
  return merged;
}

function med(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m-1]+s[m])/2 : s[m];
}

async function main() {
  const complexName = "상계주공7단지";
  const normTarget  = normalize(complexName);
  console.log(`\n입력 단지명: "${complexName}" → normalize → "${normTarget}"\n`);

  const months = lastNMonths(24);
  console.log(`조회: ${months.at(-1)} ~ ${months[0]} (24개월)\n`);

  const results = await Promise.all(months.map(fetchMonth));
  const all = results.flat().filter(it => isFinite(it.area) && it.area > 0 && isFinite(it.price) && it.price > 0);

  // 단지명 매칭
  const matched = all.filter(it => {
    const n = normalize(it.name);
    return n.includes(normTarget) || normTarget.includes(n);
  });

  const matchedNames = [...new Set(matched.map(it => it.name))].sort();
  console.log(`매칭된 API 단지명: ${JSON.stringify(matchedNames)}`);
  console.log(`매칭 거래: ${matched.length}건\n`);

  // 면적별 그룹
  const groups = buildAreaGroups(matched);
  const breakdown = Array.from(groups.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([areaKey, txns]) => {
      const prices = txns.map(t => t.price);
      const newestYm = txns.map(t => t.ym).sort().at(-1);
      const pyeong = Math.round(areaKey / 3.306);
      return { area: areaKey, pyeong, count: txns.length, median: Math.round(med(prices)), newestYm };
    });

  console.log("=== 면적 선택지 (areaBreakdown) ===");
  for (const r of breakdown) {
    const ym = `${r.newestYm?.slice(0,4)}-${r.newestYm?.slice(4)}`;
    const price = `${Math.floor(r.median/1e8)}억${Math.round((r.median%1e8)/1e4)>0?Math.round((r.median%1e8)/1e4)+"만":""}`;
    console.log(`  ${r.area}㎡ (${r.pyeong}평) — ${r.count}건 | 최신: ${ym} | 중간가: ${price}`);
  }

  // 59㎡ 포함 여부
  const has59 = breakdown.some(r => Math.abs(r.area - 59) <= 2);
  console.log(`\n59㎡ (±2㎡) 그룹 있음: ${has59 ? "✓" : "✗"}`);

  // 44㎡ 대상으로 targeting
  const target44 = breakdown.find(r => Math.abs(r.area - 44) / 44 <= 0.05);
  console.log(`44㎡ ±5% 타겟 그룹: ${target44 ? `${target44.area}㎡ (직접 매칭 — 면적 선택지 안 뜸)` : "없음 (면적 선택지 표시됨)"}`);
}

main().catch(console.error);
