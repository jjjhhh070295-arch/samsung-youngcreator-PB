// 한국부동산원 아파트 매매 실거래가격지수 (KOSIS 공유서비스)
// tblId: DT_KAB_11672_S1 | orgId: 408 | 기준: 2017.11=100 | 월별 시도별
// API 키: process.env.REB_INDEX_SERVICE_KEY (KOSIS 공유서비스 발급키)

const KOSIS_URL =
  "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const ORG_ID  = "408";
const TBL_ID  = "DT_KAB_11672_S1";
const ITM_ID  = "T1"; // 지수

// LAWD_CD 앞 2자리(법정동코드 시도) → KOSIS 지역코드(C1)
// ※ MOLIT LAWD_CD는 법정동코드 체계: 서울=11, 부산=26, 경기=41 등
const SIDO_TO_KOSIS: Record<string, string> = {
  "11": "030", // 서울특별시
  "26": "040", // 부산광역시
  "27": "050", // 대구광역시
  "28": "060", // 인천광역시
  "29": "070", // 광주광역시
  "30": "080", // 대전광역시
  "31": "090", // 울산광역시
  "36": "091", // 세종특별자치시
  "41": "100", // 경기도
  "42": "110", // 강원특별자치도
  "43": "120", // 충청북도
  "44": "130", // 충청남도
  "45": "140", // 전북특별자치도
  "46": "150", // 전라남도
  "47": "160", // 경상북도
  "48": "170", // 경상남도
  "50": "180", // 제주특별자치도
};

/**
 * 시도별 월별 아파트 매매 실거래가격지수를 가져온다.
 * @param lawdCd    5자리 시군구코드 (법정동코드 앞 5자리와 동일)
 * @param startYm   조회 시작월 YYYYMM
 * @param endYm     조회 종료월 YYYYMM
 * @returns         Map<YYYYMM, 지수값>  (API 실패 시 빈 Map — 보정 없이 원가격 사용)
 */
export async function fetchRebIndex(
  lawdCd:   string,
  startYm:  string,
  endYm:    string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const apiKey = process.env.REB_INDEX_SERVICE_KEY;
  if (!apiKey) return map;

  // 시도코드 추출 → KOSIS 지역코드
  const sidoPrefix = lawdCd.slice(0, 2);
  const kosisC1    = SIDO_TO_KOSIS[sidoPrefix] ?? "000"; // 없으면 전국

  const url =
    `${KOSIS_URL}?method=getList&apiKey=${apiKey}` +
    `&format=json&jsonVD=Y` +
    `&orgId=${ORG_ID}&tblId=${TBL_ID}` +
    `&itmId=${ITM_ID}&objL1=${kosisC1}` +
    `&prdSe=M&startPrdDe=${startYm}&endPrdDe=${endYm}`;

  try {
    const res = await fetch(url, { next: { revalidate: 86_400 } }); // 1일 캐시
    if (!res.ok) return map;

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      console.warn("[reb-index] KOSIS 오류:", JSON.stringify(data).slice(0, 200));
      return map;
    }

    for (const item of data) {
      const row = item as Record<string, unknown>;
      const period = String(row["PRD_DE"] ?? "").trim(); // YYYYMM
      const idx    = parseFloat(String(row["DT"] ?? ""));
      if (period.length === 6 && isFinite(idx) && idx > 0) {
        map.set(period, idx);
      }
    }
  } catch (e) {
    console.error("[reb-index] KOSIS fetch 실패:", e);
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
