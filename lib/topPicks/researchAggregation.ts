import { MARKET_SECTOR_CODES, sectorLabelKo } from "./themeLabels";
import type { SelectedTopPick } from "./types";

export const RESEARCH_TOP_PICK_RULES = {
  pickLimit: 10,
  candidateLimit: 30,
  minimumScore: 35,
  maxPerSector: 3,
  primaryLookbackBusinessDays: 3,
  expandedLookbackBusinessDays: 20,
} as const;

type Stance = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";
type Specificity = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type StockResearchFact = {
  document_id?: string;
  report_id?: string | null;
  ticker?: string | null;
  company_name?: string | null;
  market?: string | null;
  sector?: string | null;
  rating?: string | null;
  previous_rating?: string | null;
  rating_change?: string | null;
  target_price?: number | null;
  previous_target_price?: number | null;
  target_price_change_pct?: number | null;
  eps_revision_pct?: number | null;
  earnings_revision_direction?: string | null;
  earnings_revision_details?: string | null;
  investment_thesis?: string | null;
  investment_points?: string[] | null;
  catalysts?: string[] | null;
  risk_factors?: string[] | null;
  themes?: string[] | null;
  analyst_stance?: string | null;
  catalyst_specificity?: string | null;
  risk_level?: string | null;
  extraction_confidence?: number | null;
  published_at?: string | null;
  research_documents?: {
    id?: string;
    source_report_id?: string | null;
    title?: string;
    source?: string;
    broker?: string | null;
    published_at?: string | null;
    source_url?: string | null;
    cleaned_text?: string | null;
  } | null;
};

export type MarketResearchFact = {
  document_id?: string;
  report_id?: string | null;
  published_at?: string | null;
  report_type?: string | null;
  market_stance?: string | null;
  market_drivers?: string[] | null;
  positive_factors?: string[] | null;
  negative_factors?: string[] | null;
  rates_view?: string | null;
  fx_view?: string | null;
  foreign_flow_view?: string | null;
  earnings_view?: string | null;
  preferred_sectors?: string[] | null;
  avoided_sectors?: string[] | null;
  affected_sectors?: string[] | null;
  key_catalysts?: string[] | null;
  key_risks?: string[] | null;
  confidence?: number | null;
  topic?: string | null;
  summary?: string | null;
  key_points?: string[] | null;
  created_at?: string | null;
  research_documents?: StockResearchFact["research_documents"];
};

export type ResearchDataWindow = {
  asOf: string;
  start: string;
  end: string;
  businessDays: number;
  fallbackStage: "TODAY" | "PREVIOUS_BUSINESS_DAY" | "LAST_3_BUSINESS_DAYS" | "RECENT_RESEARCH";
};

export type StockResearchGroup = {
  ticker: string;
  company: string;
  market: string;
  sector: string | null;
  reports: StockResearchFact[];
  supportingReportIds: string[];
  supportingBrokers: string[];
};

export type ResearchRankedPick = SelectedTopPick & {
  supportingReportIds: string[];
  supportingBrokers: string[];
  brokerCount: number;
  targetPrice: number | null;
  targetPriceChangePct: number | null;
  confidenceLabel: "HIGH" | "MEDIUM" | "LOW";
  dataWindow: ResearchDataWindow;
};

export type MarketCluster = {
  id: string;
  label: string;
  uniqueBrokerCount: number;
  positiveCount: number;
  negativeCount: number;
  mixedCount: number;
  freshness: number;
  supportingReportIds: string[];
  supportingBrokers: string[];
  drivers: string[];
  risks: string[];
};

export type ScoredSector = {
  rank: number;
  theme: string;
  themeCode: string;
  themeKo: string;
  canonicalSector: string;
  direction: "BULLISH" | "MIXED" | "CAUTION";
  score: number;
  reason: string;
  catalysts: string[];
  risks: string[];
  supportingBrokers: string[];
  supportingReportIds: string[];
};

export type MarketBriefContext = {
  asOf: string;
  dataWindow: ResearchDataWindow;
  clusters: MarketCluster[];
  sectors: ScoredSector[];
};

const array = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
  : [];
const unique = <T,>(items: T[]) => Array.from(new Set(items));
const round1 = (value: number) => Math.round(value * 10) / 10;
const dateOnly = (value?: string | null) => value?.slice(0, 10) ?? "";
const reportDate = (row: StockResearchFact | MarketResearchFact) =>
  dateOnly("published_at" in row ? row.published_at : null) || dateOnly(row.research_documents?.published_at);
