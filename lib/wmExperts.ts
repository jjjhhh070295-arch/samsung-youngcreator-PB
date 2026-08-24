export interface WmExpert {
  id: string; name: string; title: string; center: string; region: string; phone: string; email: string; specialties: string[];
}

export const WM_EXPERTS: WmExpert[] = [
  { id: "kim-tax", name: "김세무", title: "삼성증권 강남WM센터 패밀리오피스 세무전문가", center: "삼성증권 강남WM센터", region: "서울 강남", phone: "010-XXXX-XXXX", email: "kim.tax.advisor@gmail.com", specialties: ["상속·증여", "가업승계"] },
  { id: "lee-realty", name: "이부동", title: "삼성증권 서초WM센터 부동산 세무전문가", center: "삼성증권 서초WM센터", region: "서울 서초", phone: "010-XXXX-XXXX", email: "lee.realestate.wm@gmail.com", specialties: ["부동산 보유", "양도세"] },
  { id: "park-finance", name: "박금융", title: "삼성증권 중구WM센터 금융소득 세무전문가", center: "삼성증권 중구WM센터", region: "서울 중구", phone: "010-XXXX-XXXX", email: "park.finance.wm@gmail.com", specialties: ["금융소득", "주식 양도"] },
  { id: "choi-wm", name: "최자산", title: "삼성증권 강남WM센터 종합 자산관리전문가", center: "삼성증권 강남WM센터", region: "서울 강남", phone: "010-XXXX-XXXX", email: "choi.wealth.wm@gmail.com", specialties: ["종합 세무", "자산관리"] },
];

export function expertForTaxPain(id: string): WmExpert {
  const expertId = id === "inheritance-gift" ? "kim-tax" : id === "real-estate-tax" ? "lee-realty" : ["financial-income", "stock-capital-gain"].includes(id) ? "park-finance" : "choi-wm";
  return WM_EXPERTS.find((expert) => expert.id === expertId) ?? WM_EXPERTS[3];
}

// 헤리티지(상속·증여) 탭에서 쓰는 전문가 추천 — 상속·증여 태그를 가진 전문가를 우선한다.
export function expertForHeritage(): WmExpert {
  return WM_EXPERTS.find((expert) => expert.specialties.includes("상속·증여")) ?? WM_EXPERTS[3];
}
