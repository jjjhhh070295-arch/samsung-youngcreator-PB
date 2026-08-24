/**
 * 시점보정 로직 대조 테스트
 * 실제 API 없이 목 데이터로 보정 전/후 가격 변화를 검증
 *
 * 실행: node scripts/check-realestate.mjs
 */

// ── 유틸 ────────────────────────────────────────────────────────────────────

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function monthsBetween(a, b) {
  return (
    (parseInt(b.slice(0, 4)) - parseInt(a.slice(0, 4))) * 12 +
    (parseInt(b.slice(4))    - parseInt(a.slice(4)))
  );
}

function nowYm() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function determineFreshness(newestDealYm, curYm, indexAvailable) {
  const age = monthsBetween(newestDealYm, curYm);
  if (age <= 6)  return "확정";
  if (age <= 24 && indexAvailable) return "추정";
  return "참고용";
}

function formatW(won) {
  const eok = Math.floor(won / 1_0000_0000);
  const man = Math.round((won % 1_0000_0000) / 10_000);
  if (eok > 0 && man > 0) return `${eok}억 ${man}만원`;
  if (eok > 0) return `${eok}억`;
  return `${man}만원`;
}

function correctPrice(price, dealYm, curYm, indexMap) {
  const curIdx  = indexMap.get(curYm) ?? [...indexMap.entries()].sort((a,b)=>b[0].localeCompare(a[0]))[0]?.[1];
  const dealIdx = indexMap.get(dealYm);
  if (!dealIdx || !curIdx) return { corrected: price, ratio: null, indexAvailable: false };
  const ratio = curIdx / dealIdx;
  return { corrected: Math.round(price * ratio), ratio, indexAvailable: true };
}

function buildAreaResult(areaKey, txns, indexMap, curYm) {
  const corrected = txns.map(t => ({ ...correctPrice(t.price, t.dealYm, curYm, indexMap), original: t.price, dealYm: t.dealYm }));
  const newestDealYm = txns.map(t=>t.dealYm).sort().at(-1);
  const hasIndex = corrected.some(c => c.indexAvailable);
  const freshness = determineFreshness(newestDealYm, curYm, hasIndex);

  const originalPrices  = corrected.map(c => c.original);
  // 추정만 시점보정 적용; 확정·참고용은 원가격 사용
  const effectivePrices = freshness === "추정"
    ? corrected.map(c => c.corrected)
    : originalPrices;
  const med     = median(effectivePrices);
  const origMed = median(originalPrices);
  const pyeong  = Math.round(areaKey / 3.30579);
  const ratios  = corrected.filter(c => c.ratio !== null).map(c => c.ratio);
  const avgRatio = ratios.length > 0 ? ratios.reduce((a,b)=>a+b,0)/ratios.length : null;
  const sorted = [...effectivePrices].sort((a,b)=>a-b);

  return { area: areaKey, pyeong, freshness, low: sorted[0], high: sorted[sorted.length-1],
    median: Math.round(med), originalMedian: Math.round(origMed),
    correctionRatio: avgRatio, sampleSize: txns.length, newestDealYm };
}

// ── 목 한국부동산원 지수 (강남구 11680) ────────────────────────────────────
// 기준: 2022-01 = 100 (실제 지수 추세 반영)
const MOCK_INDEX_GANGNAM = new Map([
  ["202201", 100.0], ["202202", 101.2], ["202203", 102.5], ["202204", 103.8],
  ["202205", 104.1], ["202206", 103.7], ["202207", 102.9], ["202208", 102.1],
  ["202209", 101.5], ["202210", 100.2], ["202211",  98.8], ["202212",  97.5],
  ["202301",  96.1], ["202302",  95.3], ["202303",  94.8], ["202304",  95.2],
  ["202305",  96.0], ["202306",  97.1], ["202307",  98.2], ["202308",  99.0],
  ["202309", 100.1], ["202310", 101.3], ["202311", 102.0], ["202312", 102.8],
  ["202401", 103.5], ["202402", 104.2], ["202403", 104.9], ["202404", 105.6],
  ["202405", 106.1], ["202406", 106.8], ["202407", 107.3], ["202408", 107.9],
  ["202409", 108.4], ["202410", 108.9], ["202411", 109.2], ["202412", 109.7],
  ["202501", 110.1], ["202502", 110.5], ["202503", 110.8], ["202504", 111.2],
  ["202505", 111.6], ["202506", 112.0],
]);

