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
    description: "이자·배당소득 합계와 총자산 대비 현금흐름 비중을 함께 확인합니다.",
    scoreGuide: "기본 점수 = 금융소득/2천만원 x 70점 + 세금우선 요구 20점 + 총자산 50억원 이상 10점",
    levels: [
      { severity: "상", criteria: ["AI 점수 70점 이상", "연간 이자·배당소득 2천만원 이상", "종합소득세율 구간 변동 가능"] },
      { severity: "중", criteria: ["AI 점수 35~69점", "연간 이자·배당소득 1천만~2천만원", "고액 배당·채권 이자 수입 반복"] },
      { severity: "하", criteria: ["AI 점수 34점 이하", "금융소득 1천만원 미만", "변동 요인 제한적"] },
    ],
  },
  "inheritance-gift": {
    id: "inheritance-gift",
    title: "상속·증여 판단 기준",
    description: "가족 간 이전 계획, 세금성 예정 유출, 자산 규모를 함께 확인합니다.",
    scoreGuide: "기본 점수 = 증여·상속 예정 유출/자산 x 1200점 + 관련 키워드 45점 + 12개월 내 일정 20점",
    heritageConsultingRequiredFrom: "중",
    levels: [
      { severity: "상", criteria: ["AI 점수 70점 이상", "증여·상속 세금/이전액이 자산의 5% 이상", "실행 일정 또는 평가 이슈 구체화"] },
      { severity: "중", criteria: ["AI 점수 35~69점", "가족 이전 논의 또는 자산 1~5% 규모 예정 유출", "향후 이전 가능성 검토"] },
      { severity: "하", criteria: ["AI 점수 34점 이하", "현재 이전 계획과 관련 세금 이벤트 확인 제한적"] },
    ],
  },
  "stock-capital-gain": {
    id: "stock-capital-gain",
    title: "주식 양도소득 판단 기준",
    description: "대주주·해외주식·비상장주식·지분 이전 계획과 세금성 유출 규모를 확인합니다.",
    scoreGuide: "기본 점수 = 주식 양도 관련 예정 유출/자산 x 1400점 + 대주주·비상장·해외주식 키워드 45점",
    levels: [
      { severity: "상", criteria: ["AI 점수 70점 이상", "대주주·비상장주식·해외주식 매도 계획 명시", "예정 유출 자산 대비 3% 이상"] },
      { severity: "중", criteria: ["AI 점수 35~69점", "고액 주식 보유 또는 매도 시점 조정 필요", "가족 간 지분 이동 가능성"] },
      { severity: "하", criteria: ["AI 점수 34점 이하", "양도 관련 거래 계획 제한적"] },
    ],
  },
  "real-estate-tax": {
    id: "real-estate-tax",
    title: "부동산 세금 판단 기준",
    description: "보유세·양도세 예정 유출과 부동산 보유/양도 계획을 확인합니다.",
    scoreGuide: "기본 점수 = 부동산 관련 세금성 예정 유출/자산 x 1200점 + 양도·다주택·법인보유 키워드 40점",
    levels: [
      { severity: "상", criteria: ["AI 점수 70점 이상", "부동산 관련 세금성 유출 자산 대비 5% 이상", "양도·증여·상속 일정 임박"] },
      { severity: "중", criteria: ["AI 점수 35~69점", "보유세/양도 계획 검토 필요", "현금흐름 영향이 자산 대비 1~5%"] },
      { severity: "하", criteria: ["AI 점수 34점 이하", "부동산 보유·양도 이슈 제한적"] },
    ],
  },
  "tax-exempt-products": {
    id: "tax-exempt-products",
    title: "비과세·분리과세 상품 판단 기준",
    description: "절세 우선순위, 과세소득 규모, 계좌/상품 한도 제약을 확인합니다.",
    scoreGuide: "기본 점수 = 절세 최우선 요구 55점 + 세금성 유출/자산 x 700점 + 금융소득 2천만원 이상 15점",
    levels: [
      { severity: "상", criteria: ["AI 점수 70점 이상", "절세 최우선 요구와 고액 과세소득 동시 존재", "상품 자격·한도 검토 필요"] },
      { severity: "중", criteria: ["AI 점수 35~69점", "세후 수익률 개선을 위한 상품 구조 비교 필요"] },
      { severity: "하", criteria: ["AI 점수 34점 이하", "현재 세제 활용 우선순위 낮음"] },
    ],
  },
};
