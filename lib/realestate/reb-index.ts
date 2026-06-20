// 한국부동산원 시군구 월별 아파트 매매가격지수
// API 키: process.env.REB_INDEX_SERVICE_KEY

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (name) => name === "item",
});

const BASE_URL =
  "https://apis.data.go.kr/1611000/AptPriceIndex/getApartPriceIndex";

/**
 * 시군구별 월별 아파트 매매가격지수를 가져온다.
 * @param sigunguCode  5자리 시군구코드 (법정동코드 앞 5자리와 동일)
 * @param startYm      조회 시작월 YYYYMM
 * @param endYm        조회 종료월 YYYYMM
 * @returns            Map<YYYYMM, 지수값>  (API 실패 시 빈 Map — 보정 없이 원가격 사용)
 */
export async function fetchRebIndex(
  sigunguCode: string,
  startYm: string,
  endYm: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const serviceKey = process.env.REB_INDEX_SERVICE_KEY;
  if (!serviceKey) return map;

  const url =
    `${BASE_URL}?serviceKey=${encodeURIComponent(serviceKey)}` +
    `&pageNo=1&numOfRows=100` +
    `&startMonth=${startYm}&endMonth=${endYm}` +
    `&localCode=${sigunguCode}`;

  try {
    const res = await fetch(url, { next: { revalidate: 86_400 } }); // 1일 캐시
    if (!res.ok) return map;
    const xml = await res.text();

    if (xml.includes("<resultCode>") && !xml.includes("<resultCode>00</resultCode>")) {
      console.warn("[reb-index] API 오류:", xml.slice(0, 200));
      return map;
    }

    const parsed = parser.parse(xml) as {
      response?: { body?: { items?: { item?: unknown[] } } };
    };
    const items = parsed?.response?.body?.items?.item;
    if (!Array.isArray(items)) return map;

    for (const item of items) {
      const row = item as Record<string, unknown>;
      const period = String(row["period"] ?? "").trim(); // YYYYMM
      // 필드명이 API 버전마다 다를 수 있어 후보를 순서대로 시도
      const rawIdx =
        row["priceIndex"] ??
        row["indexValue"] ??
        row["aptPriceIndex"] ??
        row["매매지수"] ??
        null;
      const idx = parseFloat(String(rawIdx ?? ""));
      if (period.length === 6 && isFinite(idx) && idx > 0) {
        map.set(period, idx);
      }
    }
  } catch (e) {
    console.error("[reb-index] fetch 실패:", e);
  }
  return map;
}

/** 현재 월 YYYYMM */
export function nowYm(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 두 YYYYMM 사이 월 수 (b - a, 양수 = b가 더 최근) */
export function monthsBetween(a: string, b: string): number {
  return (
    (parseInt(b.slice(0, 4)) - parseInt(a.slice(0, 4))) * 12 +
    (parseInt(b.slice(4))    - parseInt(a.slice(4)))
  );
}
