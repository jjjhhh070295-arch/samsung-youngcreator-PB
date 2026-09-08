// 고객 자산 분해 — AUM(운용자산)과 총자산(AUM + 부동산)을 한곳에서 낸다.
//
// ── 자산 모델 (2026-09-08 변경) ─────────────────────────────────────────────
//   AUM   = parties.asset_size            PB 가 입력한 운용자산. 부동산과 독립.
//   총자산 = AUM + 부동산                  상속·과세 계열 전용.
//
// 부동산을 등록해도 AUM 은 줄지 않는다. 부동산은 "따로 얹히는 값"이다.
//
// 예전 모델은 asset_size 를 "부동산 포함 총자산"으로 보고 investableKrw = 총자산 − 부동산
// 으로 역산했다. 그래서 부동산을 입력할수록 굴릴 돈이 줄어드는 것으로 계산됐다 —
// 부동산 비중이 72% 인 고객은 투자가능자산이 150억에서 41.5억으로 떨어졌다. PB 가 입력한
// 값의 의미를 "굴릴 돈"으로 확정하면 그 역산이 필요 없어지고, 부동산은 더하기만 하면 된다.
//
// 그래서 investableKrw 를 lib/portfolio.ts 의 computeAssetLayer() 에서 받아 오던 것을
// 그만두고 여기서 직접 정한다. computeAssetLayer 는 여전히 totalKrw − realEstateKrw 로
// 빼는 예전 식이라(포트폴리오 화면이 자체 경로로 쓴다) 이 모듈과 결과가 갈라진다.
// 그쪽 전환은 이 변경의 3단계이며 여기서는 손대지 않았다.
//
// ⚠️ 필드명 investableKrw 는 그대로 두었다. 호출부가 20곳 가까이 되어 이름을 바꾸면
//    이번 단계의 범위를 넘는다. 의미는 화면 라벨과 같은 "AUM" 이다.
//
// 데이터 출처와 한계:
//   · AUM     : parties.asset_size (PB가 입력한 값)
//   · 부동산  : client_real_estate.market_value × ownership_share (지분율 가중)
//   · 담보대출: client_real_estate_debt.balance × ownership_share
//   · 주식    : client_holdings 를 listBookHoldings() 로 읽는다 — evalAmount 는 avg_price
//     기반이다(그 함수가 lastPrice 에 avg_price 를 넣는다). AssetAllocationBar/
//     PortfolioPanel 은 /api/prices 로 KIS 실시간가를 쓰므로 stocksKrw 가 서로 다를 수
//     있다. 다만 AUM 은 asset_size 를 그대로 쓰므로 시세 출처가 달라도 AUM·총자산은
//     흔들리지 않는다 — 갈리는 것은 stocksKrw 와 그 잔차인 cashKrw 뿐이다.
//     실시간 시세가 꼭 필요한 화면은 기존 경로를 그대로 쓰면 된다.
//
// 쿼리 수: 고객 수와 무관하게 항상 4번(clients 1 + real_estate 1 + real_estate_debt 1 +
// holdings 1). N+1 을 만들지 않으려고 단건 함수도 벌크 함수를 재사용한다.
//
// owner_party_id 의존성 — listRealEstateWithDebtBulk() 는 client_real_estate 를
//   owner_party_id 로 조회한다. 예전 주석은 그 컬럼이 전 행 NULL 이라 부동산이 0으로
//   나온다고 경고했는데, 2026-09-08 실측에서는 4행 모두 채워져 있어 해소됐다.
//   백필이 되었거나 이후 행들이 RealEstateModule 로 저장되면서 채워진 것으로 보인다.
//   여기서 client_id 로 우회 조회하지 않는 이유는 그대로다 — 헤리티지(resolveBulk)와
//   조회 경로가 갈라지면 두 화면의 부동산 값이 서로 달라진다.

import { listClients, listRealEstateWithDebtBulk } from "@/lib/store";
import { listBookHoldings } from "@/lib/advisory/holdingsStore";

export interface ClientAssetBreakdown {
  /**
   * 총자산 = AUM + 부동산.
   *
   * ⚠️ 화면 대부분은 이 값을 쓰지 않는다. 상속·과세 계열 전용이다 —
   * 세무사 인계요약, 세전·세후, 헤리티지 판정처럼 "물려줄 재산 전체"가 분모인 곳.
   * 기본정보·포트폴리오·AUM 표시에는 investableKrw(=AUM)를 쓴다.
   */
  totalKrw: number;
  /** 부동산 평가액(지분율 가중, 담보대출 미차감). */
  realEstateKrw: number;
  /** 부동산 담보대출 잔액(지분율 가중). 순부동산 = realEstateKrw − realEstateDebtKrw. */
  realEstateDebtKrw: number;
  /**
   * AUM(운용자산) = PB 가 입력한 asset_size. **부동산과 독립이며 빼지 않는다.**
   *
   * 필드명이 investableKrw 인 것은 이 이름을 쓰는 호출부가 20곳 가까이 되어 이번
   * 단계에서 바꾸지 않았기 때문이다. 의미는 화면 라벨과 같은 "AUM"이다.
   * 포트폴리오 배분·스트레스 원금·AUM 표시가 전부 이 값을 분모로 쓴다.
   */
  investableKrw: number;
  /** 주식 평가액(avg_price 기반 — 위 주석의 한계 참고). AUM 안에 든 값이다. */
  stocksKrw: number;
  /**
   * AUM 잔차 = max(0, AUM − 보유종목 평가액). **현금이 아니다.**
   *
   * client_holdings 에 등록된 것만 stocksKrw 로 잡히므로, 채권·펀드·ELS·예금처럼
   * 아직 등록되지 않은 자산이 있으면 전부 이 값으로 떨어진다. "현금성 자산"으로 읽으면
   * 유동성을 과대평가하게 된다 — 납부재원 판단에 그대로 쓰면 안 된다.
   *
   * 필드명 cashKrw 와 화면 라벨은 4단계(라벨 통일)에서 함께 재검토한다.
   */
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

    // AUM = PB 가 입력한 asset_size 그대로. 부동산과 독립이며 그 자체로 확정값이다.
    //
    // 예전에는 max(assetSize, 주식+부동산) 으로 실측이 크면 실측을 택했다. 그 보정을
    // 없앤다 — 보유종목 합계가 입력 AUM 을 넘으면 그건 계산으로 덮을 게 아니라 데이터가
    // 어긋났다는 신호이고, 덮어 버리면 어긋난 사실 자체가 화면에서 사라진다.
    // 그 경우 stocksKrw > aumKrw 가 되어 cashKrw 가 0 으로 눌리고 배분 비중이 100% 를
    // 넘게 보이는데, 그렇게 드러나는 편이 맞다.
    const aumKrw = assetSizeById.get(clientId) ?? 0;

    // 총자산 = AUM + 부동산. 세무사 인계요약·세전세후 등 상속·과세 계열 전용이다.
    const totalKrw = aumKrw + realEstateKrw;

    // AUM 잔차 — 현금이 아니라 "보유종목으로 등록되지 않은 AUM" 이다(타입 주석 참고).
    // 부동산은 애초에 AUM 밖이라 여기서 빼지 않는다.
    const cashKrw = Math.max(0, aumKrw - stocksKrw);

    out.set(clientId, {
      totalKrw,
      realEstateKrw,
      realEstateDebtKrw: re.debtWon,
      investableKrw: aumKrw,
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
