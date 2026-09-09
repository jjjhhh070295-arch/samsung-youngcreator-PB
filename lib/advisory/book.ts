import type { Client, Consultation } from "@/lib/types";
import { classifyProduct } from "./classify";
import { assessHeritage, URGENCY_RANK } from "@/lib/heritage";
import type { HeritageAssessmentInput } from "@/lib/heritage";
import type {
  BookAnalysis,
  BookHolding,
  ClientBookRow,
  ClientFlag,
  HoldingChip,
  MeasuredNumber,
  ProductMixSlice,
  ProductRankItem,
  RiskGrade,
} from "./types";
import { calcPortfolioUnrealizedReturn } from "./portfolioReturn";

function measured(value: number, unit: string, asOf: string, source: string, currency?: string): MeasuredNumber {
  return { value, unit, asOf, source, currency };
}

export function riskGradeFromScore(score: number | null): RiskGrade {
  if (score == null) return "위험중립";
  if (score <= 1) return "안정";
  if (score === 2) return "안정추구";
  if (score === 3) return "위험중립";
  if (score === 4) return "적극";
  return "공격";
}

export function evalHolding(h: {
  quantity: number;
  avgPrice: number | null;
  lastPrice: number | null;
  currency: string;
}): { evalAmount: number; returnPct: number | null } {
  // 평가액 표시: 시세 없으면 취득원가로 폴백. 수익률은 시세가 있을 때만.
  const px = h.lastPrice != null && h.lastPrice > 0 ? h.lastPrice : h.avgPrice ?? 0;
  const evalAmount = Math.round(h.quantity * px);
  const returnPct =
    h.avgPrice && h.avgPrice !== 0 && h.lastPrice != null && h.lastPrice > 0
      ? ((h.lastPrice - h.avgPrice) / h.avgPrice) * 100
      : null;
  return { evalAmount, returnPct };
}

export function toBookHolding(
  row: {
    id: string;
    clientId: string;
    name: string;
    ticker: string | null;
    market?: string | null;
    currency?: string;
    quantity: number;
    avgPrice: number | null;
    lastPrice?: number | null;
  },
  asOf: string,
  source: string,
): BookHolding {
  const lastPrice = row.lastPrice != null && row.lastPrice > 0 ? row.lastPrice : null;
  const { evalAmount, returnPct } = evalHolding({
    quantity: row.quantity,
    avgPrice: row.avgPrice,
    lastPrice,
    currency: row.currency ?? "KRW",
  });
  return {
    id: row.id,
    clientId: row.clientId,
    name: row.name,
    ticker: row.ticker,
    market: row.market ?? null,
    currency: row.currency ?? "KRW",
    quantity: row.quantity,
    avgPrice: row.avgPrice,
    lastPrice,
    evalAmount,
    returnPct,
    category: classifyProduct(row.name, row.ticker),
    asOf,
    source,
  };
}

