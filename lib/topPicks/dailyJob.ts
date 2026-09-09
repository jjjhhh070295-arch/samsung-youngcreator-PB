import { supabase } from "@/lib/supabase";
import { fetchTickerOhlcDaily, resolveTickerInput } from "@/lib/advisory/tickerOhlcData";
import { getSavedResearchReports } from "@/lib/researchSignalsStore";
import { deduplicateCanonicalStocks, type CanonicalResearch } from "./researchInputs";
import { buildMarketBrief, prepareResearchInputs, explainResearchPicks, type StructuredGenerator } from "./marketIntelligence";
import { aggregateMarketClusters, businessDateSequence, groupStockResearch, scoreKeySectors, scoreResearchCandidate,
  selectResearchTopPicks, selectStockResearchWindow, RESEARCH_TOP_PICK_RULES,
  selectMarketResearchWindow,
  type MarketBriefContext, type MarketResearchFact, type ResearchRankedPick, type StockResearchFact } from "./researchAggregation";

const errorMessage = (error: unknown) => error instanceof Error ? error.message
  : error && typeof error === "object" && "message" in error ? String(error.message) : String(error);

type PriceSnapshot = { lastPrice: number; averageTurnover: number; domestic: boolean };

async function fetchPriceSnapshot(ticker: string): Promise<PriceSnapshot> {
  const resolved = await resolveTickerInput(ticker);
  const daily = await fetchTickerOhlcDaily(resolved);
  const volumes = daily.bars.slice(-20).map((bar) => Number(bar.volume)).filter(Number.isFinite);
  const averageVolume = volumes.length ? volumes.reduce((sum, value) => sum + value, 0) / volumes.length : 0;
  return { lastPrice: daily.lastPrice, averageTurnover: averageVolume * daily.lastPrice, domestic: Boolean(resolved.domesticCode) };
}

function deterministicExplanation(pick: ResearchRankedPick) {
  return pick.explanation ?? { summary: "리서치 집계 점수로 선정되었습니다.", keyReasons: [], risks: [] };
}

