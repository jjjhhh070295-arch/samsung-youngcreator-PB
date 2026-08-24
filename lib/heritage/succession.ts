// 가업승계 "별도 검토" 표시 — 연계 지점만 마련한다. 실제 가업승계 판정(지분 이전 설계,
// 밸류에이션 등)은 이번 범위 밖이며 만들지 않는다.
//
// 가업승계 수요는 법인이 아니라 "그 법인의 최대주주인 개인"에게 있다. 이 개인을 식별하는
// 신호는 코드베이스에 두 갈래로 존재한다(자세한 내용은 대화 보고 참고):
//   (A) 레거시: corporates.rep_party_id(=법인 대표) + corporates.is_majority_shareholder
//       (PB가 수동 체크) — lib/store.ts의 rowToClient()가 이걸 Client.linkedClientId /
//       Client.isMajorityShareholder로 매핑해서 내려준다(그 법인 Client 레코드 위에).
//       개인 쪽에서 "내가 대표로 걸린 법인이 있는가"를 알려면 법인들 중
//       corp.rep_party_id === thisIndividual.id && corp.is_majority_shareholder === true
//       인 것을 역으로 찾아야 한다(개인 자신의 Client 레코드에는 이 값이 안 실린다).
//   (B) party_relationships의 relation_type='owns' — fromPartyId(개인)가 toPartyId(법인)를
//       ownershipPct%만큼 소유. lib/store.ts의 listRelationships()/computeEffectiveAssets()가
//       이미 이 경로로 지분율을 읽는다. 지분율이 실제로 저장돼 있어 50% 초과 여부를 정확히
//       판정할 수 있다는 점에서 (A)보다 신뢰도가 높다.
//
// 이 함수는 위 두 신호 중 호출부가 이미 조회해 넘긴 값만 조합해서 "표시할지 말지"만
// 결정한다 — Supabase 조회는 이 파일에서 하지 않는다(호출부 책임).
//
// buildMajorityShareholderMap()은 신호(A)를 위한 역방향 인덱스를 만든다. listClients()가
// 이미 법인 레코드까지 한 번에 불러오므로(lib/store.ts:574) 별도 쿼리 없이 메모리에서
// grouping만 한다 — BookDashboard처럼 고객 여러 명을 한 화면에서 다룰 때도 쿼리가 늘지 않는다.

import type { Client } from "../types";

export interface MajorityShareholderLink {
  corporatePartyId: string;
  corporateName: string;
}

/** listClients() 결과 전체를 넣으면 개인 partyId → 그 개인이 최대주주로 등록된 법인 목록. */
export function buildMajorityShareholderMap(clients: Client[]): Map<string, MajorityShareholderLink[]> {
  const map = new Map<string, MajorityShareholderLink[]>();
  for (const c of clients) {
    if (c.clientType !== "corporate" || !c.linkedClientId || c.isMajorityShareholder !== true) continue;
    const list = map.get(c.linkedClientId) ?? [];
    list.push({ corporatePartyId: c.id, corporateName: c.name });
    map.set(c.linkedClientId, list);
  }
  return map;
}

export interface BusinessSuccessionSignal {
  /** (A) 이 개인이 대표로 등록된 법인이 있고, 그 법인의 "최대주주" 체크박스가 true인 경우. */
  isMajorityShareholderViaCorporateLink?: boolean;
  /** (B) party_relationships "owns" 관계 중 이 개인이 가진 가장 높은 지분율(%). 없으면 null. */
  maxOwnershipPct?: number | null;
}

export interface BusinessSuccessionFlag {
  flagged: boolean;
  reason: string;
}

const MAJORITY_OWNERSHIP_THRESHOLD_PCT = 50;

export function flagBusinessSuccessionReview(signal: BusinessSuccessionSignal): BusinessSuccessionFlag {
  const viaLink = signal.isMajorityShareholderViaCorporateLink === true;
  const viaOwnership = (signal.maxOwnershipPct ?? 0) > MAJORITY_OWNERSHIP_THRESHOLD_PCT;

  if (!viaLink && !viaOwnership) {
    return { flagged: false, reason: "" };
  }

  const pctNote = viaOwnership ? ` (지분율 ${signal.maxOwnershipPct}%)` : "";
  return {
    flagged: true,
    reason: `이 고객은 법인 최대주주${pctNote}로 확인됩니다 — 가업승계는 상속·증여와 접근 방식이 달라 별도로 검토가 필요합니다.`,
  };
}