function notesPreview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 80)}…` : t;
}

function cashNeed12m(client: Client): number {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setFullYear(horizon.getFullYear() + 1);
  return (client.cashFlows ?? [])
    .filter((flow) => flow.amount < 0)
    .filter((flow) => {
      const d = new Date(`${flow.date.length === 7 ? `${flow.date}-01` : flow.date}T00:00:00`);
      if (Number.isNaN(d.getTime())) return flow.recurring;
      return d <= horizon;
    })
    .reduce((sum, flow) => {
      const months = flow.recurring ? 12 : 1;
      return sum + Math.abs(flow.amount) * months;
    }, 0);
}

export function buildClientBookRow(
  client: Client,
  holdings: BookHolding[],
  consultations: Consultation[],
  asOf: string,
  /** 사전 조회된 헤리티지 판정 입력(없으면 heritage 플래그 계산을 건너뛴다) — 이 함수는
   *  Supabase를 직접 조회하지 않는다(호출부가 이미 벌크로 조회해 넘긴다, N+1 방지). */
  heritageInput?: HeritageAssessmentInput,
  fxUsdKrw = 1350,
): ClientBookRow {
  const mine = holdings.filter((h) => h.clientId === client.id);
  const portfolioReturn = calcPortfolioUnrealizedReturn(
    mine.map((h) => ({
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      lastPrice: h.lastPrice,
      currency: h.currency,
    })),
    fxUsdKrw,
  );
  // 표시용 평가액: 시세가 있으면 시가, 없으면 취득원가 폴백(총수익률과는 분리)
  const investedAmount = mine.reduce((s, h) => {
    if (h.lastPrice != null && h.lastPrice > 0) {
      const local = h.quantity * h.lastPrice;
      return s + (h.currency === "USD" ? local * fxUsdKrw : local);
    }
    if (h.avgPrice != null && h.avgPrice > 0) {
      const local = h.quantity * h.avgPrice;
      return s + (h.currency === "USD" ? local * fxUsdKrw : local);
    }
    return s + (h.evalAmount || 0);
  }, 0);
  const totalAssets = Math.max(client.assetSize || 0, investedAmount);
  const totalReturnPct = portfolioReturn.status === "ok" ? portfolioReturn.returnPct : null;
  const riskScore = client.ips?.risk?.reviewed ? client.ips.risk.score : client.ips?.risk?.score ?? null;
  const chips: HoldingChip[] = mine
    .slice()
    .sort((a, b) => b.evalAmount - a.evalAmount)
    .slice(0, 5)
    .map((h) => ({
      name: h.name,
      ticker: h.ticker,
      category: h.category,
      weightPct: investedAmount > 0 ? (h.evalAmount / investedAmount) * 100 : 0,
    }));

  const latest = consultations
    .filter((c) => c.clientId === client.id)
    .slice()
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))[0];

  const need = cashNeed12m(client);
  const bondLike = mine
    .filter((h) => h.category === "bond" || h.category === "trust")
    .reduce((s, h) => s + h.evalAmount, 0);
  const equityLike = mine
    .filter((h) => h.category === "stock" || h.category === "etf" || h.category === "els")
    .reduce((s, h) => s + h.evalAmount, 0);
  const equityWeight = investedAmount > 0 ? equityLike / investedAmount : 0;
  const liquidWeight = totalAssets > 0 ? bondLike / totalAssets : 0;
  const liquidityScore = client.ips?.liquidity?.score ?? 3;

  // 레거시 flags는 분석·타 모듈용으로만 유지. Book UI는 bookLossTag만 사용한다.
  const flags: ClientFlag[] = [];
  if ((riskScore ?? 0) >= 4 || equityWeight >= 0.75) {
    flags.push({
      kind: "high_risk",
      reason: `위험점수 ${riskScore ?? "미입력"}, 위험자산 비중 ${(equityWeight * 100).toFixed(0)}%`,
    });
  }
  if (totalReturnPct != null && totalReturnPct < 0) {
    flags.push({
      kind: "low_return",
      reason: `평가수익률 ${totalReturnPct.toFixed(1)}% (원가 대비)`,
    });
  }
  if (liquidityScore >= 4 && (need > totalAssets * 0.15 || liquidWeight < 0.12)) {
    flags.push({
      kind: "low_liquidity",
      reason: `12개월 현금소요 ${(need / 100_000_000).toFixed(1)}억 대비 채권·신탁 비중 ${(liquidWeight * 100).toFixed(0)}%`,
    });
  }

  let heritagePriority: ClientBookRow["heritagePriority"];
  if (heritageInput) {
    const heritage = assessHeritage(heritageInput);
    if (heritage.demand.hasNeed) {
      const recommendation = heritage.urgency.reasons.find((r) => r.code === "recommendation");
      flags.push({
        kind: "heritage",
        reason: recommendation?.text ?? "신탁·상속·증여 상담이 필요합니다.",
      });
      heritagePriority = { urgencyLevel: heritage.urgency.level, score: heritage.demand.score };
    }
  }

  return {
    clientId: client.id,
    code: client.code,
    name: client.name,
    clientType: client.clientType,
    birthDate: client.birthDate ?? "",
    totalAssets,
    investedAmount,
    totalReturnPct,
    returnStatus: portfolioReturn.status,
    returnNote: portfolioReturn.note,
    bookLossTag: portfolioReturn.lossTag,
    riskGrade: riskGradeFromScore(riskScore),
    riskScore,
    holdings: chips,
    lastConsultation: latest
      ? {
          at: latest.createdAt || latest.endedAt || latest.startedAt,
          label: latest.endedAt ? "상담완료" : "진행기록",
          notesPreview: notesPreview(latest.notes || ""),
        }
      : null,
    flags,
    cashNeed12m: need,
    heritagePriority,
  };
}

export function analyzeBook(
  rows: ClientBookRow[],
  holdings: BookHolding[],
  asOf: string,
  source: string,
): BookAnalysis {
  const totalEval = holdings.reduce((s, h) => s + h.evalAmount, 0);
  const retAcc = rows.reduce(
    (acc, r) => {
      if (r.totalReturnPct == null) return acc;
      acc.sum += r.totalReturnPct;
      acc.n += 1;
      return acc;
    },
    { sum: 0, n: 0 },
  );

  const mixMap = new Map<ProductMixSlice["category"], { amount: number; clients: Set<string> }>();
  for (const h of holdings) {
    const cur = mixMap.get(h.category) ?? { amount: 0, clients: new Set<string>() };
    cur.amount += h.evalAmount;
    cur.clients.add(h.clientId);
    mixMap.set(h.category, cur);
  }
  const productMix: ProductMixSlice[] = Array.from(mixMap.entries())
    .map(([category, v]) => ({
      category,
      amount: v.amount,
      weightPct: totalEval > 0 ? (v.amount / totalEval) * 100 : 0,
      clientCount: v.clients.size,
    }))
    .sort((a, b) => b.amount - a.amount);

  const rankMap = new Map<string, ProductRankItem & { clients: Set<string>; weightSum: number }>();
  for (const h of holdings) {
    const key = `${h.category}|${h.ticker || h.name}`;
    const cur = rankMap.get(key) ?? {
      name: h.name,
      ticker: h.ticker,
      category: h.category,
      clientCount: 0,
      totalAmount: 0,
      avgWeightPct: 0,
      clients: new Set<string>(),
      weightSum: 0,
    };
    const clientInvested = holdings.filter((x) => x.clientId === h.clientId).reduce((s, x) => s + x.evalAmount, 0);
    cur.totalAmount += h.evalAmount;
    cur.weightSum += clientInvested > 0 ? (h.evalAmount / clientInvested) * 100 : 0;
    cur.clients.add(h.clientId);
    cur.clientCount = cur.clients.size;
    rankMap.set(key, cur);
  }
  const productRanking: ProductRankItem[] = Array.from(rankMap.values())
    .map((item) => ({
      name: item.name,
      ticker: item.ticker,
      category: item.category,
      clientCount: item.clientCount,
      totalAmount: item.totalAmount,
      avgWeightPct: item.clientCount > 0 ? item.weightSum / item.clientCount : 0,
    }))
    .sort((a, b) => b.clientCount - a.clientCount || b.totalAmount - a.totalAmount)
    .slice(0, 12);

  return {
    asOf,
    source,
    currency: "KRW",
    clientCount: rows.length,
    totalEvalAmount: measured(totalEval, "원", asOf, source, "KRW"),
    avgReturnPct:
      retAcc.n > 0 ? measured(retAcc.sum / retAcc.n, "%", asOf, source) : null,
    productMix,
    productRanking,
    flagged: {
      highRisk: rows.filter((r) => r.flags.some((f) => f.kind === "high_risk")),
      lowReturn: rows.filter((r) => r.flags.some((f) => f.kind === "low_return")),
      lowLiquidity: rows.filter((r) => r.flags.some((f) => f.kind === "low_liquidity")),
      heritage: rows.filter((r) => r.flags.some((f) => f.kind === "heritage")),
    },
  };
}

/** Heritage-aware priority sort for flagged client rows (used in tests / future list sorting). */
export function comparePriorityRows(a: ClientBookRow, b: ClientBookRow): number {
  const aRank = a.heritagePriority ? URGENCY_RANK[a.heritagePriority.urgencyLevel] : -1;
  const bRank = b.heritagePriority ? URGENCY_RANK[b.heritagePriority.urgencyLevel] : -1;
  if (aRank !== bRank) return bRank - aRank;
  if (aRank >= 0) {
    const scoreDiff = (b.heritagePriority?.score ?? 0) - (a.heritagePriority?.score ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
  }
  return b.flags.length - a.flags.length;
}
