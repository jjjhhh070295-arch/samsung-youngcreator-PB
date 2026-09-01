// 고객 자산 분해 — "부동산 포함 총자산"과 "부동산 제외 투자가능자산"을 한곳에서 낸다.
//
// 배경: client.assetSize 는 부동산을 포함한 총자산이다. 그런데 그 값이 부동산을 포함해야
// 하는 용도(상속세 과세표준·헤리티지 판정·자산규모 표시)와 빼야 하는 용도(포트폴리오 배분
// 원금·세금 추정 원금·스트레스 원금)에 구분 없이 쓰이고 있었다. 부동산 비중이 60%를 넘는
// 고객에서는 후자가 크게 왜곡된다.
//
// 이 파일은 그 분해를 한 번만 계산해 재사용할 수 있게 만든다. 계산식 자체는 새로 쓰지
// 않는다 — investableKrw 는 lib/portfolio.ts 의 computeAssetLayer() 를 그대로 호출해서
// 얻는다(총자산 − 부동산). 같은 식이 여러 곳에 복제되는 것을 막는 게 이 모듈의 목적이므로,
// 여기서 다시 빼기 연산을 쓰지 않는다.
//
// 데이터 출처와 한계:
//   · 총자산  : parties.asset_size (PB가 입력한 값)
//   · 부동산  : client_real_estate.market_value × ownership_share (지분율 가중)
//   · 담보대출: client_real_estate_debt.balance × ownership_share
//   · 주식    : client_holdings 를 listBookHoldings() 로 읽는다 — evalAmount 는 avg_price
//     기반이다(그 함수가 lastPrice 에 avg_price 를 넣는다). AssetAllocationBar/
//     PortfolioPanel 은 /api/prices 로 KIS 실시간가를 쓰므로 stocksKrw 가 서로 다를 수
//     있다. 다만 totalKrw 는 max(assetSize, stocks + realEstate) 라서 assetSize 가 더 큰
//     일반적인 경우 investableKrw 는 시세 출처와 무관하게 같은 값이 나온다. 실시간 시세가
//     꼭 필요한 화면은 기존 경로를 그대로 쓰면 된다.
//
// 쿼리 수: 고객 수와 무관하게 항상 4번(clients 1 + real_estate 1 + real_estate_debt 1 +
// holdings 1). N+1 을 만들지 않으려고 단건 함수도 벌크 함수를 재사용한다.
//
// ⚠️ owner_party_id 의존성 — 현재 데이터에서 부동산이 0으로 나온다.
//   listRealEstateWithDebtBulk() 는 client_real_estate 를 owner_party_id 로 조회하는데,
//   2026-09-01 기준 그 컬럼이 전체 5행 모두 NULL 이다(마이그레이션
//   supabase-migration-parties.sql 8번 백필이 실행되지 않았거나, 그 이후 만들어진 행들이다).
//   RealEstateModule 은 신규 저장 시 owner_party_id 를 채우므로 새 행은 정상이지만,
//   기존 행은 client_id 로만 찾을 수 있다.
//   같은 이유로 lib/heritage/resolveBulk.ts 도 부동산 비중을 0%로 보고 있다 — 즉 이건
//   이 파일만의 문제가 아니라 공통 데이터 문제이고, 백필 한 번으로 양쪽이 함께 고쳐진다.
//   여기서 client_id 로 우회 조회하지 않는 이유: 헤리티지와 조회 경로가 갈라지면 두 화면의
//   부동산 값이 서로 달라지고, 진짜 원인(백필 누락)이 가려진다.

import { listClients, listRealEstateWithDebtBulk } from "@/lib/store";
import { listBookHoldings } from "@/lib/advisory/holdingsStore";
import { computeAssetLayer, type HeldAssets } from "@/lib/portfolio";

