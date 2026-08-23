import { judgeCitations } from "./citations";
import { judgeRecommend } from "./control";
import type { CitationRef, GoldCase, GoldLabel, RecommendPlan, RecommendResult } from "./types";

const ASOF = "2026-08-01T00:00:00.000Z";

const OK_CITATION: CitationRef = {
  sourceId: "src-proxy-sp500",
  title: "KODEX 미국S&P500 proxy 수익률",
  asOf: "2026-08-01",
  chunkId: "chunk-sp500-1y",
};

function plan(id: "A" | "B" | "C", category: RecommendPlan["products"][0]["category"] = "etf"): RecommendPlan {
  return {
    id,
    label: `${id}안`,
    posture: id === "A" ? "안정" : id === "B" ? "균형" : "성장",
    constraintNote: "고객 조건 반영",
    weightDisclaimer: "비중은 미확정 초안 구간입니다.",
    products: [
      {
        category,
        isOverseas: category !== "trust",
        productStructure: category === "trust" ? "trust" : "other",
        name: category === "trust" ? "일임형 신탁" : "KODEX 미국S&P500",
        ticker: category === "trust" ? undefined : "379800",
        role: "핵심",
        fitReason: "IPS·현금흐름 적합",
        expectedReturnBand: "6-10%",
        expectedReturnPct: { value: 8, unit: "%", asOf: ASOF, source: "proxy-engine" },
        riskNote: "시장 변동성",
        taxNote: "세무 검토 필요",
        liquidityNote: "상장 환금",
        suggestedWeightRange: "20-40%",
      },
    ],
  };
}

function result(partial: Partial<RecommendResult> = {}): RecommendResult {
  return {
    asOf: ASOF,
    source: "deterministic-catalog",
    currency: "KRW",
    constraints: { rawText: "", categoryOnly: null, overseasOnly: false, minExpectedReturn: null, preferIndividualStocks: false, tags: [] },
    plans: [plan("A"), plan("B"), plan("C")],
    narrativePromptFacts: ["결정론 엔진 산출"],
    disclaimers: ["MVP 간이 분석"],
    ...partial,
  };
}

function gold(id: string, title: string, humanLabel: GoldLabel, notes: string, rec: RecommendResult, citations: CitationRef[]): GoldCase {
  return { id, title, humanLabel, notes, result: rec, citations };
}

