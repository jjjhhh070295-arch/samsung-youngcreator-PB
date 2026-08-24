import { FALLBACK_PROXY_RETURN_ESTIMATES } from "@/lib/proxyReturns";
import type { Client } from "@/lib/types";
import { isOverseasProduct } from "./classify";
import { constraintAppliesToCategory, parseAdvisoryConstraints } from "./constraints";
import type {
  AdvisoryConstraint,
  MeasuredNumber,
  ProductCategory,
  ProductIdea,
  RecommendPlan,
  RecommendResult,
} from "./types";

interface CatalogItem {
  category: ProductCategory;
  name: string;
  ticker?: string;
  overseas: boolean;
  role: string;
  proxyKey: keyof typeof FALLBACK_PROXY_RETURN_ESTIMATES | null;
  riskNote: string;
  taxNote: string;
  liquidityNote: string;
  individualStock?: boolean;
  wrapLike?: boolean;
}

const CATALOG: CatalogItem[] = [
  {
    category: "etf",
    name: "KODEX 미국S&P500",
    ticker: "379800",
    overseas: true,
    role: "해외 핵심 성장 베타",
    proxyKey: "sp500",
    riskNote: "환율·미국 증시 변동성 노출",
    taxNote: "국내 상장 ETF 과세 체계. 세무 확정은 PB·세무 검토",
    liquidityNote: "거래소 상장, 일중 환금 가능",
  },
  {
    category: "etf",
    name: "KODEX 200",
    ticker: "069500",
    overseas: false,
    role: "국내 대표지수 핵심",
    proxyKey: "kospi",
    riskNote: "국내 경기·업종 편중 리스크",
    taxNote: "국내 상장주식·ETF 장내 과세 체계 참고",
    liquidityNote: "고유동성 상장 ETF",
  },
  {
    category: "etf",
    name: "KODEX 단기채권",
    ticker: "273130",
    overseas: false,
    role: "대기성 인컴·변동성 완충",
    proxyKey: "bond",
    riskNote: "금리 변동에 따른 평가손익",
    taxNote: "분배금 과세 가능",
    liquidityNote: "높은 환금성",
  },
  {
    category: "etf",
    name: "KODEX 미국나스닥100",
    ticker: "379810",
    overseas: true,
    role: "성장주 집중 해외 베타",
    proxyKey: "sp500",
    riskNote: "기술주 편중, 낙폭 확대 가능",
    taxNote: "국내 상장 해외 ETF 과세 참고",
    liquidityNote: "상장 ETF",
  },
  {
    category: "stock",
    name: "삼성전자",
    ticker: "005930",
    overseas: false,
    role: "국내 대표 개별주",
    proxyKey: "kospi",
    riskNote: "단일종목 비체계적 위험",
    taxNote: "대주주·양도세 요건은 확정하지 않음",
    liquidityNote: "고유동성",
    individualStock: true,
  },
  {
    category: "stock",
    name: "NVIDIA",
    ticker: "NVDA",
    overseas: true,
    role: "해외 성장 개별주",
    proxyKey: "sp500",
    riskNote: "고변동, 테마 집중",
    taxNote: "해외주식 양도세 일정은 현금흐름표 기준 참고",
    liquidityNote: "미국 정규장 기준",
    individualStock: true,
  },
  {
    category: "stock",
    name: "TSMC ADR",
    ticker: "TSM",
    overseas: true,
    role: "반도체 공급망 개별주",
    proxyKey: "sp500",
    riskNote: "환율·지정학 리스크",
    taxNote: "해외주식 과세 참고, 금액 미확정",
    liquidityNote: "ADR 유동성",
    individualStock: true,
  },
  {
    category: "els",
    name: "삼성증권 ELB 원금부분보장형(예시)",
    overseas: false,
    role: "중위험 구조화 인컴",
    proxyKey: "bond",
    riskNote: "기초자산·조기상환 조건에 따라 손실 가능. 개별 회차 조건 미확정",
    taxNote: "금융소득 과세 가능. 세액은 엔진이 확정하지 않음",
    liquidityNote: "만기 전 환금성 낮음",
  },
  {
    category: "els",
    name: "삼성증권 ELS 지수형(예시)",
    overseas: true,
    role: "중위험 수익 추구",
    proxyKey: "sp500",
    riskNote: "낙인·리베리어 리스크. 상품 조건은 PB 확인",
    taxNote: "배당·기타소득 가능, 세액 미확정",
    liquidityNote: "중도환매 제약",
  },
  {
    category: "bond",
    name: "국고채 3년 직접투자",
    overseas: false,
    role: "금리 인컴·안정 버킷",
    proxyKey: "bond",
    riskNote: "금리 상승 시 평가손실",
    taxNote: "이자소득 과세. 세액 미확정",
    liquidityNote: "장내·장외 매도 가능하나 가격 변동",
  },
  {
    category: "bond",
    name: "USD 단기국채 ETF 대체 버킷",
    ticker: "SHV",
    overseas: true,
    role: "달러 유동성",
    proxyKey: "dollar",
    riskNote: "환율 변동",
    taxNote: "해외자산 과세 참고",
    liquidityNote: "높은 환금성",
  },
  {
    category: "pension",
    name: "KODEX 연금 미국S&P500",
    overseas: true,
    role: "연금계좌 성장 코어",
    proxyKey: "sp500",
    riskNote: "계좌 한도·중도인출 제약",
    taxNote: "과세이연. 세액공제 금액은 확정하지 않음",
    liquidityNote: "연금 수령 전까지 환금성 제한",
  },
  {
    category: "pension",
    name: "KODEX 연금 단기채권",
    overseas: false,
    role: "연금 안전자산 한도 충족",
    proxyKey: "bond",
    riskNote: "인플레 대비 실질수익 낮을 수 있음",
    taxNote: "IRP 안전자산 비율 규제 참고",
    liquidityNote: "연금 계좌 제약",
  },
  {
    category: "trust",
    name: "삼성증권 일임형 랩 안정",
    overseas: false,
    role: "신탁/랩 안정 운용",
    proxyKey: "bond",
    riskNote: "일임 성과는 시장·운용에 따라 변동",
    taxNote: "신탁 과세 구조는 계약서 기준, 세액 미확정",
    liquidityNote: "환매 일정·중도해지 비용 확인",
    wrapLike: true,
  },
  {
    category: "trust",
    name: "삼성증권 일임형 랩 균형",
    overseas: true,
    role: "신탁/랩 분산 성장",
    proxyKey: "sp500",
    riskNote: "주식 편입에 따른 평가손익",
    taxNote: "세액 미확정",
    liquidityNote: "일임 계약 환매 조건",
    wrapLike: true,
  },
  {
    category: "trust",
    name: "맞춤형 자산관리 신탁",
    overseas: false,
    role: "개별 목적·지급조건을 반영하는 신탁 구조",
    proxyKey: null,
    riskNote: "계약 목적·편입재산·수탁 범위에 따라 손실과 법률 위험이 달라짐",
    taxNote: "신탁 계약·수익자 구조별 세무 검토 필요",
    liquidityNote: "계약상 인출·중도해지 조건 확인",
    wrapLike: false,
  },
  {
    category: "trust",
    name: "일반형 자산관리 신탁",
    overseas: false,
    role: "표준 계약 조건을 가정한 자산관리 신탁 구조",
    proxyKey: null,
    riskNote: "신탁이라는 명칭이 원금보장을 뜻하지 않음",
    taxNote: "편입재산과 수익자에 따른 세무 검토 필요",
    liquidityNote: "계약상 인출·중도해지 조건 확인",
    wrapLike: false,
  },
  {
    category: "trust",
    name: "유언대용 자산승계 신탁",
    overseas: false,
    role: "생전 관리와 사후 지급 조건을 설계하는 신탁 구조",
    proxyKey: null,
    riskNote: "가족 이해관계·의사능력·계약 변경 가능성에 대한 법률 검토 필요",
    taxNote: "상속·증여·소득 과세를 세무 전문가와 확인",
    liquidityNote: "위탁자 생전 인출 및 사후 지급 조건 확인",
    wrapLike: false,
  },
];