export async function runDailyTopPicks(origin: string, dependencies: {
  db?: typeof supabase;
  generate?: StructuredGenerator;
  prepare?: typeof prepareResearchInputs;
  price?: (ticker: string) => Promise<PriceSnapshot>;
  now?: Date;
} = {}) {
  const db = dependencies.db ?? supabase;
  if (!db) throw new Error("Supabase 미설정");
  const now = dependencies.now ?? new Date();
  const tradeDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const cutoffDate = businessDateSequence(tradeDate, 8).at(-1)!;
  const cutoff = `${cutoffDate}T00:00:00+09:00`;
  const through = now.toISOString();
  const [{ data: stockRows, error: stockError }, { data: marketRows, error: marketError }, savedReports] = await Promise.all([
    db.from("stock_research").select("*, research_documents(id,source_report_id,title,source,broker,analyst,published_at,source_url,cleaned_text)")
      .gte("published_at", cutoff).lte("published_at", through).not("ticker", "is", null).order("published_at", { ascending: false }).limit(500),
    db.from("market_research").select("*, research_documents(id,source_report_id,title,source,broker,published_at,source_url,cleaned_text)")
      .gte("published_at", cutoff).lte("published_at", through).order("published_at", { ascending: false }).limit(500),
    getSavedResearchReports(db),
  ]);
  if (stockError) throw stockError;
  if (marketError) throw marketError;

  const canonicalStocks = deduplicateCanonicalStocks((stockRows ?? []) as unknown as CanonicalResearch[]) as StockResearchFact[];
  const selectedWindow = selectStockResearchWindow(canonicalStocks, tradeDate);
  const stockGroups = groupStockResearch(selectedWindow.rows);
  const marketWindow = selectMarketResearchWindow((marketRows ?? []) as MarketResearchFact[], tradeDate);
  const currentMarketRows = marketWindow.rows;
  const marketClusters = aggregateMarketClusters(currentMarketRows, tradeDate);
  const sectors = scoreKeySectors(currentMarketRows, stockGroups, tradeDate);
  const context: MarketBriefContext = { asOf: now.toISOString(), dataWindow: marketWindow.dataWindow, clusters: marketClusters, sectors };

  const canonical = [...currentMarketRows, ...selectedWindow.rows] as CanonicalResearch[];
  const prepared = await (dependencies.prepare ?? prepareResearchInputs)({ crawled: [], saved: savedReports, canonical, now });
  if (!prepared.reports.length) throw new Error("분석 가능한 리서치가 없습니다.");

  const bullishSectors = sectors.filter((sector) => sector.direction === "BULLISH").map((sector) => sector.themeCode);
  const price = dependencies.price ?? fetchPriceSnapshot;
  const candidates: ResearchRankedPick[] = [];
  const groups = stockGroups.slice(0, RESEARCH_TOP_PICK_RULES.candidateLimit);
  for (const group of groups) {
    try {
      const snapshot = await price(group.ticker);
      const minimumLiquidityMet = snapshot.domestic ? snapshot.averageTurnover >= 1_000_000_000 : snapshot.averageTurnover >= 1_000_000;
      if (!minimumLiquidityMet) continue;
      const scored = scoreResearchCandidate(group, { dataWindow: selectedWindow.dataWindow, bullishSectorCodes: bullishSectors,
        currentPrice: snapshot.lastPrice });
      if (scored) candidates.push(scored);
    } catch (error) {
      console.warn("[dailyTopPicks] price unavailable", { ticker: group.ticker,
        error: errorMessage(error), timestamp: new Date().toISOString() });
    }
  }

  const previousDateResult = await db.from("daily_top_picks").select("trade_date").lt("trade_date", tradeDate)
    .eq("is_dropped", false).order("trade_date", { ascending: false }).limit(1).maybeSingle();
  const previousDate = previousDateResult.data?.trade_date;
  const previousResult = previousDate
    ? await db.from("daily_top_picks").select("ticker,rank,total_score,confidence_score,pick_type").eq("trade_date", previousDate).eq("is_dropped", false)
    : { data: [] as any[], error: null };
  if (previousDateResult.error) throw previousDateResult.error;
  if (previousResult.error) throw previousResult.error;
  const previousRanks = new Map<string, number>((previousResult.data ?? []).map((row: any) => [row.ticker, Number(row.rank)]));
  const picks = selectResearchTopPicks(candidates, previousRanks);

  let explanations = new Map(picks.map((pick) => [pick.ticker, deterministicExplanation(pick)]));
  let topPickNarrativeStatus: "generated" | "deterministic-fallback" = "deterministic-fallback";
  if (picks.length) {
    try {
      explanations = await explainResearchPicks(picks, new Map(), dependencies.generate);
      topPickNarrativeStatus = "generated";
    } catch (error) {
      console.warn("[dailyTopPicks] pick narrative failed", { error: errorMessage(error),
        timestamp: new Date().toISOString() });
    }
  }

  const signalRows = candidates.map((stock) => ({
    trade_date: tradeDate, ticker: stock.ticker, company_name: stock.company, market: stock.market, sector: stock.sector,
    themes: stock.themes, research_score: stock.researchScore, fundamental_score: stock.fundamentalScore,
    price_score: stock.priceScore, consensus_score: stock.consensusScore, regime_score: stock.regimeScore,
    total_score: stock.totalScore, confidence_score: stock.confidenceScore,
    rank: picks.find((pick) => pick.ticker === stock.ticker)?.rank ?? null, pick_type: stock.pickType,
    score_breakdown: stock.breakdown,
    input_snapshot: { dataWindow: stock.dataWindow, supportingBrokers: stock.supportingBrokers,
      targetPrice: stock.targetPrice, targetPriceChangePct: stock.targetPriceChangePct },
    source_document_ids: stock.supportingReportIds, scoring_version: "research-top-picks-v2",
  }));
  if (signalRows.length) {
    const { error } = await db.from("daily_stock_signals").upsert(signalRows, { onConflict: "trade_date,ticker" });
    if (error) throw error;
  }

  const topRows = picks.map((pick) => {
    const explanation = explanations.get(pick.ticker) ?? deterministicExplanation(pick);
    return { trade_date: tradeDate, as_of: now.toISOString(), ticker: pick.ticker, rank: pick.rank, previous_rank: pick.previousRank,
      rank_change: pick.rankChange, is_new: pick.isNew, is_dropped: false, total_score: pick.totalScore,
      confidence_score: pick.confidenceScore, pick_type: pick.pickType, summary: explanation.summary,
      key_reasons: explanation.keyReasons, risks: explanation.risks, signal_changes: {},
      source_document_ids: pick.supportingReportIds, supporting_brokers: pick.supportingBrokers,
      broker_count: pick.brokerCount, data_window: pick.dataWindow, target_price: pick.targetPrice,
      target_price_change_pct: pick.targetPriceChangePct, confidence_label: pick.confidenceLabel };
  });
  const { error: resetError } = await db.from("daily_top_picks").update({ is_dropped: true, rank: null }).eq("trade_date", tradeDate);
  if (resetError) throw resetError;
  if (topRows.length) {
    const { error } = await db.from("daily_top_picks").upsert(topRows, { onConflict: "trade_date,ticker" });
    if (error) throw error;
  }

  let marketViewStatus: "generated" | "failed" = "failed";
  let briefModel: string | null = null;
  let briefErrorMessage: string | null = null;
  if (marketClusters.length) {
    try {
      const briefResult = await buildMarketBrief(prepared.reports, tradeDate, dependencies.generate, context);
      const brief = briefResult.value;
      const indicatorResponse = await fetch(origin + "/api/market", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : { items: [] }).catch(() => ({ items: [] }));
      const { error } = await db.from("daily_market_briefs").upsert({ trade_date: tradeDate, as_of: brief.asOf,
        data_window: brief.dataWindow, stance: brief.stance, headline: brief.headline, market_summary: brief.marketSummary,
        narrative_timeline: brief.timeline, key_issues: brief.keyIssues, themes: brief.themes,
        key_drivers: brief.keyDrivers, key_risks: brief.keyRisks, watch_points: brief.watchPoints,
        supporting_brokers: brief.supportingBrokers, asset_view: brief.assetView, indicators: indicatorResponse.items ?? [],
        source_document_ids: briefResult.sourceDocumentIds, model: briefResult.model }, { onConflict: "trade_date" });
      if (error) throw error;
      marketViewStatus = "generated";
      briefModel = briefResult.model;
    } catch (error) {
      briefErrorMessage = errorMessage(error);
      console.warn("[dailyTopPicks] market brief failed", { error: briefErrorMessage, timestamp: new Date().toISOString() });
    }
  } else briefErrorMessage = "근거가 있는 시장 리서치 클러스터가 없습니다.";

  return { tradeDate, dataWindow: selectedWindow.dataWindow, marketDataWindow: marketWindow.dataWindow, researchCount: prepared.reports.length,
    mergedResearchCount: prepared.mergedCount, excludedResearchCount: prepared.excludedCount,
    stockReportCount: selectedWindow.rows.length, marketReportCount: currentMarketRows.length,
    candidateCount: candidates.length, topPickCount: picks.length, sectorCount: sectors.length,
    marketViewStatus, keyThemeStatus: sectors.length ? "generated" : "no-evidence",
    topPickStatus: picks.length ? "generated" : "no-qualified-candidates", topPickNarrativeStatus,
    briefError: briefErrorMessage, model: briefModel };
}
