export type KoreaMacroFrequency = "D" | "M" | "Q";

export type KoreaMacroSeriesId =
  | "bok-policy-rate"
  | "ktb-2y"
  | "ktb-3y"
  | "ktb-5y"
  | "ktb-10y"
  | "ktb-20y"
  | "ktb-30y"
  | "ktb-50y"
  | "corp-aa-minus-3y"
  | "corp-bbb-minus-3y"
  | "real-gdp-sa"
  | "cpi-headline"
  | "cpi-core-food-energy-excluded"
  | "usd-krw-close-1530";

export type SourceProvidedStatus = {
  value: null;
  status: "source_not_provided";
};

export interface KoreaMacroSeriesDefinition {
  seriesId: KoreaMacroSeriesId;
  label: string;
  statCode: string;
  itemCodes: readonly string[];
  frequency: KoreaMacroFrequency;
  unit: string;
  definitionId: string;
  comparisonDefinition: string | null;
  sourceInstitution: string;
  sourceUrl: string;
  staleAfterDays: number;
  releaseDate: SourceProvidedStatus;
  vintageDate: SourceProvidedStatus;
  preliminaryFinal: SourceProvidedStatus;
  revisionStatus: SourceProvidedStatus;
}

const SOURCE_NOT_PROVIDED: SourceProvidedStatus = Object.freeze({
  value: null,
  status: "source_not_provided",
});

const ECOS_API_ROOT = "https://ecos.bok.or.kr/api";

function definition(
  input: Omit<
    KoreaMacroSeriesDefinition,
    "sourceInstitution" | "sourceUrl" | "releaseDate" | "vintageDate" | "preliminaryFinal" | "revisionStatus"
  >,
): KoreaMacroSeriesDefinition {
  return Object.freeze({
    ...input,
    itemCodes: Object.freeze([...input.itemCodes]),
    sourceInstitution: "한국은행 경제통계시스템(ECOS)",
    sourceUrl: `${ECOS_API_ROOT}/`,
    releaseDate: SOURCE_NOT_PROVIDED,
    vintageDate: SOURCE_NOT_PROVIDED,
    preliminaryFinal: SOURCE_NOT_PROVIDED,
    revisionStatus: SOURCE_NOT_PROVIDED,
  });
}

const MARKET_YIELD_3Y = "ecos-817Y002-3y-annual-percent";