const reportId = (row: StockResearchFact | MarketResearchFact) =>
  row.report_id || row.research_documents?.source_report_id || row.document_id || row.research_documents?.id || "";
const broker = (row: StockResearchFact | MarketResearchFact) =>
  row.research_documents?.broker?.trim() || row.research_documents?.source?.split(" · ").at(-1)?.trim() || "UNKNOWN";

function parseKstDate(value: string): Date {
  return new Date(`${value}T12:00:00+09:00`);
}

function previousBusinessDate(value: string): string {
  const date = parseKstDate(value);
  do { date.setDate(date.getDate() - 1); } while ([0, 6].includes(date.getDay()));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(date);
}

export function businessDateSequence(asOf: string, count: number = RESEARCH_TOP_PICK_RULES.expandedLookbackBusinessDays): string[] {
  const dates = [asOf];
  while (dates.length < count) dates.push(previousBusinessDate(dates.at(-1)!));
  return dates;
}

function validTicker(value: unknown): value is string {
  return typeof value === "string" && (/^\d{6}$/.test(value) || /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

export function normalizeRating(value?: string | null): "BUY" | "HOLD" | "SELL" | "UNKNOWN" {
  const rating = value?.trim().toUpperCase() ?? "";
  if (/STRONG\s*BUY|BUY|OUTPERFORM|OVERWEIGHT|매수|비중확대/.test(rating)) return "BUY";
  if (/SELL|UNDERPERFORM|UNDERWEIGHT|REDUCE|매도|비중축소/.test(rating)) return "SELL";
  if (/HOLD|NEUTRAL|중립|보유/.test(rating)) return "HOLD";
  return "UNKNOWN";
}

function normalizedStance(row: StockResearchFact): Stance {
  const rating = normalizeRating(row.rating);
  if (rating === "BUY") return "POSITIVE";
  if (rating === "HOLD") return "NEUTRAL";
  if (rating === "SELL") return "NEGATIVE";
  const stance = row.analyst_stance?.toUpperCase();
  return ["POSITIVE", "NEUTRAL", "NEGATIVE"].includes(stance ?? "") ? stance as Stance : "UNKNOWN";
}

function specificity(row: StockResearchFact): Specificity {
  const value = row.catalyst_specificity?.toUpperCase();
  return ["HIGH", "MEDIUM", "LOW", "NONE"].includes(value ?? "") ? value as Specificity : "NONE";
}

function sectorCode(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if ((MARKET_SECTOR_CODES as string[]).includes(normalized)) return normalized;
  const aliases: Record<string, string> = {
    반도체: "SEMICONDUCTOR", 정보기술: "INFORMATION_TECHNOLOGY", IT: "INFORMATION_TECHNOLOGY",
    자동차: "AUTOMOBILES", 금융: "FINANCIALS", 헬스케어: "HEALTH_CARE", 바이오: "BIOTECHNOLOGY",
    산업재: "INDUSTRIALS", 소재: "MATERIALS", 에너지: "ENERGY", 조선: "SHIPBUILDING",
    방산: "DEFENSE_AEROSPACE", 유통: "CONSUMER_DISCRETIONARY", 소비재: "CONSUMER_STAPLES",
    이차전지: "SECONDARY_BATTERY", "2차전지": "SECONDARY_BATTERY",
  };
  return aliases[value.trim()] ?? null;
}

function latestPerBroker(rows: StockResearchFact[]): StockResearchFact[] {
  const seen = new Set<string>();
  return [...rows].sort((a, b) => reportDate(b).localeCompare(reportDate(a)) || reportId(a).localeCompare(reportId(b)))
    .filter((row) => {
      const key = broker(row).toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function groupStockResearch(rows: StockResearchFact[]): StockResearchGroup[] {
  const byTicker = new Map<string, StockResearchFact[]>();
  const seenReports = new Set<string>();
  for (const row of rows) {
    if (!validTicker(row.ticker)) continue;
    const id = reportId(row);
    if (!id || seenReports.has(id)) continue;
    seenReports.add(id);
    const grouped = byTicker.get(row.ticker) ?? [];
    grouped.push(row);
    byTicker.set(row.ticker, grouped);
  }
  return Array.from(byTicker.entries()).map(([ticker, grouped]) => {
    const reports = latestPerBroker(grouped);
    const latest = reports[0];
    return {
      ticker,
      company: latest.company_name?.trim() || ticker,
      market: latest.market?.trim() || (/^\d{6}$/.test(ticker) ? "KR" : "US"),
      sector: sectorCode(latest.sector),
      reports,
      supportingReportIds: reports.map(reportId).filter(Boolean),
      supportingBrokers: reports.map(broker).filter((value) => value !== "UNKNOWN"),
    };
  });
}

function eligibleGroup(group: StockResearchGroup): boolean {
  const stances = group.reports.map(normalizedStance);
  const positive = stances.filter((value) => value === "POSITIVE").length;
  const negative = stances.filter((value) => value === "NEGATIVE").length;
  if (!positive || negative >= positive) return false;
  return group.reports.some((row) => normalizeRating(row.rating) === "BUY"
    || (normalizedStance(row) === "POSITIVE" && specificity(row) !== "NONE"
      && Boolean(row.investment_thesis?.trim() || array(row.investment_points).length)));
}

export function selectStockResearchWindow(rows: StockResearchFact[], asOf: string,
  minimumCandidates: number = RESEARCH_TOP_PICK_RULES.pickLimit) {
  const dates = businessDateSequence(asOf, RESEARCH_TOP_PICK_RULES.expandedLookbackBusinessDays);
  const stages: Array<{ dates: string[]; fallbackStage: ResearchDataWindow["fallbackStage"] }> = [
    { dates: dates.slice(0, 1), fallbackStage: "TODAY" },
    { dates: dates.slice(0, 2), fallbackStage: "PREVIOUS_BUSINESS_DAY" },
    { dates: dates.slice(0, RESEARCH_TOP_PICK_RULES.primaryLookbackBusinessDays), fallbackStage: "LAST_3_BUSINESS_DAYS" },
    { dates, fallbackStage: "RECENT_RESEARCH" },
  ];
  let selected = stages.at(-1)!;
  let selectedRows: StockResearchFact[] = [];
  for (const stage of stages) {
    const allowed = new Set(stage.dates);
    const current = rows.filter((row) => allowed.has(reportDate(row)));
    selected = stage;
    selectedRows = current;
    if (groupStockResearch(current).filter(eligibleGroup).length >= minimumCandidates) break;
  }
  return {
    rows: selectedRows,
    dataWindow: {
      asOf,
      start: selected.dates.at(-1)!,
      end: asOf,
      businessDays: selected.dates.length,
      fallbackStage: selected.fallbackStage,
    } satisfies ResearchDataWindow,
  };
}

export function selectMarketResearchWindow(rows: MarketResearchFact[], asOf: string) {
  const dates = businessDateSequence(asOf, 3);
  const stages: Array<{ dates: string[]; fallbackStage: ResearchDataWindow["fallbackStage"] }> = [
    { dates: dates.slice(0, 1), fallbackStage: "TODAY" },
    { dates: dates.slice(0, 2), fallbackStage: "PREVIOUS_BUSINESS_DAY" },
    { dates, fallbackStage: "LAST_3_BUSINESS_DAYS" },
  ];
  let selected = stages.at(-1)!;
  let selectedRows: MarketResearchFact[] = [];
  for (const stage of stages) {
    const allowed = new Set(stage.dates);
    selectedRows = rows.filter((row) => allowed.has(reportDate(row)));
    selected = stage;
    if (selectedRows.length) break;
  }
  return { rows: selectedRows, dataWindow: { asOf, start: selected.dates.at(-1)!, end: asOf,
    businessDays: selected.dates.length, fallbackStage: selected.fallbackStage } satisfies ResearchDataWindow };
}

function freshnessPoints(publishedAt: string, dataWindow: ResearchDataWindow): number {
  const index = businessDateSequence(dataWindow.asOf, 4).indexOf(dateOnly(publishedAt));
  if (index === 0) return 15;
  if (index === 1) return 10;
  if (index === 2 || index === 3) return 5;
  return 0;
}

function targetRevision(row: StockResearchFact): number | null {
  const supplied = Number(row.target_price_change_pct);
  if (Number.isFinite(supplied)) return supplied;
  const current = Number(row.target_price), previous = Number(row.previous_target_price);
  return Number.isFinite(current) && Number.isFinite(previous) && previous > 0 ? (current / previous - 1) * 100 : null;
}

function targetRevisionPoints(value: number | null): number {
  if (value == null) return 0;
  if (value >= 10) return 15;
  if (value >= 5) return 12;
  if (value > 0) return 8;
  if (value === 0) return 4;
  return 0;
}

function earningsPoints(rows: StockResearchFact[]): number {
  const directions = rows.map((row) => row.earnings_revision_direction?.toUpperCase());
  if (directions.includes("UP") || rows.some((row) => Number(row.eps_revision_pct) > 0)) return 15;
  const details = rows.map((row) => row.earnings_revision_details ?? "").join(" ");
  if (/surprise|어닝 서프라이즈|전망 상향|가이던스 상향/i.test(details)) return 10;
  if (directions.includes("FLAT")) return 4;
  return 0;
}

function ratingPoints(rows: StockResearchFact[]): number {
  if (rows.some((row) => normalizeRating(row.rating) === "BUY"
    && (row.rating_change?.toUpperCase() === "UPGRADE" || ["HOLD", "SELL"].includes(normalizeRating(row.previous_rating))))) return 15;
  if (rows.some((row) => normalizeRating(row.rating) === "BUY")) return 10;
  if (rows.some((row) => normalizeRating(row.rating) === "UNKNOWN" && normalizedStance(row) === "POSITIVE")) return 5;
  return 0;
}

function specificityPoints(rows: StockResearchFact[]): number {
  const points: Record<Specificity, number> = { HIGH: 10, MEDIUM: 6, LOW: 2, NONE: 0 };
  return Math.max(...rows.map((row) => points[specificity(row)]), 0);
}

function riskPenalty(rows: StockResearchFact[]): number {
  const levels = rows.map((row) => row.risk_level?.toUpperCase());
  if (levels.includes("HIGH")) return -10;
  if (levels.includes("MEDIUM")) return -5;
  return 0;
}

export function scoreResearchCandidate(group: StockResearchGroup, options: {
  dataWindow: ResearchDataWindow;
  bullishSectorCodes?: Iterable<string>;
  currentPrice?: number | null;
  minimumScore?: number;
}): ResearchRankedPick | null {
  if (!eligibleGroup(group)) return null;
  const rows = group.reports;
  const stances = rows.map(normalizedStance);
  const positive = stances.filter((value) => value === "POSITIVE").length;
  const negative = stances.filter((value) => value === "NEGATIVE").length;
  const consensusBase = positive >= 4 ? 20 : positive === 3 ? 16 : positive === 2 ? 11 : 5;
  const consensus = round1(consensusBase * (positive / Math.max(1, positive + negative)));
  const freshness = Math.max(...rows.map((row) => freshnessPoints(reportDate(row), options.dataWindow)), 0);
  const rating = ratingPoints(rows);
  const revisions = rows.map(targetRevision).filter((value): value is number => value != null);
  const targetChange = revisions.length ? revisions.reduce((sum, value) => sum + value, 0) / revisions.length : null;
  const targetRevisionScore = targetRevisionPoints(targetChange);
  const earnings = earningsPoints(rows);
  const catalyst = specificityPoints(rows);
  const bullish = new Set(options.bullishSectorCodes ?? []);
  const themeAlignment = group.sector && bullish.has(group.sector) ? 5
    : rows.some((row) => array(row.themes).some((theme) => Boolean(sectorCode(theme) && bullish.has(sectorCode(theme)!)))) ? 2 : 0;
  const targets = rows.map((row) => Number(row.target_price)).filter((value) => Number.isFinite(value) && value > 0);
  const targetPrice = targets.length ? targets.reduce((sum, value) => sum + value, 0) / targets.length : null;
  const targetUpside = targetPrice != null && options.currentPrice != null && options.currentPrice > 0 && targetPrice > options.currentPrice ? 5 : 0;
  const risk = riskPenalty(rows);
  const totalScore = round1(consensus + freshness + rating + targetRevisionScore + earnings + catalyst + themeAlignment + targetUpside + risk);
  if (totalScore < (options.minimumScore ?? RESEARCH_TOP_PICK_RULES.minimumScore)) return null;
  const hasRevision = targetChange != null || earnings > 0;
  const confidenceLabel = group.supportingBrokers.length >= 2 && freshness >= 10 && hasRevision && catalyst >= 6 ? "HIGH"
    : freshness >= 5 && (hasRevision || catalyst >= 6) ? "MEDIUM" : "LOW";
  const confidenceScore = confidenceLabel === "HIGH" ? 85 : confidenceLabel === "MEDIUM" ? 70 : 50;
  const researchComposite = round1(Math.min(100, ((consensus + rating + targetRevisionScore + earnings + catalyst) / 75) * 100));
  const latest = rows[0];
  const thesis = latest.investment_thesis?.trim() || array(latest.investment_points)[0] || "리서치 근거를 확인해 주세요.";
  const risks = unique(rows.flatMap((row) => array(row.risk_factors))).slice(0, 5);
  const catalysts = unique(rows.flatMap((row) => array(row.catalysts))).slice(0, 5);
  return {
    rank: 0, previousRank: null, rankChange: null, isNew: true,
    ticker: group.ticker, company: group.company, market: group.market, sector: group.sector,
    themes: unique([group.sector, ...rows.flatMap((row) => array(row.themes))].filter((value): value is string => Boolean(value))),
    research: [], fundamental: { epsRevisionPct: null, earningsGrowthPct: null, revenueGrowthPct: null, roePct: null, relativeValuationPct: null },
    price: { momentum20Pct: null, momentum60Pct: null, relativeStrengthPct: null, drawdownPct: null, volatilityPct: null, historyDays: 0 },
    consensus: { buyRatioPct: positive / Math.max(1, positive + negative) * 100, targetUpsidePct: null, epsRevisionPct: null, targetDispersionPct: null },
    regimeByTheme: {}, minimumLiquidityMet: true,
    researchScore: researchComposite, fundamentalScore: round1(earnings / 15 * 100),
    priceScore: targetUpside ? 100 : 0, consensusScore: round1(consensus / 20 * 100),
    regimeScore: round1(themeAlignment / 5 * 100), totalScore, confidenceScore, pickType: "CORE",
    breakdown: {
      research: { crossBrokerConsensus: consensus, freshness, investmentRating: rating, targetPriceRevision: targetRevisionScore,
        earningsRevision: earnings, catalystSpecificity: catalyst, themeAlignment, targetPriceUpside: targetUpside, riskPenalty: risk },
      fundamental: {}, price: {}, consensus: {}, regime: {},
      coverage: { brokerCount: group.supportingBrokers.length, extractionConfidence: round1(rows.reduce((sum, row) => sum + Number(row.extraction_confidence ?? 0), 0) / rows.length * 100) },
    },
    supportingReportIds: group.supportingReportIds, supportingBrokers: group.supportingBrokers,
    brokerCount: group.supportingBrokers.length, targetPrice, targetPriceChangePct: targetChange,
    confidenceLabel, dataWindow: options.dataWindow,
    explanation: { summary: thesis, keyReasons: unique([thesis, ...catalysts]).slice(0, 4), risks },
  };
}

export function selectResearchTopPicks(candidates: ResearchRankedPick[], previousRanks = new Map<string, number>()): ResearchRankedPick[] {
  const sorted = [...candidates].sort((a, b) => b.totalScore - a.totalScore
    || b.brokerCount - a.brokerCount
    || Number(b.breakdown.research.freshness ?? 0) - Number(a.breakdown.research.freshness ?? 0)
    || Number(b.breakdown.research.earningsRevision ?? 0) - Number(a.breakdown.research.earningsRevision ?? 0)
    || Number(b.breakdown.research.targetPriceRevision ?? 0) - Number(a.breakdown.research.targetPriceRevision ?? 0)
    || a.ticker.localeCompare(b.ticker));
  const selected: ResearchRankedPick[] = [];
  const deferred: ResearchRankedPick[] = [];
  const sectors = new Map<string, number>();
  for (const candidate of sorted) {
    const key = candidate.sector ?? "UNKNOWN";
    if ((sectors.get(key) ?? 0) >= RESEARCH_TOP_PICK_RULES.maxPerSector) deferred.push(candidate);
    else { selected.push(candidate); sectors.set(key, (sectors.get(key) ?? 0) + 1); }
    if (selected.length >= RESEARCH_TOP_PICK_RULES.pickLimit) break;
  }
  // If credible candidates are scarce, relax the sector cap instead of fabricating names.
  if (selected.length < Math.min(RESEARCH_TOP_PICK_RULES.pickLimit, sorted.length)) {
    for (const candidate of deferred) {
      if (!selected.includes(candidate)) selected.push(candidate);
      if (selected.length >= Math.min(RESEARCH_TOP_PICK_RULES.pickLimit, sorted.length)) break;
    }
  }
  return selected.slice(0, RESEARCH_TOP_PICK_RULES.pickLimit).map((pick, index) => {
    const rank = index + 1, previousRank = previousRanks.get(pick.ticker) ?? null;
    return { ...pick, rank, previousRank, rankChange: previousRank == null ? null : previousRank - rank, isNew: previousRank == null };
  });
}

const CLUSTERS = [
  { id: "semiconductor_earnings", label: "반도체 이익 모멘텀", pattern: /반도체|HBM|메모리|semiconductor|chip/i },
  { id: "us_rates", label: "미국 금리", pattern: /미국.*금리|연준|국채|Fed|Treasury|yield/i },
  { id: "fx", label: "원·달러 환율", pattern: /원.?달러|환율|달러|currency|\bFX\b/i },
  { id: "foreign_flow", label: "외국인 수급", pattern: /외국인|foreign flow/i },
  { id: "china", label: "중국 경기", pattern: /중국|China/i },
  { id: "oil", label: "유가", pattern: /유가|원유|oil|Hormuz|호르무즈/i },
  { id: "policy", label: "정책", pattern: /정책|정부|규제|예산|policy/i },
  { id: "earnings", label: "기업 실적", pattern: /실적|이익|매출|earnings|profit/i },
] as const;

function marketStance(row: MarketResearchFact): "BULLISH" | "NEUTRAL" | "BEARISH" | "MIXED" {
  const value = row.market_stance?.toUpperCase();
  return ["BULLISH", "NEUTRAL", "BEARISH", "MIXED"].includes(value ?? "")
    ? value as "BULLISH" | "NEUTRAL" | "BEARISH" | "MIXED" : "MIXED";
}

export function aggregateMarketClusters(rows: MarketResearchFact[], asOf: string): MarketCluster[] {
  const byCluster = new Map<string, Map<string, MarketResearchFact>>();
  for (const row of rows) {
    const text = [row.topic, row.summary, row.research_documents?.title, ...array(row.market_drivers), ...array(row.key_points),
      ...array(row.positive_factors), ...array(row.negative_factors), row.rates_view, row.fx_view, row.foreign_flow_view, row.earnings_view].join(" ");
    const matched = CLUSTERS.filter((cluster) => cluster.pattern.test(text));
    for (const cluster of matched.length ? matched : [CLUSTERS[7]]) {
      const opinions = byCluster.get(cluster.id) ?? new Map<string, MarketResearchFact>();
      const brokerKey = broker(row).toUpperCase();
      const existing = opinions.get(brokerKey);
      if (!existing || reportDate(row) > reportDate(existing)) opinions.set(brokerKey, row);
      byCluster.set(cluster.id, opinions);
    }
  }
  return Array.from(byCluster.entries()).map(([id, opinions]) => {
    const cluster = CLUSTERS.find((item) => item.id === id)!;
    const reports = Array.from(opinions.values());
    const stances = reports.map(marketStance);
    const freshness = Math.max(...reports.map((row) => {
      const index = businessDateSequence(asOf, 4).indexOf(reportDate(row));
      return index < 0 ? 0 : Math.max(0, 1 - index / 3);
    }), 0);
    return {
      id, label: cluster.label, uniqueBrokerCount: opinions.size,
      positiveCount: stances.filter((value) => value === "BULLISH").length,
      negativeCount: stances.filter((value) => value === "BEARISH").length,
      mixedCount: stances.filter((value) => ["MIXED", "NEUTRAL"].includes(value)).length,
      freshness: round1(freshness), supportingReportIds: reports.map(reportId).filter(Boolean),
      supportingBrokers: reports.map(broker).filter((value) => value !== "UNKNOWN"),
      drivers: unique(reports.flatMap((row) => [...array(row.market_drivers), ...array(row.positive_factors)])).slice(0, 6),
      risks: unique(reports.flatMap((row) => [...array(row.negative_factors), ...array(row.key_risks)])).slice(0, 6),
    };
  }).sort((a, b) => b.uniqueBrokerCount - a.uniqueBrokerCount || b.freshness - a.freshness || a.id.localeCompare(b.id)).slice(0, 6);
}

export function scoreKeySectors(marketRows: MarketResearchFact[], stockGroups: StockResearchGroup[], asOf: string): ScoredSector[] {
  type Evidence = { broker: string; reportId: string; stance: Stance; specificity: Specificity; date: string; catalysts: string[]; risks: string[]; stockSupport: boolean };
  const evidence = new Map<string, Evidence[]>();
  const add = (sector: string | null, row: Evidence) => {
    if (!sector) return;
    const rows = evidence.get(sector) ?? [];
    rows.push(row); evidence.set(sector, rows);
  };
  for (const row of marketRows) {
    for (const value of array(row.preferred_sectors)) add(sectorCode(value), { broker: broker(row), reportId: reportId(row), stance: "POSITIVE", specificity: array(row.key_catalysts).length ? "MEDIUM" : "NONE", date: reportDate(row), catalysts: array(row.key_catalysts), risks: array(row.key_risks), stockSupport: false });
    for (const value of array(row.avoided_sectors)) add(sectorCode(value), { broker: broker(row), reportId: reportId(row), stance: "NEGATIVE", specificity: "NONE", date: reportDate(row), catalysts: [], risks: array(row.key_risks), stockSupport: false });
  }
  for (const group of stockGroups.filter(eligibleGroup)) for (const row of group.reports) add(group.sector, {
    broker: broker(row), reportId: reportId(row), stance: normalizedStance(row), specificity: specificity(row), date: reportDate(row),
    catalysts: array(row.catalysts), risks: array(row.risk_factors), stockSupport: true,
  });
  return Array.from(evidence.entries()).map(([code, rows]) => {
    const latestByBroker = new Map<string, Evidence>();
    for (const row of rows) {
      const key = row.broker.toUpperCase(), existing = latestByBroker.get(key);
      if (!existing || row.date > existing.date) latestByBroker.set(key, row);
    }
    const opinions = Array.from(latestByBroker.values());
    const positive = opinions.filter((row) => row.stance === "POSITIVE").length;
    const negative = opinions.filter((row) => row.stance === "NEGATIVE").length;
    const breadth = Math.min(35, opinions.length / 4 * 35);
    const intensity = positive + negative ? positive / (positive + negative) * 25 : 0;
    const specificityWeight: Record<Specificity, number> = { HIGH: 1, MEDIUM: .6, LOW: .2, NONE: 0 };
    const catalyst = Math.max(...opinions.map((row) => specificityWeight[row.specificity]), 0) * 20;
    const freshness = Math.max(...opinions.map((row) => {
      const index = businessDateSequence(asOf, 4).indexOf(row.date);
      return index === 0 ? 10 : index === 1 ? 7 : index >= 2 ? 3 : 0;
    }), 0);
    const stockSupport = Math.min(10, opinions.filter((row) => row.stockSupport).length * 5);
    const score = round1(Math.min(100, breadth + intensity + catalyst + freshness + stockSupport));
    const direction: ScoredSector["direction"] = negative > positive ? "CAUTION" : positive > negative ? "BULLISH" : "MIXED";
    const label = sectorLabelKo(code);
    return { theme: code, themeCode: code, themeKo: label, canonicalSector: code, direction, score,
      reason: `${opinions.length}개 증권사 리서치의 ${direction === "BULLISH" ? "긍정" : direction === "CAUTION" ? "경계" : "혼합"} 의견을 집계했습니다.`,
      catalysts: unique(opinions.flatMap((row) => row.catalysts)).slice(0, 5),
      risks: unique(opinions.flatMap((row) => row.risks)).slice(0, 5),
      supportingBrokers: unique(opinions.map((row) => row.broker).filter((value) => value !== "UNKNOWN")),
      supportingReportIds: unique(opinions.map((row) => row.reportId).filter(Boolean)),
    };
  }).filter((sector) => sector.supportingReportIds.length && sector.score > 0)
    .sort((a, b) => b.score - a.score || a.themeCode.localeCompare(b.themeCode)).slice(0, 5)
    .map((sector, index) => ({ ...sector, rank: index + 1 }));
}
