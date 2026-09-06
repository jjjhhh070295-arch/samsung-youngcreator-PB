// 종목명 → 종목코드 대화형 검색의 순수 로직.
//
// 라우트(app/api/instruments/lookup/route.ts)가 아니라 여기 두는 이유:
//   · Next.js 라우트 파일은 GET/POST/runtime 등 정해진 것 외에는 export 할 수 없다.
//   · 자동 선택 규칙을 클라이언트가 그대로 다시 쓴다.
//   · 네트워크 없이 테스트할 수 있어야 한다.

import { normalizeKrName } from "@/lib/pricing/ticker-map";

/** 검색 결과 1건. 시세 필드는 의도적으로 두지 않는다 — 시세는 KIS(/api/prices) 담당이다. */
export interface LookupHit {
  code: string;
  name: string;
  market: string;
  nation: "KOR" | "USA";
  currency: "KRW" | "USD";
  /** 우선주만 구분한다. 목록에서 보통주와 헷갈리지 않게 하려는 용도다. */
  kind: "우선주" | "보통주";
}

export interface LookupResponse {
  ok: boolean;
  /** naver=실시간, static=정적 맵 폴백, none=검색어가 짧음 */
  source: "naver" | "static" | "none";
  results: LookupHit[];
  warning?: string;
}

// 폼의 통화 선택이 KRW/USD 뿐이라 그 외 국가는 담을 수 없다.
// 실측에서 "애플" 검색에 도쿄 거래소 종목(nationCode=JPN)이 섞여 나왔다.
const NATION_CURRENCY: Record<string, "KRW" | "USD"> = { KOR: "KRW", USA: "USD" };

// 우선주 이름 꼬리표: "삼성전자우", "두산퓨얼셀1우", "현대차2우B" 등.
const PREFERRED_RE = /\d*우B?$/;

/**
 * 네이버 자동완성 응답을 우리 형식으로 옮긴다.
 *
 * 비공식 엔드포인트라 필드가 사라지거나 타입이 바뀔 수 있다. 항목 단위로 검증하고
 * 이상한 항목은 건너뛴다 — 한 건이 깨졌다고 검색 전체가 실패하면 안 된다.
 * 입력이 배열이 아니거나 통째로 엉뚱해도 빈 배열을 돌려줄 뿐 throw 하지 않는다.
 */
export function toHits(payload: unknown): LookupHit[] {
  const items = (payload as any)?.items;
  if (!Array.isArray(items)) return [];

  const hits: LookupHit[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const code = typeof item.code === "string" ? item.code.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const nation = typeof item.nationCode === "string" ? item.nationCode : "";
    // target 에 marketindicator·index 가 들어 있어 지수가 섞여 온다.
    const category = typeof item.category === "string" ? item.category : "";
    if (!code || !name || category !== "stock") continue;

    const currency = NATION_CURRENCY[nation];
    if (!currency) continue; // KOR·USA 외 제외

    const market =
      (typeof item.typeName === "string" && item.typeName) ||
      (typeof item.typeCode === "string" && item.typeCode) ||
      (nation === "KOR" ? "KRX" : "GLOBAL");

    hits.push({
      code,
      name,
      market,
      nation: nation as "KOR" | "USA",
      currency,
      kind: PREFERRED_RE.test(name) ? "우선주" : "보통주",
    });
  }
  return hits;
}

/**
 * 자동 선택 판정 — 고를 여지가 없을 때만 고른다. 둘 중 하나면 확정이다:
 *
 *   ① 후보가 애초에 1건 — 모호성이 없다. "니어" → 니어스랩, "JYP" → JYP Ent.
 *      (네이버 표기가 "JYP Ent." 라 이름이 정확히 일치하지는 않지만 후보가 하나뿐이다)
 *   ② 정규화한 이름이 정확히 일치하는 후보가 1건 — 다른 후보가 있어도 이건 확정이다.
 *      "삼성전자"는 관련 ETF 9건과 함께 오지만 정확 일치는 보통주 1건뿐이고,
 *      "두산퓨얼셀"도 우선주(1우·2우B)가 같이 오지만 그것들은 정확 일치가 아니다.
 *
 * 그 외에는 null 이고 사용자가 목록에서 고른다("한국" → 한국전력·한국가스공사·…).
 *
 * 접두사가 겹치는 다른 회사를 임의로 집어 버리는 사고(두산퓨얼셀 → 두산)를 막는 것이
 * 목적이라, 후보가 여럿이고 정확 일치가 없으면 추측하지 않는다.
 */
export function pickAutoSelection(query: string, results: LookupHit[]): LookupHit | null {
  if (results.length === 1) return results[0];

  const key = normalizeKrName(query);
  if (!key) return null;
  const exact = results.filter((r) => normalizeKrName(r.name) === key);
  return exact.length === 1 ? exact[0] : null;
}
