import type { MacroConsumerPolicy, MacroSeriesBlocked } from "./types";

export const MACRO_CONSUMER_POLICY: MacroConsumerPolicy = Object.freeze({
  pbInternalResearchDisplay: true,
  portfolio: false,
  productRecommendation: false,
  customerOutput: false,
  aiNumericGeneration: false,
});

export interface RightsReviewRegistryEntry {
  seriesId: string;
  title: string;
  provider: string;
  sourceUrl: string;
  reason: string;
}
/**
 * 숫자를 대체하거나 우회 수집하지 않는 권리 검토 registry입니다. 이 목록에는
 * endpoint, API key 또는 자동 수집 함수가 존재하지 않습니다.
 */
export const RIGHTS_REVIEW_REGISTRY: readonly RightsReviewRegistryEntry[] = Object.freeze([
  {
    seriesId: "kr-card-bond-spread",
    title: "여전채 스프레드",
    provider: "금융투자협회 또는 계약 데이터 제공사",
    sourceUrl: "https://www.kofiabond.or.kr/",
    reason: "등급·만기별 공식 계열과 PB 화면 이용권 확인 필요",
  },
  {
    seriesId: "us-ig-oas",
    title: "미국 회사채 IG 스프레드",
    provider: "ICE Data Indices",
    sourceUrl: "https://fred.stlouisfed.org/series/BAMLC0A0CM",
    reason: "ICE 원 데이터의 저장·표시·재배포 라이선스 확인 필요",
  },
  {
    seriesId: "us-hy-oas",
    title: "미국 회사채 HY 스프레드",
    provider: "ICE Data Indices",
    sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    reason: "ICE 원 데이터의 저장·표시·재배포 라이선스 확인 필요",
  },
  {
    seriesId: "cboe-vix",
    title: "Cboe VIX 지수",
    provider: "Cboe Global Markets",
    sourceUrl: "https://www.cboe.com/tradable_products/vix/vix_historical_data/",
    reason: "대시보드 자동수집·표시 이용권 확인 필요",
  },
  {
    seriesId: "hyperscaler-bond-spread",
    title: "하이퍼스케일러 개별 회사채 스프레드",
    provider: "계약형 채권 평가·TRACE 데이터",
    sourceUrl: "https://www.finra.org/finra-data/fixed-income",
    reason: "채권별 가격·벤치마크·재배포 권리와 산식 승인이 필요",
  },
  {
    seriesId: "hyperscaler-cds-premium",
    title: "하이퍼스케일러 CDS 프리미엄",
    provider: "계약형 CDS 가격 데이터",
    sourceUrl: "https://www.dtcc.com/repository-otc-data",
    reason: "공개 DTCC 활동자료는 CDS 프리미엄이 아니며 가격 라이선스가 필요",
  },
]);

export function rightsReviewPlaceholders(): MacroSeriesBlocked[] {
  return RIGHTS_REVIEW_REGISTRY.map((entry) => ({
    status: "blocked",
    seriesId: entry.seriesId,
    sectionId: "credit-volatility",
    title: entry.title,
    code: "DATA_RIGHTS_REVIEW_REQUIRED",
    message: entry.reason,
    sourceUrl: entry.sourceUrl,
    rightsStatus: "licensed-data-required",
  }));
}

export function macroMayReachConsumer(
  consumer: "portfolio" | "productRecommendation" | "customerOutput" | "aiNumericGeneration",
) {
  return MACRO_CONSUMER_POLICY[consumer];
}