function measuredReturn(item: CatalogItem, asOf: string): MeasuredNumber | null {
  if (!item.proxyKey) return null;
  return {
    value: FALLBACK_PROXY_RETURN_ESTIMATES[item.proxyKey],
    unit: "%",
    asOf,
    source: `proxy:${item.proxyKey}:fallback`,
  };
}

function scoreItem(item: CatalogItem, c: AdvisoryConstraint, client: Client): number {
  let score = 1;
  if (c.overseasOnly && item.overseas) score += 3;
  if (c.preferIndividualStocks && item.individualStock) score += 3;
  if (c.categoryOnly === "wrap" && item.wrapLike) score += 4;
  if (c.categoryOnly === "trust" && item.category === "trust" && !item.wrapLike) score += 4;
  if (c.minExpectedReturn && item.proxyKey) {
    const r = FALLBACK_PROXY_RETURN_ESTIMATES[item.proxyKey];
    if (r >= c.minExpectedReturn) score += 3;
    else score -= 2;
  }
  const risk = client.ips?.risk?.score ?? 3;
  if (risk <= 2 && (item.category === "bond" || item.category === "trust" && item.name.includes("안정"))) score += 2;
  if (risk >= 4 && (item.category === "stock" || item.category === "etf")) score += 2;
  const tax = client.ips?.tax?.score ?? 3;
  if (tax >= 4 && (item.category === "pension" || /비과세|과세이연/.test(item.taxNote))) score += 1;
  return score;
}

