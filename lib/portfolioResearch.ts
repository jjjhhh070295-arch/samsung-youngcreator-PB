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

// LLM(Gemini/Claude) 분석 신호 — 방향(±)·강도까지 담는다(키워드 signals 보강).
export interface AnalyzedSignalLite {
  signal: ResearchSignal;
  direction: -1 | 0 | 1;
  strength: number; // 0~5
}

export interface MarketResearchItem {
  id: string;
  title: string;
  source: string;
  url: string;
  date?: string;
  excerpt?: string;
  signals: ResearchSignal[];
  // 캐시된 LLM 분석이 있으면 채워짐(/api/research가 주입). 있으면 가중치 계산이 방향·강도를 반영.
  analysis?: AnalyzedSignalLite[];
  /** Top Pick canonical ingestion metadata. 기존 리서치 탭은 이 필드를 무시한다. */
  documentType?: "STOCK" | "MARKET" | "INDUSTRY" | "MACRO";
  broker?: string | null;
  analyst?: string | null;
}

export interface ResearchSignalScore {
  signal: ResearchSignal;
  score: number;
  label: string;
}

export const RESEARCH_SOURCES: ResearchSource[] = [
  {
    name: "네이버 금융 기업분석 리포트",
    url: "https://finance.naver.com/research/company_list.naver",
    category: "report",
  },
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
    // 날짜 파라미터를 빼면 최근 3개월이 기본으로 잡혀 최신 리포트가 나온다(기존 2023 날짜 하드코딩 제거).
    url: "https://securities.koreainvestment.com/main/research/research/Strategy.jsp?jkGubun=6&category1=02&category2=01",
    category: "strategy",
  },
  {
    name: "미래에셋증권 리서치",
    url: "https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521",
    category: "report",
  },
  {
    name: "하나증권 리서치",
    url: "https://www.hanaw.com/main/research/research/list.cmd",
    category: "strategy",
  },
  {
    name: "한경 컨센서스",
    url: "https://consensus.hankyung.com/analysis/list",
    category: "market",
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

// 리포트 날짜로 최신성 가중치 — 오래될수록 영향 감소(가산점 하락). 날짜 없으면 중간값.
export function dateRecencyWeight(date?: string | null): number {
  if (!date) return 2;
  const t = new Date(date).getTime();
  if (isNaN(t)) return 2;
  const days = (Date.now() - t) / 86_400_000;
  if (days <= 7) return 4; // 1주 이내
  if (days <= 14) return 3; // 2주 이내
  if (days <= 30) return 2; // 1달 이내
  return 1; // 그 이상(하한 통과분) — 최소 가중
}

// 리포트 수집·집계 공통 시간 윈도우.
// 크롤 단계(withinAgeFloor)와 스냅샷 DB 쿼리가 동일 값을 참조해 "화면 = 백테스트" 일치를 보장.
export const WINDOW_DAYS = 30;

// 스냅샷에 기록되는 점수 계산 알고리즘 버전.
// 로직이 바뀔 때마다 이 값만 올리면 백테스트 시 버전별로 분리 가능.
//
// 버전 이력:
//   v1-legacy              position-based recency weight, 소스 캡 없음
//   v2-normalized-capfactor MAX_SOURCE_WEIGHT=0.25 캡 + pre-cap 절댓값 가중평균 정규화 × SIGNAL_SCALE=10
//   v3-capfactor-unified   스냅샷 route도 scoreResearchSignals 통일 — 화면 = 백테스트 점수 일치
export const SCORING_VERSION = "v3-capfactor-unified" as const;

// 단일 소스가 해당 자산군 점수에서 차지할 수 있는 최대 비중.
// 절댓값 기준으로 초과분은 버림 — 재배분 없음 (재배분 시 소수 소스 과잉 증폭 발생).
const MAX_SOURCE_WEIGHT = 0.25;

// 정규화 후 출력 스케일.
// capFactor(컨센서스 강도) ∈ [-1, +1] 를 이 값으로 스케일해서 최종 점수를 만든다.
// ≥5 = 50% 컨센서스(ETF 바스켓), ≥8 = 80% 컨센서스(고위험 신호) — 기존 임계값 그대로 유지.
const SIGNAL_SCALE = 10;

export function scoreResearchSignals(items: MarketResearchItem[]): ResearchSignalScore[] {
  // 1단계: signal → source → 가중 합산
  const sourceScores = new Map<ResearchSignal, Map<string, number>>();

  items.forEach((item) => {
    const recencyWeight = dateRecencyWeight(item.date);
    const source = item.source.split(" · ")[0]; // 증권사명만 추출 (지점·팀 제거)

    if (item.analysis && item.analysis.length > 0) {
      for (const a of item.analysis) {
        if (!sourceScores.has(a.signal)) sourceScores.set(a.signal, new Map());
        const bySource = sourceScores.get(a.signal)!;
        bySource.set(source, (bySource.get(source) ?? 0) + a.direction * a.strength * recencyWeight);
      }
    } else {
      item.signals.forEach((signal) => {
        if (!sourceScores.has(signal)) sourceScores.set(signal, new Map());
        const bySource = sourceScores.get(signal)!;
        bySource.set(source, (bySource.get(source) ?? 0) + recencyWeight);
      });
    }
  });

  // 2단계: 소스 비중 캡 → 정규화 → signal별 최종 점수
  //
  // 정규화 방식: cappedSum / totalAbsBeforeCap (pre-cap 절댓값 가중평균)
  //   소스가 집중될수록 cap이 cappedSum을 줄이지만 분모는 고정 → capFactor↓
  //   소스가 고르게 분산될수록 cap이 거의 안 발동 → capFactor ≈ 1.0
  //   결과: "컨센서스 강도" [-1, +1] × SIGNAL_SCALE → 출력 점수
  const scores = new Map<ResearchSignal, number>();

  for (const [signal, bySource] of Array.from(sourceScores.entries())) {
    const totalAbsBeforeCap = Array.from(bySource.values()).reduce((s, v) => s + Math.abs(v), 0);
    let cappedSum = 0;
    const logParts: string[] = [];
    const cappedParts: string[] = [];

    for (const [src, raw] of Array.from(bySource.entries())) {
      const share = totalAbsBeforeCap > 0 ? Math.abs(raw) / totalAbsBeforeCap : 0;
      logParts.push(`${src}:${raw.toFixed(1)}(${(share * 100).toFixed(0)}%)`);
      if (share > MAX_SOURCE_WEIGHT) {
        const capped = Math.sign(raw) * totalAbsBeforeCap * MAX_SOURCE_WEIGHT;
        cappedParts.push(`${src} ${raw.toFixed(1)}→${capped.toFixed(1)}`);
        cappedSum += capped;
      } else {
        cappedSum += raw;
      }
    }

    const capFactor = totalAbsBeforeCap > 0 ? cappedSum / totalAbsBeforeCap : 0;
    const scaledScore = capFactor * SIGNAL_SCALE;

    console.log(
      `[scoreResearch][${signal}] ${logParts.join(" ")}` +
      (cappedParts.length > 0
        ? ` | CAP: ${cappedParts.join(", ")} → factor=${capFactor.toFixed(3)} score=${scaledScore.toFixed(1)}`
        : ` | no cap → factor=${capFactor.toFixed(3)} score=${scaledScore.toFixed(1)}`),
    );

    scores.set(signal, scaledScore);
  }

  return (Object.keys(SIGNAL_LABELS) as ResearchSignal[])
    .map((signal) => ({
      signal,
      // [-SIGNAL_SCALE, +SIGNAL_SCALE] 클램프. 최종 비중은 normalizeOptionWeights가 0~100으로 정규화.
      score: Math.max(-SIGNAL_SCALE, Math.min(SIGNAL_SCALE, Math.round(scores.get(signal) ?? 0))),
      label: SIGNAL_LABELS[signal],
    }))
    .sort((a, b) => b.score - a.score);
}
