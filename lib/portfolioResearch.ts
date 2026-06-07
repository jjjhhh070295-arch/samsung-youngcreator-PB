export type ResearchSignal =
  | "equity"
  | "bond"
  | "liquidity"
  | "dollar"
  | "gold"
  | "risk"
  | "tax";

export interface ResearchSource {
  name: string;
  url: string;
  category: "market" | "strategy" | "report";
}

export interface MarketResearchItem {
  id: string;
  title: string;
  source: string;
  url: string;
  date?: string;
  excerpt?: string;
  signals: ResearchSignal[];
}

export interface ResearchSignalScore {
  signal: ResearchSignal;
  score: number;
  label: string;
}

export const RESEARCH_SOURCES: ResearchSource[] = [
  {
    name: "KB증권 리서치",
    url: "https://www.kbsec.com/go.able?linkcd=m04010000",
    category: "strategy",
  },
  {
    name: "Investing.com Market Overview",
    url: "https://www.investing.com/analysis/market-overview",
    category: "market",
  },
  {
    name: "KB증권 투자전략",
    url: "https://www.kbsec.com/go.able?linkcd=m04010002",
    category: "strategy",
  },
  {
    name: "한국투자증권 리서치",
    url: "https://securities.koreainvestment.com/main/research/research/Strategy.jsp?jkGubun=6&category1=02&category2=01&jkGubun=6&focusYN=&fromDate=2023.05.19&toDate=2023.08.19&searchDate=3month&searchColumn=all&searchValue=&rowsPerPages=10&currentPage=5",
    category: "strategy",
  },
  {
    name: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    category: "report",
  },
  {
    name: "Thinkpool 미래에셋증권 리포트",
    url: "https://www.thinkpool.com/item/006800/report",
    category: "report",
  },
  {
    name: "네이버 금융 시황 리포트",
    url: "https://finance.naver.com/research/market_info_list.naver",
    category: "market",
  },
  {
    name: "네이버 금융 투자전략 리포트",
    url: "https://finance.naver.com/research/invest_list.naver",
    category: "strategy",
  },
  {
    name: "네이버 금융 경제분석 리포트",
    url: "https://finance.naver.com/research/economy_list.naver",
    category: "strategy",
  },
  {
    name: "네이버 금융 채권분석 리포트",
    url: "https://finance.naver.com/research/debenture_list.naver",
    category: "report",
  },
  {
    name: "네이버 금융 산업분석 리포트",
    url: "https://finance.naver.com/research/industry_list.naver",
    category: "report",
  },
];

