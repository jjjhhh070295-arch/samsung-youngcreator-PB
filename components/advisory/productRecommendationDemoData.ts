export type DemoProductStatus = "demo_available" | "demo_review" | "demo_blocked";

export interface ProductDetailSection {
  title: string;
  items: string[];
}

export interface DemoSaleProduct {
  id: string;
  name: string;
  classification: {
    vehicle: string;
    offering: string;
    strategy: string;
  };
  status: DemoProductStatus;
  statusLabel: string;
  summary: string;
  marketContext: string;
  fitHypothesis: string;
  eligibility: string;
  minimumInvestment: string;
  riskGrade: string;
  maximumLoss: string;
  liquidity: string;
  fees: string;
  documentStatus: string;
  source: string;
  blockReason?: string;
  sections: ProductDetailSection[];
}

export interface ProductGuide {
  id: string;
  title: string;
  shortDescription: string;
  plainLanguage: string;
  caution: string;
  sections: ProductDetailSection[];
}

export const DEMO_CATALOG_AS_OF = "2026-08-22";

export const DEMO_SALE_PRODUCTS: DemoSaleProduct[] = [
  {
    id: "demo-multi-asset-wrap",
    name: "글로벌 멀티에셋 인컴 랩 (데모)",
    classification: {
      vehicle: "투자일임계약(가정)",
      offering: "교육용 가상 시나리오",
      strategy: "글로벌 멀티에셋 인컴",
    },
    status: "demo_available",
    statusLabel: "가상 시나리오: 상담 가능",
    summary: "주식·채권·현금성 자산을 나누어 운용하는 교육용 가상 일임 상품입니다.",
    marketContext: "금리와 주식 변동성이 함께 움직일 수 있는 국면에서 자산군 분산의 필요성을 설명하기 위한 예시입니다.",
    fitHypothesis: "정기 현금흐름과 변동성 완화를 함께 검토하는 고객을 가정한 교육용 가설입니다.",
    eligibility: "일반·전문 구분 확인 필요(가정)",
    minimumInvestment: "미연동",
    riskGrade: "미연동 — 실제 위험등급 확인 필요",
    maximumLoss: "원금 전액 손실 가능",
    liquidity: "중도해지 조건 미연동",
    fees: "총비용 미연동",
    documentStatus: "교육용 문서 v0.1 · 실제 승인 없음",
    source: "합성 데모 데이터",
    sections: [
      {
        title: "구조",
        items: [
          "고객 계좌 안에서 여러 자산을 일임 운용하는 상황을 가정합니다.",
          "실제 편입자산·운용사·수수료·계약기간은 연결되어 있지 않습니다.",
        ],
      },
      {
        title: "주요 손실 가능성",
        items: [
          "분산투자도 원금손실을 막아주지는 않습니다.",
          "금리·주가·환율이 동시에 불리하게 움직이면 손실이 커질 수 있습니다.",
        ],
      },
      {
        title: "PB 확인 질문",
        items: ["필요 현금의 시점과 금액은 무엇인가?", "중도해지 조건과 총비용을 확인했는가?"],
      },
    ],
  },
  {
    id: "demo-private-reit-fof",
    name: "공모 사모재간접 대체인컴 펀드 (데모)",
    classification: {
      vehicle: "집합투자기구(가정)",
      offering: "공모·사모재간접(가정)",
      strategy: "대체인컴",
    },
    status: "demo_review",
    statusLabel: "가상 시나리오: 추가 확인 필요",
    summary: "여러 사모 대체펀드에 나누어 투자하는 구조를 설명하기 위한 교육용 가상 상품입니다.",
    marketContext: "전통 주식·채권 외의 현금흐름원을 찾는 상황을 설명하되, 기초자산 유동성과 평가주기 차이를 함께 점검해야 합니다.",
    fitHypothesis: "장기 투자와 낮은 환금성을 감수할 수 있는 고객인지 먼저 확인해야 하는 교육용 사례입니다.",
    eligibility: "가입자격 미연동",
    minimumInvestment: "미연동",
    riskGrade: "미연동 — 고난도 여부 상품별 확인",
    maximumLoss: "원금 전액 손실 가능",
    liquidity: "기초펀드·상위펀드 환매주기 미연동",
    fees: "이중 비용 포함 총비용 미연동",
    documentStatus: "교육용 문서 v0.1 · 실제 승인 없음",
    source: "합성 데모 데이터",
    sections: [
      {
        title: "구조",
        items: [
          "공모펀드가 여러 사모펀드에 투자하는 이중 구조를 가정합니다.",
          "분산 효과가 있을 수 있지만 기초 사모펀드의 정보와 환매 조건을 직접 확인하기 어려울 수 있습니다.",
        ],
      },
      {
        title: "주요 손실 가능성",
        items: [
          "기초자산 평가가 늦거나 추정가격에 의존할 수 있습니다.",
          "공모펀드와 기초 사모펀드 양쪽의 비용·유동성 제약이 겹칠 수 있습니다.",
        ],
      },
      {
        title: "추가 확인",
        items: ["교육용 상품설명서 최신 여부", "기초펀드 환매주기와 공모펀드 환매주기의 불일치 여부"],
      },
    ],
  },
  {
    id: "demo-private-infra",
    name: "일반 사모집합투자기구·인프라 전략 (데모)",
    classification: {
      vehicle: "일반 사모집합투자기구(가정)",
      offering: "사모(가정)",
      strategy: "대체·인프라",
    },
    status: "demo_blocked",
    statusLabel: "고객 제안 차단",
    summary: "비상장 인프라 자산의 장기 현금흐름을 가정한 교육용 가상 상품입니다.",
    marketContext: "장기 인컴을 설명할 수 있지만 평가 불확실성·레버리지·환율·정책 위험을 먼저 점검해야 합니다.",
    fitHypothesis: "고객 투자자 구분과 장기 유동성 수요가 확인되지 않아 현재 고객 제안이 차단된 사례입니다.",
    eligibility: "투자자격 미확인",
    minimumInvestment: "미연동",
    riskGrade: "미연동 — 고난도 여부 상품별 확인",
    maximumLoss: "원금 전액 손실 가능",
    liquidity: "장기 폐쇄형 가정 · 실제 락업 미연동",
    fees: "보수·성과보수·기타비용 미연동",
    documentStatus: "교육용 문서 v0.1 · 실제 승인 없음",
    source: "합성 데모 데이터",
    blockReason: "고객 투자자 구분·최소 투자금액·장기 환금성 수용 여부를 확인하지 않았습니다.",
    sections: [
      {
        title: "구조",
        items: [
          "비상장 인프라 지분·대출 등에 투자하는 장기 폐쇄형 구조를 가정합니다.",
          "실제 투자대상·운용사·만기·최소가입금액 정보는 연결되어 있지 않습니다.",
        ],
      },
      {
        title: "주요 손실 가능성",
        items: [
          "중도매각이 어렵고 평가가격이 실제 매각가격과 다를 수 있습니다.",
          "차입, 공사 지연, 운영수입 감소, 규제 변화로 원금 전액 손실 가능성이 있습니다.",
        ],
      },
      {
        title: "차단 해제 전 확인",
        items: ["투자자 자격과 최소 투자금액", "만기까지 필요한 생활·세금·증여 현금", "최악 손실 시나리오 설명 기록"],
      },
    ],
  },
];

