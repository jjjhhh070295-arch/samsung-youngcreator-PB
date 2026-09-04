/**
 * PB 수동 포트폴리오용 채권 선택 카탈로그.
 * 국채·미채 노출은 ETF 라벨, 한전채·구글 회사채는 직접투자형 라벨.
 * 시세는 실시간 조회하지 않으며 price는 null로 둔다.
 */

export type BondCatalogAssetClass = "domesticBond" | "globalBond";

export type BondCatalogEntry = {
  id: string;
  label: string;
  symbol: string;
  name: string;
  assetClass: BondCatalogAssetClass;
  kind: "채권 ETF" | "직접투자 채권";
  exchange: string;
  currency: "KRW" | "USD";
  source: string;
  note: string;
};

export const BOND_INSTRUMENT_CATALOG: BondCatalogEntry[] = [
  {
    id: "kr-short",
    label: "한국 단기채",
    symbol: "273130.KS",
    name: "KODEX 단기채권",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-short-bond",
    note: "국내 단기 금리·현금성 완충용 ETF",
  },
  {
    id: "kr-mid",
    label: "한국 중기채",
    symbol: "114260.KS",
    name: "KODEX 국고채3년",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-ktb-3y",
    note: "국내 중기 국채 듀레이션 ETF",
  },
  {
    id: "kr-long",
    label: "한국 장기채",
    symbol: "148070.KS",
    name: "KODEX 국고채10년",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-ktb-10y",
    note: "국내 장기 국채 듀레이션 ETF",
  },
  {
    id: "us-short",
    label: "미국 단기채",
    symbol: "329750.KS",
    name: "KODEX 미국달러단기채권액티브",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-us-short-bond",
    note: "미국 단기채·달러 노출 ETF",
  },
  {
    id: "us-mid",
    label: "미국 중기채",
    symbol: "308620.KS",
    name: "KODEX 미국채울트라10년선물",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-us-10y-fut",
    note: "미국 중기 국채 선물 기반 ETF",
  },
  {
    id: "us-long",
    label: "미국 장기채",
    symbol: "304660.KS",
    name: "KODEX 미국채울트라30년선물",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-us-30y-fut",
    note: "미국 장기 국채 선물 기반 ETF",
  },
  {
    id: "kepco-direct",
    label: "한전채",
    symbol: "BOND-KEPCO",
    name: "한국전력공사 회사채 (직접투자)",
    assetClass: "domesticBond",
    kind: "직접투자 채권",
    exchange: "OTC",
    currency: "KRW",
    source: "catalog:direct-kepco-bond",
    note: "공기업채 인컴 · 편입 시 개별 회차·만기 확정",
  },
  {
    id: "google-corp",
    label: "구글 회사채",
    symbol: "BOND-GOOGL",
    name: "Alphabet/Google 회사채 (직접투자)",
    assetClass: "globalBond",
    kind: "직접투자 채권",
    exchange: "OTC",
    currency: "USD",
    source: "catalog:direct-google-corp-bond",
    note: "해외 회사채 라벨 · 편입 시 ISIN·만기 확정",
  },
];

export function bondsForAssetClass(assetClass: BondCatalogAssetClass): BondCatalogEntry[] {
  return BOND_INSTRUMENT_CATALOG.filter((b) => b.assetClass === assetClass);
}
