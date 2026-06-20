// 국토부 실거래가 API 응답 구조 확인용 스크립트
// 실행: node scripts/probe-molit.mjs
import { readFileSync } from "fs";
import { XMLParser } from "fast-xml-parser";

// .env.local 수동 파싱
const env = Object.fromEntries(
  readFileSync(".env.local", "utf-8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const KEY = env.DATA_GO_KR_SERVICE_KEY;
const ENDPOINT = env.MOLIT_APT_TRADE_ENDPOINT;

if (!KEY || !ENDPOINT) {
  console.error("❌ DATA_GO_KR_SERVICE_KEY 또는 MOLIT_APT_TRADE_ENDPOINT가 .env.local에 없음");
  process.exit(1);
}

// 강남구(11680), 최근 2개월 시도
const now = new Date();
const months = [0, 1].map((i) => {
  const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
});

// 강남구 최근 2개월 전체 로드 후 단지명 매칭 검증
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true, isArray: (n) => n === "item" });

let allItems = [];
for (const ym of months) {
  const url = `${ENDPOINT}?serviceKey=${encodeURIComponent(KEY)}&LAWD_CD=11680&DEAL_YMD=${ym}&numOfRows=1000`;
  const res = await fetch(url);
  const text = await res.text();
  const parsed = parser.parse(text);
  const items = parsed?.response?.body?.items?.item ?? [];
  allItems.push(...items);
  console.log(`📡 ${ym}: ${items.length}건`);
}

console.log(`\n총 ${allItems.length}건 로드됨`);
console.log("\n── 단지명 샘플 (상위 20개 고유값) ──");
const names = [...new Set(allItems.map(i => i.aptNm))].slice(0, 20);
names.forEach(n => console.log(" •", n));

// 압구정 현대 매칭 테스트
const target = "현대";
const matched = allItems.filter(i =>
  i.aptNm?.replace(/\s/g,"").includes(target.replace(/\s/g,"")) &&
  Math.abs(i.excluUseAr - 84) / 84 <= 0.05
);
console.log(`\n── "현대" + 84m² 매칭: ${matched.length}건 ──`);
matched.slice(0, 3).forEach(i => console.log(` aptNm: ${i.aptNm}, area: ${i.excluUseAr}, price: ${i.dealAmount}`));