export interface ClientAssetBreakdown {
  /** 부동산 포함 총자산 = max(assetSize, 주식 + 부동산). 상속세·헤리티지·자산규모 표시용. */
  totalKrw: number;
  /** 부동산 평가액(지분율 가중, 담보대출 미차감). */
  realEstateKrw: number;
  /** 부동산 담보대출 잔액(지분율 가중). 순부동산 = realEstateKrw − realEstateDebtKrw. */
  realEstateDebtKrw: number;
  /** 총자산 − 부동산. 포트폴리오 배분·세금/스트레스 원금 등 "실제 운용 대상"용. */
  investableKrw: number;
  /** 주식 평가액(avg_price 기반 — 위 주석의 한계 참고). */
  stocksKrw: number;
  /** 현금·기타 = max(0, total − 주식 − 부동산). 실측이 아니라 잔차다. */
  cashKrw: number;
}

/** 고객 여러 명의 자산 분해를 쿼리 4번으로 한 번에. 개인/법인 구분 없이 전부 대상. */
export async function resolveAssetBreakdownBulk(
  clientIds: string[],
): Promise<Map<string, ClientAssetBreakdown>> {
  const out = new Map<string, ClientAssetBreakdown>();
  if (clientIds.length === 0) return out;

  const [clients, realEstate, holdings] = await Promise.all([
    listClients(),
    listRealEstateWithDebtBulk(clientIds),
    listBookHoldings(clientIds),
  ]);

  const assetSizeById = new Map(clients.map((c) => [c.id, c.assetSize || 0]));

  // 부동산 시가·채무를 소유자별로 지분율 가중 합산 — lib/heritage/resolveBulk.ts 와 동일한
  // 집계 방식이다(같은 벌크 결과를 쓰므로 두 곳의 부동산 값이 어긋나지 않는다).
  const realEstateByOwner = new Map<string, { marketValueWon: number; debtWon: number }>();
  for (const p of realEstate.properties) {
    const cur = realEstateByOwner.get(p.ownerPartyId) ?? { marketValueWon: 0, debtWon: 0 };
    cur.marketValueWon += p.marketValue * p.ownershipShare;
    cur.debtWon += (realEstate.debtByPropertyId.get(p.id) ?? 0) * p.ownershipShare;
    realEstateByOwner.set(p.ownerPartyId, cur);
  }

  const stocksByClient = new Map<string, number>();
  for (const h of holdings) {
    stocksByClient.set(h.clientId, (stocksByClient.get(h.clientId) ?? 0) + h.evalAmount);
  }

  for (const clientId of clientIds) {
    const re = realEstateByOwner.get(clientId) ?? { marketValueWon: 0, debtWon: 0 };
    const stocksKrw = stocksByClient.get(clientId) ?? 0;
    const realEstateKrw = re.marketValueWon;

    // 입력 총자산이 실측(주식+부동산)보다 작으면 실측을 택한다 — AssetAllocationBar /
    // PortfolioPanel 이 쓰는 것과 같은 보정이다.
    const totalKrw = Math.max(assetSizeById.get(clientId) ?? 0, stocksKrw + realEstateKrw);
    const cashKrw = Math.max(0, totalKrw - stocksKrw - realEstateKrw);

    const heldAssets: HeldAssets = { stocksKrw, realEstateKrw, cashKrw, totalKrw };
    // investableKrw 는 여기서 직접 빼지 않고 computeAssetLayer 에서 받아 쓴다.
    // totalKrw 가 0 이하면 null 이 오므로 0 으로 떨어뜨린다.
    const layer = computeAssetLayer(heldAssets);

    out.set(clientId, {
      totalKrw,
      realEstateKrw,
      realEstateDebtKrw: re.debtWon,
      investableKrw: layer?.investableKrw ?? 0,
      stocksKrw,
      cashKrw,
    });
  }

  return out;
}

/** 고객 한 명. 내부적으로 벌크를 그대로 쓴다 — 계산 경로가 갈라지지 않게. */
export async function resolveAssetBreakdown(
  clientId: string,
): Promise<ClientAssetBreakdown | null> {
  const map = await resolveAssetBreakdownBulk([clientId]);
  return map.get(clientId) ?? null;
}