function toIdea(item: CatalogItem, client: Client, asOf: string, range: string): ProductIdea {
  const taxEvents = (client.cashFlows ?? [])
    .filter((f) => f.amount < 0 && /세|tax|증여|상속|양도/.test(`${f.label} ${f.category ?? ""}`))
    .slice(0, 2)
    .map((f) => `${f.label}(${f.date})`);
  return {
    category: item.category,
    isOverseas: item.overseas,
    productStructure: item.category === "trust" ? (item.wrapLike ? "wrap" : "trust") : "other",
    name: item.name,
    ticker: item.ticker,
    role: item.role,
    fitReason: `${client.name} RRTTLLU·현금흐름·상담조건에 맞춘 후보. 비중은 미확정.`,
    expectedReturnBand: item.proxyKey
      ? `시장 proxy ${FALLBACK_PROXY_RETURN_ESTIMATES[item.proxyKey]}% (확정 수익 아님)`
      : "엔진 미산출",
    expectedReturnPct: measuredReturn(item, asOf),
    riskNote: item.riskNote,
    taxNote: taxEvents.length
      ? `${item.taxNote} · 일정 참고: ${taxEvents.join(", ")}`
      : item.taxNote,
    liquidityNote: item.liquidityNote,
    suggestedWeightRange: range,
  };
}

function pick(
  items: CatalogItem[],
  count: number,
): CatalogItem[] {
  return items.slice(0, Math.max(count, 0));
}

