export type TaxSeverity = "높음" | "중간" | "낮음";

export interface TaxPainRubric {
  id: string;
  title: string;
  description: string;
  levels: Array<{ severity: TaxSeverity; criteria: string[] }>;
  heritageConsultingRequiredFrom?: TaxSeverity;
}

export const TAX_PAIN_RUBRICS: Record<string, TaxPainRubric> = {
  "financial-income": {
    id: "financial-income", title: "금융소득 종합과세 판단 기준", description: "이자·배당소득의 합계와 다른 소득을 함께 확인합니다.",
    levels: [
      { severity: "높음", criteria: ["연간 이자·배당소득이 2천만원 이상", "금융소득 증가로 종합소득세율 구간 변동 가능"] },
      { severity: "중간", criteria: ["금융소득이 2천만원에 근접", "고액 배당·채권 이자 수입이 반복"] },
      { severity: "낮음", criteria: ["금융소득 규모가 작고 변동 요인이 제한적"] },
    ],
  },
  "inheritance-gift": {
    id: "inheritance-gift", title: "상속·증여 판단 기준", description: "가족 간 이전 계획과 자산 구성, 시점을 종합 확인합니다.", heritageConsultingRequiredFrom: "중간",
    levels: [
      { severity: "높음", criteria: ["상속 또는 증여 계획이 구체화됨", "사업·부동산·비상장주식 등 평가 이슈가 존재"] },
      { severity: "중간", criteria: ["가족 이전 또는 공동 보유 논의가 있음", "향후 자산 이전 가능성을 검토 중"] },
      { severity: "낮음", criteria: ["현재 이전 계획과 관련 자산 이슈가 확인되지 않음"] },
    ],
  },
  "stock-capital-gain": {
    id: "stock-capital-gain", title: "주식 양도소득 판단 기준", description: "대주주·해외주식·비상장주식 등 거래 유형을 확인합니다.",
    levels: [
      { severity: "높음", criteria: ["대주주 또는 비상장주식 거래 가능성", "해외주식 매도·지분 이전 계획"] },
      { severity: "중간", criteria: ["고액 주식 보유 또는 매도 시점 조정 필요", "가족 간 지분 이동 가능성"] },
      { severity: "낮음", criteria: ["양도 관련 거래 계획이 제한적"] },
    ],
  },
  "real-estate-tax": {
    id: "real-estate-tax", title: "부동산 세금 판단 기준", description: "보유·양도 계획과 주택 수, 법인 보유 여부를 확인합니다.",
    levels: [
      { severity: "높음", criteria: ["다주택·고가 부동산 또는 법인 보유", "양도·증여·상속 일정이 임박"] },
      { severity: "중간", criteria: ["보유세 또는 양도 계획에 대한 검토 필요", "부동산 관련 현금흐름 영향이 큼"] },
      { severity: "낮음", criteria: ["부동산 보유·양도 이슈가 제한적"] },
    ],
  },
  "tax-exempt-products": {
    id: "tax-exempt-products", title: "비과세·분리과세 상품 판단 기준", description: "개인별 한도, 자격, 보유 구조를 확인합니다.",
    levels: [
      { severity: "높음", criteria: ["절세가 최우선 목표이며 고액 과세소득 존재", "적용 상품의 자격·한도 검토가 필요"] },
      { severity: "중간", criteria: ["세후 수익률 개선을 위한 상품 구조 비교 필요"] },
      { severity: "낮음", criteria: ["현재 세제 활용 우선순위가 낮음"] },
    ],
  },
};
