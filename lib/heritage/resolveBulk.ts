// BookDashboard처럼 담당 고객 전체를 한 화면에서 훑는 곳에서 헤리티지 판정 입력을 만들 때
// 쓰는 조립 함수. 이 파일 자체는 Supabase를 조회하지 않는다(순수 함수) — 호출부가
// lib/store.ts의 listOwnershipRelationshipsBulk/listFamilyRelationshipsBulk/
// listRealEstateWithDebtBulk/listGiftEventsBulk(전부 partyId 배열을 받는 벌크 쿼리, 고객 수와
// 무관하게 각각 쿼리 1~2번)로 미리 가져온 원시 데이터를 넘기면, 그걸 클라이언트별 Map으로
// 재구성한다. 고객 한 명마다 쿼리를 새로 날리는 대신, 쿼리 결과를 한 번 순회하며
// groupBy 하는 것으로 N+1을 피한다.
//
// 알려진 한계(다음 단계에서 실제로 연결할 때 반드시 고려할 것):
//   - childrenCount: party_relationships에 'child' 행이 하나도 없으면 이 함수는 0으로
//     채운다. 이건 "자녀가 확인상 0명"과 "PB가 아직 가족관계를 안 입력했다"를 구분하지
//     못한다 — 진짜 미상 상태를 표현하려면 이 함수가 아니라 estimateInheritanceTaxRange를
//     직접 호출부에서 불러 childrenCount:null(자동으로 2명 가정 + 표시)을 넘기는 경로를
//     따로 둬야 한다. 지금은 "관계 데이터가 있는 만큼만 반영"으로 단순화했다.
//   - taxTagIds: RRTTLLU 태그 매칭(보조 신호)은 상담 메모 벌크 분석이 필요해 이번 범위에
//     넣지 않았다. 넘기지 않으면 빈 배열로 처리되며, 구조적 신호(자산·부동산·증여이력)만으로
//     판정한다 — score에 큰 영향은 없다(보조 가산 최대 6점).

import type { Client, PartyRelationship, TransferEvent } from "../types";
import type { HeritageAssessmentInput } from "./types";
import { buildMajorityShareholderMap } from "./succession";
import type { BusinessSuccessionSignal } from "./succession";
import type { RealEstateWithDebtBulkResult } from "../store";

export interface HeritageBulkResolveParams {
  /** listClients() 결과 전체(법인 포함) — 최대주주 역방향 인덱스를 만드는 데 필요하다. */
  allClients: Client[];
  /** 실제로 헤리티지 판정을 계산할 개인 고객 id 목록(예: 이 PB 담당 고객). */
  targetClientIds: string[];
  /** listOwnershipRelationshipsBulk(targetClientIds) 결과 — relation_type='owns'. */
  ownershipRelationships: PartyRelationship[];
  /** listFamilyRelationshipsBulk(targetClientIds) 결과 — relation_type in ('spouse','child'). */
  familyRelationships: PartyRelationship[];
  /** listRealEstateWithDebtBulk(targetClientIds) 결과. */
  realEstate: RealEstateWithDebtBulkResult;
  /** listGiftEventsBulk(targetClientIds) 결과 — event_type='gift'. */
  giftEvents: TransferEvent[];
  /** RRTTLLU 매칭 태그(있으면 보조 신호로 반영). 없으면 빈 배열로 처리. */
  taxTagIdsByClientId?: Map<string, string[]>;
  asOf?: Date;
}

export interface HeritageBulkResolveResult {
  heritageInputs: Map<string, HeritageAssessmentInput>;
  successionSignals: Map<string, BusinessSuccessionSignal>;
}

export function resolveHeritageInputsBulk(params: HeritageBulkResolveParams): HeritageBulkResolveResult {
  const clientsById = new Map(params.allClients.map((c) => [c.id, c]));
  const majorityShareholderMap = buildMajorityShareholderMap(params.allClients);

  // 부동산 시가·채무 — ownerPartyId별로 지분율 가중 합산(client_real_estate 1쿼리 +
  // client_real_estate_debt 1쿼리 결과를 여기서 groupBy).
  const realEstateByOwner = new Map<string, { marketValueWon: number; debtWon: number }>();
  for (const p of params.realEstate.properties) {
    const cur = realEstateByOwner.get(p.ownerPartyId) ?? { marketValueWon: 0, debtWon: 0 };
    cur.marketValueWon += p.marketValue * p.ownershipShare;
    const debt = params.realEstate.debtByPropertyId.get(p.id) ?? 0;
    cur.debtWon += debt * p.ownershipShare;
    realEstateByOwner.set(p.ownerPartyId, cur);
  }

  // 배우자 유무 / 자녀 수 — fromPartyId별로 관계 타입 집계.
  const hasSpouseByFrom = new Set<string>();
  const childCountByFrom = new Map<string, number>();
  for (const rel of params.familyRelationships) {
    if (rel.relationType === "spouse") hasSpouseByFrom.add(rel.fromPartyId);
    if (rel.relationType === "child") {
      childCountByFrom.set(rel.fromPartyId, (childCountByFrom.get(rel.fromPartyId) ?? 0) + 1);
    }
  }

  // 증여이력 — fromPartyId별.
  const giftsByFrom = new Map<string, TransferEvent[]>();
  for (const g of params.giftEvents) {
    if (!g.fromPartyId) continue;
    const list = giftsByFrom.get(g.fromPartyId) ?? [];
    list.push(g);
    giftsByFrom.set(g.fromPartyId, list);
  }

  // 지분율 신호(B) — fromPartyId별 최대 지분율.
  const maxOwnershipByFrom = new Map<string, number>();
  for (const rel of params.ownershipRelationships) {
    const pct = rel.ownershipPct ?? 0;
    const cur = maxOwnershipByFrom.get(rel.fromPartyId) ?? 0;
    if (pct > cur) maxOwnershipByFrom.set(rel.fromPartyId, pct);
  }

  const heritageInputs = new Map<string, HeritageAssessmentInput>();
  const successionSignals = new Map<string, BusinessSuccessionSignal>();

  for (const clientId of params.targetClientIds) {
    const client = clientsById.get(clientId);
    if (!client || client.clientType !== "individual") continue;

    const re = realEstateByOwner.get(clientId) ?? { marketValueWon: 0, debtWon: 0 };
    const assetSizeWon = Math.max(client.assetSize || 0, re.marketValueWon);
    const realEstateWeightPct = assetSizeWon > 0 ? Math.min(100, (re.marketValueWon / assetSizeWon) * 100) : null;

    heritageInputs.set(clientId, {
      asOf: params.asOf,
      clientType: client.clientType,
      birthDate: client.birthDate || null,
      assetSizeWon,
      debtWon: re.debtWon,
      realEstateWeightPct,
      hasSpouse: hasSpouseByFrom.has(clientId),
      childrenCount: childCountByFrom.get(clientId) ?? 0,
      givenGiftEvents: giftsByFrom.get(clientId) ?? [],
      taxTagIds: params.taxTagIdsByClientId?.get(clientId) ?? [],
    });

    const shareholderLinks = majorityShareholderMap.get(clientId) ?? [];
    successionSignals.set(clientId, {
      isMajorityShareholderViaCorporateLink: shareholderLinks.length > 0,
      maxOwnershipPct: maxOwnershipByFrom.get(clientId) ?? null,
    });
  }

  return { heritageInputs, successionSignals };
}
