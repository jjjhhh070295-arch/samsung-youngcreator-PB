/**
 * PB 수동 포트폴리오용 채권·회사채 ETF 선택 카탈로그.
 * 신규 선택 UI는 실제 상장 ETF(국채·회사채)만 제공한다.
 * 한전채·구글 회사채 등 개별 직접투자 심볼은 신규 선택에서 제거한다(실보유·승인 IPS는 보존).
 * 시세·수익률·보수·분배 일정은 하드코딩하지 않으며 price는 null로 둔다.
 */

export type BondCatalogAssetClass = "domesticBond" | "globalBond";

export type BondExposure =
  | "government"
  | "corporate_ig"
  | "aggregate"
  | "futures_gov";

export type BondCatalogEntry = {
  id: string;
  /** 선택 카테고리 라벨 (PB UI) */
  label: string;
  symbol: string;
  /** 실제 상품명 — 선택 후 전 화면에 이 이름을 표시 */
  name: string;
  assetClass: BondCatalogAssetClass;
  kind: "채권 ETF";
  exchange: string;
  currency: "KRW" | "USD";
  source: string;
  note: string;
  exposure: BondExposure;
  /** 물리적 채권 편입 vs 선물 */
  structure: "physical" | "futures";
  currencyHedged: boolean | null;
  targetMaturity: boolean;
  /** 만기매칭 펀드의 목표 만기/청산 예정일 (공시 기준, YYYY-MM) */
  targetMaturityDate: string | null;
  quotationKind: "share";
  instrumentType: "bond_etf";
};

export const BOND_INSTRUMENT_CATALOG: BondCatalogEntry[] = [
  {
    id: "kr-short",
    label: "한국 단기채",
    symbol: "153130.KS",
    name: "KODEX 단기채권",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-short-bond",
    note: "국내 단기 금리·현금성 완충용 ETF (코드 153130)",
    exposure: "government",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
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
    exposure: "government",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
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
    exposure: "government",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "kr-corp-ig",
    label: "국내 우량회사채 ETF",
    symbol: "0099L0.KS",
    name: "ACE 우량회사채(AA-이상)액티브",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:ace-ig-corp-bond",
    note: "국내 AA- 이상 회사채 액티브 ETF · 한국·미국 등급체계는 동일하지 않음",
    exposure: "corporate_ig",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "kr-corp-target",
    label: "국내 만기매칭 회사채 ETF",
    symbol: "0007F0.KS",
    name: "KODEX 27-12 회사채(AA-이상)액티브",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-target-maturity-corp-2712",
    note: "2027-12 목표만기 후보 · 원금·YTM 보장 아님 · 상시형 ETF와 별도 선택",
    exposure: "corporate_ig",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: true,
    targetMaturityDate: "2027-12",
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "kr-agg-aa",
    label: "국내 종합채권 ETF",
    symbol: "273130.KS",
    name: "KODEX 종합채권(AA-이상)액티브",
    assetClass: "domesticBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-agg-aa-active",
    note: "국채·회사채 혼합 종합채권(AA-이상) · 단기채(153130)와 구분",
    exposure: "aggregate",
    structure: "physical",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
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
    note: "미국 단기채·달러 노출 · 국내 상장(원화 호가)",
    exposure: "government",
    structure: "physical",
    currencyHedged: false,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "us-mid",
    label: "미국 중기채",
    symbol: "308620.KS",
    name: "KODEX 미국10년국채선물",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-us-10y-fut",
    note: "미국 중기 국채 선물 기반 ETF",
    exposure: "futures_gov",
    structure: "futures",
    currencyHedged: null,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "us-long",
    label: "미국 장기채",
    symbol: "304660.KS",
    name: "KODEX 미국30년국채울트라선물(H)",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "KRX",
    currency: "KRW",
    source: "catalog:kodex-us-30y-fut",
    note: "미국 장기 국채 울트라 선물 · 환헤지(H)",
    exposure: "futures_gov",
    structure: "futures",
    currencyHedged: true,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
  {
    id: "us-corp-ig",
    label: "미국 투자등급 회사채 ETF",
    symbol: "LQD",
    name: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
    assetClass: "globalBond",
    kind: "채권 ETF",
    exchange: "NYSE Arca",
    currency: "USD",
    source: "catalog:ishares-lqd",
    note: "미국 상장 USD IG 회사채 ETF · 한국 AA- 등급체계와 동일하지 않음",
    exposure: "corporate_ig",
    structure: "physical",
    currencyHedged: false,
    targetMaturity: false,
    targetMaturityDate: null,
    quotationKind: "share",
    instrumentType: "bond_etf",
  },
];

/** 신규 선택에서 제거된 레거시 직접투자 대표 심볼 */
export const LEGACY_GENERIC_CORP_BOND_SYMBOLS = ["BOND-KEPCO", "BOND-GOOGL"] as const;

export function isLegacyGenericCorpBondSymbol(symbol: string): boolean {
  const bare = (symbol || "").trim().toUpperCase().replace(/\.(KS|KQ)$/i, "");
  return (LEGACY_GENERIC_CORP_BOND_SYMBOLS as readonly string[]).includes(bare);
}

export function bondsForAssetClass(assetClass: BondCatalogAssetClass): BondCatalogEntry[] {
  return BOND_INSTRUMENT_CATALOG.filter((b) => b.assetClass === assetClass);
}

export function findBondCatalogBySymbol(symbol: string): BondCatalogEntry | undefined {
  const bare = (symbol || "").trim().toUpperCase().replace(/\.(KS|KQ)$/i, "");
  return BOND_INSTRUMENT_CATALOG.find((b) => {
    const s = b.symbol.toUpperCase().replace(/\.(KS|KQ)$/i, "");
    return s === bare || b.symbol.toUpperCase() === (symbol || "").trim().toUpperCase();
  });
}
