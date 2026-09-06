// 세무사 인계 요약의 부동산 물건별 내역 조회.
//
// 왜 lib/store.ts 의 listRealEstateWithDebtBulk 를 확장하지 않았나:
//   그 함수는 client_real_estate 에서 id·owner_party_id·market_value·ownership_share
//   네 컬럼만 읽는다. 헤리티지 판정(resolveBulk)이 지분 가중 합계만 필요로 해서다.
//   컬럼을 더 붙이면 lib/store.ts 를 고쳐야 하는데, 그 파일은 여러 작업이 동시에
//   손대는 중이라(2026-09-06 기준) 충돌 위험이 크다. 판정 경로의 반환 타입을 넓히면
//   lib/heritage/ 쪽 타입도 함께 봐야 하는데 그쪽은 다른 세션이 점검 중이다.
//   인계 문서에만 필요한 컬럼이므로 조회를 따로 둔다 — 판정 경로는 그대로 둔 채
//   문서를 여는 시점에만 한 번 더 읽는다.
//
// 세무사에게 필요한 것은 "합계 얼마"가 아니라 물건별 명세다. 상속재산 평가는 물건
// 하나하나에 대해 기준시가·매매사례가·감정가 중 무엇을 쓸지 판단해야 하고, 그러려면
// 소재지·면적·공시가격·취득내역이 있어야 한다.

import { supabase } from "@/lib/supabase";

export interface RealEstateHandoffItem {
  id: string;
  /** 아파트·오피스텔 등. 미입력이면 null. */
  propertyType: string | null;
  address: string | null;
  complexName: string | null;
  areaM2: number | null;
  /** 시가(원). market_source 가 어디서 온 값인지 알려준다. */
  marketValueWon: number | null;
  marketSource: string | null;
  /** 공시가격(원) — 기준시가 평가의 출발점이라 세무사에게 가장 중요한 값 중 하나다. */
  officialPriceWon: number | null;
  acquiredAt: string | null;
  acquiredPriceWon: number | null;
  /** 임대보증금(원) — 반환 의무가 있어 채무성 공제 대상이 될 수 있다. */
  depositWon: number | null;
  /** 지분율(0~1). 1 이 아니면 공동소유다. */
  ownershipShare: number;
  /** 이 물건에 걸린 담보채무 합계(원). 기록이 없으면 null — 0 과 구분한다. */
  debtWon: number | null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

/**
 * 한 고객의 부동산 물건별 명세를 읽는다. Supabase 가 없거나 조회가 실패하면 빈 배열이다
 * — 인계 문서의 다른 섹션까지 막을 이유가 없으므로 throw 하지 않는다.
 *
 * 채무는 client_real_estate_debt 를 물건별로 합산한다. 행이 하나도 없으면 debtWon 을
 * null 로 둔다(0 과 구분) — "무차입"과 "미입력"을 구별해야 하기 때문이다.
 */
export async function listRealEstateHandoffDetail(ownerPartyId: string): Promise<RealEstateHandoffItem[]> {
  if (!supabase || !ownerPartyId) return [];

  try {
    const { data, error } = await supabase
      .from("client_real_estate")
      .select(
        "id, property_type, address, complex_name, area_m2, ownership_share, " +
          "acquired_at, acquired_price, market_value, market_source, official_price, deposit",
      )
      .eq("owner_party_id", ownerPartyId);
    if (error) throw error;

    const rows = data ?? [];
    const items: RealEstateHandoffItem[] = rows.map((r: any) => ({
      id: String(r.id),
      propertyType: str(r.property_type),
      address: str(r.address),
      complexName: str(r.complex_name),
      areaM2: num(r.area_m2),
      marketValueWon: num(r.market_value),
      marketSource: str(r.market_source),
      officialPriceWon: num(r.official_price),
      acquiredAt: str(r.acquired_at),
      acquiredPriceWon: num(r.acquired_price),
      depositWon: num(r.deposit),
      ownershipShare: num(r.ownership_share) ?? 1,
      debtWon: null,
    }));
    if (items.length === 0) return items;

    const { data: debtRows, error: debtErr } = await supabase
      .from("client_real_estate_debt")
      .select("property_id, balance")
      .in(
        "property_id",
        items.map((i) => i.id),
      );
    if (debtErr) throw debtErr;

    // 행이 있는 물건만 채운다. 나머지는 null 로 남아 "미입력"으로 표시된다.
    const byProperty = new Map<string, number>();
    for (const d of debtRows ?? []) {
      const pid = String((d as any).property_id);
      byProperty.set(pid, (byProperty.get(pid) ?? 0) + (num((d as any).balance) ?? 0));
    }
    for (const item of items) {
      if (byProperty.has(item.id)) item.debtWon = byProperty.get(item.id)!;
    }

    return items;
  } catch (e) {
    console.warn("[realestate] 인계용 물건 명세 조회 실패:", e);
    return [];
  }
}