// ── 단지 A: 은마아파트 (최근 거래 많음) ──────────────────────────────────
const CUR_YM = nowYm();
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}`;
}

const EUNMA_84 = [
  { area: 84.43, price: 22_0000_0000, dealYm: daysAgo(20)  },  // 최근 3개월
  { area: 84.43, price: 22_5000_0000, dealYm: daysAgo(45)  },  // 최근 2개월
  { area: 84.43, price: 21_8000_0000, dealYm: daysAgo(70)  },  // 최근 3개월
  { area: 84.43, price: 21_0000_0000, dealYm: daysAgo(90)  },  // 3개월
  { area: 84.43, price: 23_0000_0000, dealYm: daysAgo(10)  },  // 1개월 내
];
const EUNMA_76 = [
  { area: 76.79, price: 19_5000_0000, dealYm: daysAgo(15)  },
  { area: 76.79, price: 20_0000_0000, dealYm: daysAgo(40)  },
];

// ── 단지 B: 오래된 거래만 (마포구 예시) ─────────────────────────────────
const MOCK_INDEX_MAPO = new Map([
  ["202201", 100.0], ["202206", 101.5], ["202212",  96.0],
  ["202306",  94.0], ["202312", 101.0],
  ["202406", 105.0], ["202412", 108.0],
  ["202503", 110.0], ["202504", 111.0], ["202506", 112.0],
]);

const OLD_84 = [
  { area: 84.5, price: 9_5000_0000, dealYm: "202303" },  // 27개월 전 → 참고용 (지수 있어도 24개월 초과)
];
const OLD_59 = [
  { area: 59.2, price: 7_0000_0000, dealYm: "202504" },  // 14개월 전 → 추정
  { area: 59.2, price: 6_8000_0000, dealYm: "202412" },  // 18개월 전 → 추정
];

// ── 출력 함수 ────────────────────────────────────────────────────────────

function printAreaResult(r, label="") {
  const badge = r.freshness === "확정" ? "🟢 확정"
              : r.freshness === "추정" ? "🟡 추정(시점보정)"
              : "🔴 참고용";
  const rangeStr = r.low !== null && r.high !== null
    ? `${formatW(r.low)} ~ ${formatW(r.high)}`
    : "—";
  console.log(`\n  ${label || `${r.area}㎡ (${r.pyeong}평)`}  ${badge}  [${r.sampleSize}건]`);
  console.log(`    중앙값:  ${r.median !== null ? formatW(r.median) : "—"}`);
  if (r.freshness !== "확정" && r.originalMedian !== r.median) {
    console.log(`    원가격:  ${formatW(r.originalMedian)}  →  보정배율: ×${r.correctionRatio?.toFixed(3) ?? "—"}`);
    const diff = r.median - r.originalMedian;
    const sign = diff >= 0 ? "+" : "";
    console.log(`    변화폭:  ${sign}${formatW(Math.abs(diff))} (${sign}${((diff/r.originalMedian)*100).toFixed(1)}%)`);
  }
  console.log(`    범위:    ${rangeStr}`);
  console.log(`    최근거래: ${r.newestDealYm.slice(0,4)}-${r.newestDealYm.slice(4)}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log("═".repeat(66));
console.log("단지 A: 은마아파트 (강남구, 최근 거래 풍부)");
console.log("═".repeat(66));
console.log(`현재월: ${CUR_YM}  /  지수 출처: 강남구 모의 지수`);

const eunma84Res = buildAreaResult(84, EUNMA_84, MOCK_INDEX_GANGNAM, CUR_YM);
const eunma76Res = buildAreaResult(77, EUNMA_76, MOCK_INDEX_GANGNAM, CUR_YM);
printAreaResult(eunma84Res, "84㎡ (25평)");
printAreaResult(eunma76Res, "76㎡ (23평)");

console.log("\n  → 최근 거래이므로 지수보정이 거의 없고, 범위가 바로 확정값.");

// ════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(66));
console.log("단지 B: 오래된 거래만 있는 단지 (마포구)");
console.log("═".repeat(66));
console.log(`현재월: ${CUR_YM}  /  지수 출처: 마포구 모의 지수`);

const old84Res = buildAreaResult(85, OLD_84, MOCK_INDEX_MAPO, CUR_YM);
const old59Res = buildAreaResult(59, OLD_59, MOCK_INDEX_MAPO, CUR_YM);
printAreaResult(old84Res, "84㎡ (25평)");
printAreaResult(old59Res, "59㎡ (17평)");

console.log("\n  → 84㎡: 27개월 전 거래라 24개월 임계 초과 → 참고용(보정 없음)");
console.log("     59㎡: 18개월 전 거래, 지수 보정 적용 → 추정");

// ════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(66));
console.log("요약: 보정 전 vs 보정 후");
console.log("═".repeat(66));
console.log("  단지       평형  원가격         보정 후        변화");
const rows = [
  { name:"은마",    area:"84㎡", orig: eunma84Res.originalMedian, corr: eunma84Res.median, fresh: eunma84Res.freshness },
  { name:"은마",    area:"76㎡", orig: eunma76Res.originalMedian, corr: eunma76Res.median, fresh: eunma76Res.freshness },
  { name:"구단지",  area:"84㎡", orig: old84Res.originalMedian,  corr: old84Res.median,   fresh: old84Res.freshness },
  { name:"구단지",  area:"59㎡", orig: old59Res.originalMedian,  corr: old59Res.median,   fresh: old59Res.freshness },
];
for (const r of rows) {
  const diff = r.corr - r.orig;
  const sign = diff >= 0 ? "+" : "";
  const pct  = ((diff / r.orig) * 100).toFixed(1);
  const badge = r.fresh === "확정" ? "🟢" : r.fresh === "추정" ? "🟡" : "🔴";
  console.log(
    `  ${r.name.padEnd(6)} ${r.area.padEnd(5)}` +
    `  ${formatW(r.orig).padEnd(12)} ` +
    `→ ${formatW(r.corr).padEnd(12)} ` +
    `${sign}${formatW(Math.abs(diff)).padEnd(10)} (${pct}%)  ${badge}${r.fresh}`
  );
}
console.log("═".repeat(66));