export const FALLBACK_MARKET_RESEARCH: MarketResearchItem[] = [
  {
    id: "fallback-mirae-earnings-revision",
    title: "[Earnings Revision] 6월 2주차",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-06",
    excerpt: "실적 전망 변화 기반으로 업종 모멘텀을 점검하는 최신 리서치 항목입니다.",
    signals: ["equity"],
  },
  {
    id: "fallback-mirae-market-close",
    title: "한국 마켓 클로징(6월 5일): 검은 금요일",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-05",
    excerpt: "국내 증시 변동성 확대와 위험관리 필요성을 반영합니다.",
    signals: ["risk", "liquidity"],
  },
  {
    id: "fallback-mirae-oil",
    title: "월스트리트파인더 Ep.192: 유가, 기대와 현실 사이",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-05",
    excerpt: "유가와 원자재 가격 변동을 대체자산 헤지 판단에 반영합니다.",
    signals: ["gold", "risk"],
  },
  {
    id: "fallback-mirae-semi",
    title: "반도체: SOCAMM 용량 축소 논란 이슈 코멘트",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-05",
    excerpt: "AI 반도체 밸류체인의 기회와 단기 변동성을 함께 점검합니다.",
    signals: ["equity", "risk"],
  },
  {
    id: "fallback-mirae-fx",
    title: "마켓 뷰(6월 5일): 1,540원",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-05",
    excerpt: "환율 레벨 부담을 달러 비중과 환헤지 판단에 반영합니다.",
    signals: ["dollar", "risk"],
  },
  {
    id: "fallback-mirae-ai-daily",
    title: "AI 데일리 글로벌 마켓 브리핑: AI 반도체주 하락에 업종 순환매",
    source: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    date: "2026-06-05",
    excerpt: "AI 테마의 장기 성장성과 단기 순환매 리스크를 동시에 반영합니다.",
    signals: ["equity", "risk"],
  },
  {
    id: "fallback-investing-ai-wealth",
    title: "AI Is Repricing Human Value Across Wealth Management",
    source: "Investing.com Market Overview",
    url: "https://www.investing.com/analysis/market-overview",
    date: "2026-06-06",
    excerpt: "AI가 자산관리와 기업 생산성의 장기 투자 테마로 확장되는 흐름입니다.",
    signals: ["equity"],
  },
  {
    id: "fallback-investing-broadcom",
    title: "Broadcom's Whiplash: Shares Tank After Pre-Earnings Surge",
    source: "Investing.com Market Overview",
    url: "https://www.investing.com/analysis/market-overview",
    date: "2026-06-05",
    excerpt: "반도체 대형주의 급등락은 성장자산 비중을 분산해야 한다는 근거가 됩니다.",
    signals: ["equity", "risk"],
  },
  {
    id: "fallback-investing-labor-yields",
    title: "Labor Gains and Higher Treasury Yields Push Fed Rate Cuts Later Into the Year",
    source: "Investing.com Market Overview",
    url: "https://www.investing.com/analysis/market-overview",
    date: "2026-06-05",
    excerpt: "고용과 국채금리 재상승은 채권 듀레이션과 현금성 자산 비중 조절 요인입니다.",
    signals: ["bond", "liquidity", "risk"],
  },
  {
    id: "fallback-investing-tech-correction",
    title: "Tech Correction Accelerates as Semiconductors Lead the Pullback",
    source: "Investing.com Market Overview",
    url: "https://www.investing.com/analysis/market-overview",
    date: "2026-06-05",
    excerpt: "기술주 조정 국면에서는 성장형 포트폴리오에도 현금과 채권 완충이 필요합니다.",
    signals: ["equity", "risk", "liquidity"],
  },
  {
    id: "fallback-kb-model",
    title: "KB 리서치 모델 포트폴리오",
    source: "KB증권 리서치",
    url: "https://www.kbsec.com/go.able?linkcd=m04010000",
    excerpt: "국내 업종 배분과 현금 비중 판단의 보조 근거로 활용합니다.",
    signals: ["equity", "liquidity"],
  },
  {
    id: "fallback-kb-market",
    title: "KB증권 국내 및 글로벌 증시 동향",
    source: "KB증권 투자전략",
    url: "https://www.kbsec.com/go.able?linkcd=m04010002",
    excerpt: "국내외 증시 방향성과 업종별 순환매를 포트폴리오 비중 판단에 반영합니다.",
    signals: ["equity", "risk"],
  },
  {
    id: "fallback-korea-strategy",
    title: "한국투자증권 투자전략 리서치",
    source: "한국투자증권 리서치",
    url: "https://securities.koreainvestment.com/main/research/research/Strategy.jsp?jkGubun=6&category1=02&category2=01",
    excerpt: "국내외 전략 리포트의 시장 방향성을 보조 근거로 사용합니다.",
    signals: ["equity", "bond"],
  },
  {
    id: "fallback-thinkpool-report",
    title: "미래에셋증권(006800) 리포트 분석",
    source: "Thinkpool 미래에셋증권 리포트",
    url: "https://www.thinkpool.com/item/006800/report",
    excerpt: "증권업 및 미래에셋증권 관련 애널리스트 리포트 흐름을 점검합니다.",
    signals: ["equity", "tax"],
  },
];

const SIGNAL_LABELS: Record<ResearchSignal, string> = {
  equity: "주식/ETF",
  bond: "채권",
  liquidity: "현금성/단기",
  dollar: "달러",
  gold: "금/실물",
  risk: "변동성 관리",
  tax: "세후수익/절세",
};

const KEYWORDS: Record<ResearchSignal, string[]> = {
  equity: ["ai", "반도체", "tech", "테크", "주식", "증시", "earnings", "revision", "nasdaq", "s&p", "etf", "자동차"],
  bond: ["금리", "채권", "treasury", "yield", "fed", "rate", "국채", "인하", "동결"],
  liquidity: ["변동성", "조정", "하락", "현금", "mmf", "rp", "유동성", "defensive", "risk", "검은"],
  dollar: ["달러", "환율", "원/달러", "원달러", "fx", "currency", "usd"],
  gold: ["금값", "금 가격", "금리스크", "gold", "유가", "oil", "원자재", "commodity", "inflation", "물가"],
  risk: ["하락", "조정", "변동성", "risk", "pullback", "correction", "whiplash", "금요일", "논란"],
  tax: ["세금", "절세", "세후", "tax", "연금", "isa", "배당"],
};

export function inferSignals(text: string): ResearchSignal[] {
  const haystack = text.toLowerCase();
  return (Object.entries(KEYWORDS) as Array<[ResearchSignal, string[]]>)
    .filter(([, words]) => words.some((word) => haystack.includes(word.toLowerCase())))
    .map(([signal]) => signal);
}

export function scoreResearchSignals(items: MarketResearchItem[]): ResearchSignalScore[] {
  const scores = new Map<ResearchSignal, number>();
  items.forEach((item, index) => {
    const recencyWeight = Math.max(1, 4 - Math.floor(index / 5));
    item.signals.forEach((signal) => {
      scores.set(signal, (scores.get(signal) ?? 0) + recencyWeight);
    });
  });

  return (Object.keys(SIGNAL_LABELS) as ResearchSignal[])
    .map((signal) => ({
      signal,
      score: scores.get(signal) ?? 0,
      label: SIGNAL_LABELS[signal],
    }))
    .sort((a, b) => b.score - a.score);
}
