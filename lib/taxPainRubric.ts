export type TaxSeverity = "상" | "중" | "하";

export interface TaxPainRubric {
  id: string;
  title: string;
  description: string;
  scoreGuide: string;
  levels: Array<{ severity: TaxSeverity; criteria: string[] }>;
  heritageConsultingRequiredFrom?: TaxSeverity;
}

export const TAX_PAIN_RUBRICS: Record<string, TaxPainRubric> = {
  "financial-income": {
    id: "financial-income",
    title: "금융소득 종합과세 판단 기준",
    description: "이자·배당소득 입력 합계가 금융소득종합과세 점검 구간에 가까운지 확인합니다.",
    scoreGuide: "금액 기준 우선: 연간 금융소득 2,000만원 이상=상, 1,500만~2,000만원=중, 그 미만=하",
    levels: [
      { severity: "상", criteria: ["연간 이자·배당소득 2,000만원 이상", "종합과세·건보료 영향 우선 점검"] },
      { severity: "중", criteria: ["연간 이자·배당소득 1,500만~2,000만원", "채권 이자/배당 집중 시 사전 점검"] },
      { severity: "하", criteria: ["연간 금융소득 1,500만원 미만", "현재 입력 기준 고충 낮음"] },
    ],
  },
  "inheritance-gift": {
    id: "inheritance-gift",
    title: "상속·증여 판단 기준",
    description: "증여·상속세 예상액, 증여 실행금액, 가업승계 키워드와 총자산 규모를 확인합니다.",
    scoreGuide: "증여·상속 관련 입력 30억원 이상 또는 키워드+총자산 100억원 이상=상, 10억~30억원 또는 가업승계+50억원 이상=중",
    heritageConsultingRequiredFrom: "중",
    levels: [
      { severity: "상", criteria: ["증여세/상속세/증여 실행금액 30억원 이상", "또는 증여·상속 키워드 + 총자산 100억원 이상", "삼성헤리티지 컨설팅 검토"] },
      { severity: "중", criteria: ["관련 입력 10억~30억원", "또는 가업승계 키워드 + 총자산 50억원 이상", "삼성헤리티지 컨설팅 검토"] },
      { severity: "하", criteria: ["관련 입력 10억원 미만", "키워드/실행 일정 제한적"] },
    ],
  },
  "stock-capital-gain": {
    id: "stock-capital-gain",
    title: "주식 양도소득 판단 기준",
    description: "대주주·해외주식·비상장주식·IPO 보호예수 관련 세금성 유출 규모를 확인합니다.",
    scoreGuide: "IPO/보호예수/대주주 신호 + 관련 유출 3억원 이상=상, 고액 주식/해외주식/비상장 키워드 또는 관련 유출 존재=중",
    levels: [
      { severity: "상", criteria: ["IPO/보호예수/대주주 키워드", "관련 양도세·현금화 유출 3억원 이상"] },
      { severity: "중", criteria: ["고액 주식/해외주식/비상장/지분 키워드", "또는 관련 세금성 유출 존재"] },
      { severity: "하", criteria: ["관련 거래 계획 제한적"] },
    ],
  },
  "real-estate-tax": {
    id: "real-estate-tax",
    title: "부동산 세금 판단 기준",
    description: "보유세·양도세 예정 유출과 부동산 보유/양도 키워드를 확인합니다.",
    scoreGuide: "부동산 양도세/보유세 유출 5억원 이상 또는 다주택·양도 강신호=상, 1억~5억원 또는 부동산 키워드=중",
    levels: [
      { severity: "상", criteria: ["부동산 세금성 유출 5억원 이상", "또는 다주택·양도·법인보유 부동산 키워드"] },
      { severity: "중", criteria: ["부동산 세금성 유출 1억~5억원", "또는 부동산 보유/매각 키워드"] },
      { severity: "하", criteria: ["부동산 세금 이벤트 입력 제한적"] },
    ],
  },
  "tax-exempt-products": {
    id: "tax-exempt-products",
    title: "비과세·분리과세 상품 판단 기준",
    description: "RRTTLLU 7요인 중 세금 점수와 절세 우선 요구를 확인합니다.",
    scoreGuide: "7요인 세금 점수 4점 이상=상, 3점 이상 또는 절세 최우선 요구=중, 그 외=하",
    levels: [
      { severity: "상", criteria: ["7요인 세금 점수 4~5점", "세후수익률/계좌 한도 우선 비교"] },
      { severity: "중", criteria: ["7요인 세금 점수 3점", "또는 절세 최우선 요구 감지"] },
      { severity: "하", criteria: ["세금 점수 1~2점", "현재 세제 활용 우선순위 낮음"] },
    ],
  },
};