/** 사람 라벨 gold set. Judge가 이 라벨을 만들지 않는다. */
export const GOLD_CASES: GoldCase[] = [
  gold("g01", "정상 추천", "pass", "메타·제약 정상", result(), [OK_CITATION]),
  gold("g02", "해외주식만", "pass", "해외 제약 태그", result({ constraints: { rawText: "해외주식만", categoryOnly: null, overseasOnly: true, minExpectedReturn: null, preferIndividualStocks: false, tags: ["해외주식만"] } }), [OK_CITATION]),
  gold("g03", "개별주식 선호", "pass", "개별주 태그", result({ constraints: { rawText: "개별주식 선호", categoryOnly: null, overseasOnly: false, minExpectedReturn: null, preferIndividualStocks: true, tags: ["개별주식 선호"] } }), [OK_CITATION]),
  gold("g04", "기대수익 20%+", "pass", "목표 수익 조건", result({ constraints: { rawText: "기대수익률 20% 이상", categoryOnly: null, overseasOnly: false, minExpectedReturn: 20, preferIndividualStocks: false, tags: ["기대수익률 20%+"] } }), [OK_CITATION]),
  gold("g05", "신탁만 준수", "pass", "신탁 필터 통과", result({
    constraints: { rawText: "신탁만 고려", categoryOnly: "trust", overseasOnly: false, minExpectedReturn: null, preferIndividualStocks: false, tags: ["신탁만"] },
    plans: [plan("A", "trust"), plan("B", "trust"), plan("C", "trust")],
  }), [OK_CITATION]),
  gold("g06", "as-of 있는 기대수익", "pass", "측정치 메타 있음", result(), [OK_CITATION]),
  gold("g07", "KRW 통화", "pass", "통화 KRW", result(), [OK_CITATION]),
  gold("g08", "출처 명시", "pass", "source 필드", result(), [OK_CITATION]),
  gold("g09", "비중 미확정", "pass", "weight 필드 없음", result(), [OK_CITATION]),
  gold("g10", "세금 미확정", "pass", "taxAmount 없음", result(), [OK_CITATION]),
  gold("g11", "A/B/C 3안", "pass", "세 안 모두 존재", result(), [OK_CITATION]),
  gold("g12", "다크 제약 문구", "pass", "조건 문구 포함", result({ constraints: { rawText: "해외주식만, 개별주식 선호", categoryOnly: null, overseasOnly: true, minExpectedReturn: null, preferIndividualStocks: true, tags: ["해외주식만", "개별주식 선호"] } }), [OK_CITATION]),
  gold("g13", "as-of 누락 차단", "block", "사람: as-of 없으면 차단", result({ asOf: "" }), [OK_CITATION]),
  gold("g14", "출처 누락 차단", "block", "사람: source 없으면 차단", result({ source: "" }), [OK_CITATION]),
  gold("g15", "통화 오류 차단", "block", "사람: USD면 차단", result({ currency: "USD" as unknown as "KRW" }), [OK_CITATION]),
  gold("g16", "신탁 누수 차단", "block", "사람: 신탁만인데 ETF 포함 차단", result({
    constraints: { rawText: "신탁만 고려", categoryOnly: "trust", overseasOnly: false, minExpectedReturn: null, preferIndividualStocks: false, tags: ["신탁만"] },
    plans: [plan("A", "etf"), plan("B", "trust"), plan("C", "trust")],
  }), [OK_CITATION]),
  gold("g17", "기대수익 as-of 누락", "block", "사람: 측정치 as-of 없으면 차단", result({
    plans: [{
      ...plan("A"),
      products: [{
        ...plan("A").products[0],
        expectedReturnPct: { value: 8, unit: "%", asOf: "", source: "proxy-engine" },
      }],
    }, plan("B"), plan("C")],
  }), [OK_CITATION]),
  gold("g18", "확정 비중 차단", "block", "사람: AI 확정 weight 차단", {
    ...result(),
    plans: result().plans,
    narrativePromptFacts: ['{"weight": 30}'],
  }, [OK_CITATION]),
  gold("g19", "확정 세액 차단", "block", "사람: taxAmount 확정 차단", result({
    narrativePromptFacts: ["확정 세액 1200000"],
  }), [OK_CITATION]),
  gold("g20", "빈 플랜 경계", "pass", "플랜은 있으나 상품 최소", result(), [OK_CITATION]),
  gold("g21", "운영실패: 인용 메타 없음", "block", "운영 중 발견 — 텍스트만 있고 sourceId/chunkId 없음", result(), [
    { sourceId: "", title: "뉴스 요약", asOf: "", chunkId: "" },
  ]),
  gold("g22", "운영실패: 출처 청크 누락", "block", "운영 중 발견 — title만 있고 chunkId 없음", result(), [
    { sourceId: "src-news", title: "시장 코멘트", asOf: "2026-08-01", chunkId: "" },
  ]),
];

export interface ConfusionMatrix {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  agreementPct: number;
  disagreements: Array<{ id: string; title: string; human: GoldLabel; judge: GoldLabel; notes: string }>;
}

export function evaluateGoldSet(cases: GoldCase[] = GOLD_CASES): ConfusionMatrix {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  const disagreements: ConfusionMatrix["disagreements"] = [];

  for (const c of cases) {
    const rec = judgeRecommend(c.result);
    const cit = judgeCitations(c.citations);
    const judgeLabel: GoldLabel = rec.passed && cit.passed ? "pass" : "block";
    if (c.humanLabel === "pass" && judgeLabel === "pass") tp += 1;
    else if (c.humanLabel === "block" && judgeLabel === "block") tn += 1;
    else if (c.humanLabel === "block" && judgeLabel === "pass") {
      fp += 1;
      disagreements.push({ id: c.id, title: c.title, human: c.humanLabel, judge: judgeLabel, notes: c.notes });
    } else {
      fn += 1;
      disagreements.push({ id: c.id, title: c.title, human: c.humanLabel, judge: judgeLabel, notes: c.notes });
    }
  }

  const total = cases.length || 1;
  return {
    tp,
    tn,
    fp,
    fn,
    agreementPct: Math.round(((tp + tn) / total) * 1000) / 10,
    disagreements,
  };
}