export const KOREA_MACRO_ALLOWLIST: Readonly<Record<KoreaMacroSeriesId, KoreaMacroSeriesDefinition>> = Object.freeze({
  "bok-policy-rate": definition({
    seriesId: "bok-policy-rate",
    label: "한국은행 기준금리",
    statCode: "722Y001",
    itemCodes: ["0101000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-policy-rate-daily",
    comparisonDefinition: null,
    staleAfterDays: 10,
  }),
  "ktb-2y": definition({
    seriesId: "ktb-2y",
    label: "국고채 2년",
    statCode: "817Y002",
    itemCodes: ["010195000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-2y",
    comparisonDefinition: "ecos-817Y002-2y-annual-percent",
    staleAfterDays: 7,
  }),
  "ktb-3y": definition({
    seriesId: "ktb-3y",
    label: "국고채 3년",
    statCode: "817Y002",
    itemCodes: ["010200000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-3y",
    comparisonDefinition: MARKET_YIELD_3Y,
    staleAfterDays: 7,
  }),
  "ktb-5y": definition({
    seriesId: "ktb-5y",
    label: "국고채 5년",
    statCode: "817Y002",
    itemCodes: ["010200001"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-5y",
    comparisonDefinition: "ecos-817Y002-5y-annual-percent",
    staleAfterDays: 7,
  }),
  "ktb-10y": definition({
    seriesId: "ktb-10y",
    label: "국고채 10년",
    statCode: "817Y002",
    itemCodes: ["010210000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-10y",
    comparisonDefinition: "ecos-817Y002-10y-annual-percent",
    staleAfterDays: 7,
  }),
  "ktb-20y": definition({
    seriesId: "ktb-20y",
    label: "국고채 20년",
    statCode: "817Y002",
    itemCodes: ["010220000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-20y",
    comparisonDefinition: "ecos-817Y002-20y-annual-percent",
    staleAfterDays: 7,
  }),
  "ktb-30y": definition({
    seriesId: "ktb-30y",
    label: "국고채 30년",
    statCode: "817Y002",
    itemCodes: ["010230000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-30y",
    comparisonDefinition: "ecos-817Y002-30y-annual-percent",
    staleAfterDays: 7,
  }),
  "ktb-50y": definition({
    seriesId: "ktb-50y",
    label: "국고채 50년",
    statCode: "817Y002",
    itemCodes: ["010240000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-ktb-50y",
    comparisonDefinition: "ecos-817Y002-50y-annual-percent",
    staleAfterDays: 7,
  }),
  "corp-aa-minus-3y": definition({
    seriesId: "corp-aa-minus-3y",
    label: "회사채 3년 AA-",
    statCode: "817Y002",
    itemCodes: ["010300000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-corporate-aa-minus-3y",
    comparisonDefinition: MARKET_YIELD_3Y,
    staleAfterDays: 7,
  }),
  "corp-bbb-minus-3y": definition({
    seriesId: "corp-bbb-minus-3y",
    label: "회사채 3년 BBB-",
    statCode: "817Y002",
    itemCodes: ["010320000"],
    frequency: "D",
    unit: "연%",
    definitionId: "ecos-market-yield-corporate-bbb-minus-3y",
    comparisonDefinition: MARKET_YIELD_3Y,
    staleAfterDays: 7,
  }),
  "real-gdp-sa": definition({
    seriesId: "real-gdp-sa",
    label: "실질 국내총생산(계절조정)",
    statCode: "200Y104",
    itemCodes: ["1400"],
    frequency: "Q",
    unit: "십억원",
    definitionId: "ecos-real-gdp-seasonally-adjusted-quarterly",
    comparisonDefinition: "ecos-real-gdp-sa-level",
    staleAfterDays: 120,
  }),
  "cpi-headline": definition({
    seriesId: "cpi-headline",
    label: "소비자물가지수 총지수",
    statCode: "901Y009",
    itemCodes: ["0"],
    frequency: "M",
    unit: "2020=100",
    definitionId: "ecos-cpi-headline-2020",
    comparisonDefinition: "ecos-cpi-index-2020",
    staleAfterDays: 45,
  }),
  "cpi-core-food-energy-excluded": definition({
    seriesId: "cpi-core-food-energy-excluded",
    label: "식료품 및 에너지 제외 소비자물가지수",
    statCode: "901Y010",
    itemCodes: ["DB"],
    frequency: "M",
    unit: "2020=100",
    definitionId: "ecos-cpi-core-food-energy-excluded-2020",
    comparisonDefinition: "ecos-cpi-index-2020",
    staleAfterDays: 45,
  }),
  "usd-krw-close-1530": definition({
    seriesId: "usd-krw-close-1530",
    label: "원/달러 환율(15:30 종가)",
    statCode: "731Y003",
    itemCodes: ["0000003"],
    frequency: "D",
    unit: "원",
    definitionId: "ecos-usd-krw-close-1530",
    comparisonDefinition: null,
    staleAfterDays: 7,
  }),
});

export function getKoreaMacroDefinition(seriesId: KoreaMacroSeriesId): KoreaMacroSeriesDefinition {
  return KOREA_MACRO_ALLOWLIST[seriesId];
}

/**
 * 인증키를 URL에 포함하지 않는 안전한 요청 명세입니다. 실제 서버 어댑터가
 * 키를 주입하더라도 로그·클라이언트 응답에는 이 명세만 사용해야 합니다.
 */
export function buildEcosRequestDescriptor(
  seriesId: KoreaMacroSeriesId,
  startPeriod: string,
  endPeriod: string,
): { pathTemplate: string; sourceUrl: string } {
  const series = getKoreaMacroDefinition(seriesId);
  const itemPath = series.itemCodes.map(encodeURIComponent).join("/");
  return {
    pathTemplate: `/StatisticSearch/{SERVER_CREDENTIAL}/json/kr/1/100/${series.statCode}/${series.frequency}/${encodeURIComponent(startPeriod)}/${encodeURIComponent(endPeriod)}/${itemPath}`,
    sourceUrl: series.sourceUrl,
  };
}