export function buildRecommendResult(
  client: Client,
  extraConstraintText: string,
  asOf = new Date().toISOString(),
): RecommendResult {
  const constraints = parseAdvisoryConstraints(
    extraConstraintText,
    client.consultationNotes,
    client.ips?.unique?.value,
    client.ips?.return?.value,
    client.ips?.risk?.value,
    client.ips?.tax?.value,
    client.ips?.liquidity?.value,
  );

  const eligible = CATALOG.filter((item) =>
    constraintAppliesToCategory(constraints, item.category, item.overseas || isOverseasProduct(item.name, item.ticker)),
  ).filter((item) => {
    if (constraints.categoryOnly === "wrap") return item.wrapLike === true;
    if (constraints.categoryOnly === "trust") return item.category === "trust" && item.wrapLike !== true;
    return true;
  }).filter((item) => {
    if (constraints.preferIndividualStocks && constraints.categoryOnly == null && constraints.overseasOnly) {
      return item.individualStock || item.category === "stock" || item.category === "etf";
    }
    return true;
  }).filter((item) => {
    if (constraints.minExpectedReturn == null) return true;
    if (!item.proxyKey) return false;
    return FALLBACK_PROXY_RETURN_ESTIMATES[item.proxyKey] >= constraints.minExpectedReturn;
  });

  const ranked = eligible
    .map((item) => ({ item, score: scoreItem(item, constraints, client) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);

  const hasStrictConstraint =
    constraints.categoryOnly != null ||
    constraints.overseasOnly ||
    constraints.minExpectedReturn != null;
  const pool = ranked.length > 0
    ? ranked
    : hasStrictConstraint
      ? []
      : CATALOG.filter((item) => item.wrapLike || item.category === "trust");

  const constraintNote =
    constraints.tags.length > 0 && pool.length === 0
      ? `입력 조건을 충족한다고 확인된 교육용 후보 없음: ${constraints.tags.join(", ")}`
      : constraints.tags.length > 0
        ? `조건 참고 정렬(충족 여부 재확인): ${constraints.tags.join(", ")}`
        : "추가 제약 없음. RRTTLLU·현금흐름·상담메모 기준으로 후보를 구성";

  const weightDisclaimer =
    "비중·세금·VaR/CVaR는 계산 규칙 기준의 초안이며 PB 검토 전에는 확정되지 않습니다.";

  const mkPlan = (id: RecommendPlan["id"], label: string, posture: RecommendPlan["posture"], items: CatalogItem[], ranges: string[]): RecommendPlan => ({
    id,
    label,
    posture,
    products: items.map((item, i) => toIdea(item, client, asOf, ranges[i] ?? "PB 확정")),
    constraintNote,
    weightDisclaimer,
  });

  const stable = pick(
    pool.filter((i) => i.category === "bond" || i.category === "trust" || i.name.includes("단기") || i.name.includes("안정") || i.category === "pension"),
    4,
  );
  const growth = pick(
    pool.filter((i) => i.category === "stock" || i.category === "etf" || i.name.includes("성장") || i.category === "els"),
    4,
  );
  const balanced = pick(pool, 5);

  const plans: RecommendPlan[] = [
    mkPlan("A", "A안 · 안정", "안정", stable.length ? stable : pick(pool, 3), ["15~30%", "10~25%", "10~20%", "잔여"]),
    mkPlan("B", "B안 · 균형", "균형", balanced.length ? balanced : pick(pool, 4), ["20~35%", "15~25%", "10~20%", "5~15%", "잔여"]),
    mkPlan("C", "C안 · 성장", "성장", growth.length ? growth : pick(pool, 3), ["25~40%", "15~30%", "10~20%", "잔여"]),
  ];

  if (constraints.categoryOnly === "trust" || constraints.categoryOnly === "wrap") {
    const onlyTrust = pool.filter((item) =>
      constraints.categoryOnly === "wrap"
        ? item.wrapLike === true
        : item.category === "trust" && item.wrapLike !== true,
    );
    plans.forEach((plan, idx) => {
      const slice = onlyTrust.length ? [onlyTrust[idx % onlyTrust.length], ...onlyTrust.filter((_, i) => i !== idx % onlyTrust.length)] : onlyTrust;
      plan.products = slice.map((item, i) => toIdea(item, client, asOf, ["핵심", "보완", "위성"][i] ?? "PB 확정"));
    });
  }

  if (constraints.preferIndividualStocks) {
    for (const plan of plans) {
      const stocks = pool.filter((i) => i.individualStock);
      const rest = plan.products.filter((p) => p.category !== "els");
      const stockIdeas = stocks.map((item, i) => toIdea(item, client, asOf, ["핵심 개별주", "위성 개별주", "보완"][i] ?? "PB 확정"));
      plan.products = [...stockIdeas, ...rest].slice(0, 5);
    }
  }

  const facts = [
    `고객=${client.name}`,
    `자산규모=${client.assetSize}`,
    `위험점수=${client.ips?.risk?.score ?? "null"}`,
    `목표수익=${client.ips?.return?.value || "미입력"}`,
    `제약=${constraints.tags.join("|") || "없음"}`,
    `세금일정수=${(client.cashFlows ?? []).filter((f) => /세/.test(f.label)).length}`,
  ];

  return {
    asOf,
    source: "deterministic-catalog+rrttllu+cashflow",
    currency: "KRW",
    constraints,
    plans,
    narrativePromptFacts: facts,
    disclaimers: [
      "참고용이며 투자 권유가 아닙니다.",
      "기대수익률은 시장 proxy 참고치이며 보장되지 않습니다.",
      weightDisclaimer,
    ],
    citations: [
      {
        sourceId: "catalog-deterministic",
        title: "결정론 상품 카탈로그 + RRTTLLU/현금흐름",
        asOf: asOf.slice(0, 10),
        chunkId: "recommend-catalog-v1",
      },
      {
        sourceId: "proxy-returns",
        title: "자산군 proxy 수익률 (결정론, 미보장)",
        asOf: asOf.slice(0, 10),
        chunkId: "proxy-return-v1",
      },
    ],
  };
}