export const PRODUCT_GUIDES: ProductGuide[] = [
  {
    id: "private-fund",
    title: "사모펀드",
    shortDescription: "소수 투자자를 대상으로 사적으로 자금을 모아 운용하는 펀드 유형입니다.",
    plainLanguage: "여러 사람이 함께 투자하지만, 일반 공모펀드보다 가입 대상과 정보 공개 범위가 제한될 수 있는 공동 투자 상자입니다.",
    caution: "‘사모’는 안전하다는 뜻이 아닙니다. 상품별 전략·레버리지·환매·평가 방법이 크게 다릅니다.",
    sections: [
      {
        title: "PB가 먼저 볼 것",
        items: ["누가 가입할 수 있는가", "무엇에 투자하는가", "언제 현금화할 수 있는가", "누가 어떤 방식으로 가격을 평가하는가"],
      },
      {
        title: "고객에게 반드시 설명할 위험",
        items: ["원금손실", "낮은 유동성", "정보 비대칭", "레버리지·파생상품 사용 가능성", "운용인력 의존성"],
      },
    ],
  },
  {
    id: "public-private-fof",
    title: "공모 사모재간접",
    shortDescription: "공모펀드가 여러 사모펀드에 다시 투자하는 재간접 구조입니다.",
    plainLanguage: "개인이 여러 비공개 투자 상자에 직접 들어가는 대신, 하나의 공개 상자를 통해 나누어 담는 구조입니다.",
    caution: "분산이 곧 안전을 뜻하지 않으며, 이중 비용·기초펀드 정보 부족·환매 시점 불일치가 생길 수 있습니다.",
    sections: [
      {
        title: "장점으로 오해하기 쉬운 부분",
        items: ["여러 기초펀드에 투자해도 같은 위험요인에 몰릴 수 있습니다.", "공모 형식이어도 기초자산이 쉽게 현금화된다는 뜻은 아닙니다."],
      },
      {
        title: "PB 확인 질문",
        items: ["기초펀드별 비중과 중복 익스포저는?", "총보수와 성과보수는?", "기초펀드와 상위펀드의 환매주기는 맞는가?"],
      },
    ],
  },
  {
    id: "private-alternatives",
    title: "사모대체",
    shortDescription: "부동산·인프라·사모대출·비상장 지분 등 전통 주식·채권 밖의 자산에 투자합니다.",
    plainLanguage: "거래소에서 매일 가격이 보이는 자산 대신, 오래 들고 가며 사업의 현금흐름을 기다리는 투자에 가깝습니다.",
    caution: "평가가격이 매일 거래되는 시장가격이 아니며, 만기 전 현금화가 매우 어렵거나 불가능할 수 있습니다.",
    sections: [
      {
        title: "핵심 위험",
        items: ["장기 환금성 제약", "평가모형 위험", "차입과 금리 위험", "공사·운영·정책 위험", "환율 위험"],
      },
      {
        title: "고객 현금흐름과 연결",
        items: ["세금·증여·부동산 잔금 등 확정 지출 시점과 만기가 겹치지 않는지 확인합니다.", "중도매각이 안 되는 최악의 경우를 먼저 설명합니다."],
      },
    ],
  },
  {
    id: "hedge-fund",
    title: "헤지전략형 일반 사모펀드(통상 헤지펀드)",
    shortDescription: "롱·숏, 차익거래, 파생상품 등 폭넓은 전략을 사용할 수 있는 펀드 유형입니다.",
    plainLanguage: "시장 상승만 기다리지 않고 여러 방향의 전략을 쓰지만, ‘헤지’라는 이름이 손실 방지를 보장하지는 않습니다.",
    caution: "전략 복잡성·레버리지·모형 오류·거래상대방 위험으로 손실이 확대될 수 있습니다.",
    sections: [
      {
        title: "전략을 볼 때",
        items: ["수익의 원천이 무엇인가", "시장 급변 때 전략이 어떻게 깨지는가", "레버리지 한도와 손실 통제는 무엇인가"],
      },
      {
        title: "운용사를 볼 때",
        items: ["핵심 운용인력의 경력과 이탈 위험", "벤치마크와 비교기간의 적절성", "최대낙폭·회복기간·유동성 관리"],
      },
    ],
  },
  {
    id: "wrap-account",
    title: "랩어카운트",
    shortDescription: "증권사가 고객 계좌의 자산 구성을 계약 범위 안에서 일임 운용하는 서비스입니다.",
    plainLanguage: "상품 하나를 사는 것보다, 계좌 운영 방법을 맡기는 계약에 가깝습니다.",
    caution: "예금이 아니며 운용성과·수수료·매매빈도·중도해지 조건에 따라 결과가 달라집니다.",
    sections: [
      {
        title: "PB 확인 질문",
        items: ["투자일임 범위와 운용 제한은?", "총수수료와 매매비용은?", "성과 비교 기준은 적절한가?", "중도해지 조건은?"],
      },
    ],
  },
  {
    id: "trust",
    title: "신탁",
    shortDescription: "고객이 맡긴 재산을 계약 목적과 지시에 따라 관리·운용·처분하는 구조입니다.",
    plainLanguage: "재산과 해야 할 일을 계약서에 정해 믿을 수 있는 수탁자에게 맡기는 틀입니다.",
    caution: "신탁이라는 이름만으로 원금이 보장되지 않으며, 상품·유언대용·자산관리 등 목적별 계약 내용이 다릅니다.",
    sections: [
      {
        title: "PB 확인 질문",
        items: ["신탁 목적과 수익자는 누구인가", "중도해지와 재산 인출 조건은?", "보수·세금·법률 검토가 필요한 부분은?", "고객 의사능력과 가족 이해관계는?"],
      },
    ],
  },
];

export function demoProductName(name: string): string {
  const cleaned = name.replace(/\s*\(예시\)\s*/g, " ").trim();
  return cleaned.endsWith("(데모)") ? cleaned : `${cleaned} (데모)`;
}
