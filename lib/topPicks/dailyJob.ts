import { supabase } from "@/lib/supabase";
import { fetchFinancialSnapshot, fetchTickerOhlcDaily, resolveTickerInput } from "@/lib/advisory/tickerOhlcData";
import { scoreStock } from "./scoring";
import { droppedTickers, selectTopPicks } from "./selection";
import { getSavedResearchReports } from "@/lib/researchSignalsStore";
import { deduplicateCanonicalStocks } from "./researchInputs";
import { buildMarketBrief, collectCurrentResearch, prepareResearchInputs, explainResearchPicks, type StructuredGenerator } from "./marketIntelligence";
import type { ResearchObservation, ScoreInput } from "./types";

const pct = (newer: number | null, older: number | null) => newer != null && older != null && older !== 0 ? (newer / older - 1) * 100 : null;
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const stddev = (values: number[]) => { const m = mean(values); return m == null || values.length < 2 ? null : Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length); };
const todayKst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const ratingValue = (rating: unknown): number | null => {
  if (typeof rating !== "string") return null;
  const value = rating.toUpperCase();
  if (/STRONG BUY|매수|BUY|OUTPERFORM/.test(value)) return 1;
  if (/SELL|매도|UNDERPERFORM/.test(value)) return -1;
  if (/HOLD|중립|NEUTRAL/.test(value)) return 0;
  return null;
};

function priceMetrics(closes: number[], benchmark: number[]) {
  const last = closes.at(-1) ?? null;
  const at = (days: number) => closes.length > days ? closes[closes.length - 1 - days] : null;
  const returns = closes.slice(-61).map((value, index, rows) => index ? value / rows[index - 1] - 1 : null).filter((v): v is number => v != null && Number.isFinite(v));
  const peak = closes.length ? Math.max(...closes.slice(-252)) : null;
  const benchmark20 = benchmark.length > 20 ? pct(benchmark.at(-1)!, benchmark[benchmark.length - 21]) : null;
  const momentum20 = pct(last, at(20));
  return { momentum20Pct: momentum20, momentum60Pct: pct(last, at(60)), relativeStrengthPct: momentum20 != null && benchmark20 != null ? momentum20 - benchmark20 : null, drawdownPct: last != null && peak ? (last / peak - 1) * 100 : null, volatilityPct: returns.length > 1 ? (stddev(returns)! * Math.sqrt(252) * 100) : null, shortTermSurgePct: pct(last, at(5)), historyDays: closes.length };
}

function reportObservation(row: any): ResearchObservation {
  const currentRating = ratingValue(row.rating);
  const previousRating = ratingValue(row.previous_rating);
  return { broker: row.research_documents?.broker ?? row.research_documents?.source ?? null, publishedAt: row.published_at, epsRevisionPct: row.eps_revision_pct == null ? null : Number(row.eps_revision_pct), targetPriceRevisionPct: pct(row.target_price == null ? null : Number(row.target_price), row.previous_target_price == null ? null : Number(row.previous_target_price)), ratingRevision: currentRating == null || previousRating == null ? null : Math.sign(currentRating - previousRating) as -1 | 0 | 1, investmentPointStrength: Array.isArray(row.investment_points) ? Math.min(5, row.investment_points.length) : null };
}

export async function runDailyTopPicks(origin: string, dependencies: { db?: typeof supabase; generate?: StructuredGenerator; collect?: typeof collectCurrentResearch; prepare?: typeof prepareResearchInputs } = {}) {
  const db = dependencies.db ?? supabase;
  if (!db) throw new Error("Supabase 미설정");
  const tradeDate = todayKst();
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: stockRows, error: stockError }, { data: marketRows, error: marketError }, savedReports, crawled] = await Promise.all([
    db.from("stock_research").select("*, research_documents(id,title,source,broker,analyst,published_at,source_url)").gte("published_at", cutoff).lte("published_at", tradeDate + "T23:59:59+09:00").not("ticker", "is", null).order("published_at", { ascending: false }).limit(500),
    db.from("market_research").select("*, research_documents(id,title,source,broker,published_at,source_url)").order("created_at", { ascending: false }).limit(100),
    getSavedResearchReports(db),
    (dependencies.collect ?? collectCurrentResearch)(),
  ]);
  if (stockError) throw stockError;
  if (marketError) throw marketError;
  const uniqueStockRows = deduplicateCanonicalStocks(stockRows ?? []);
  const prepared = await (dependencies.prepare ?? prepareResearchInputs)({ crawled, saved: savedReports, canonical: [...(marketRows ?? []), ...uniqueStockRows] });
  const briefResult = await buildMarketBrief(prepared.reports, tradeDate, dependencies.generate);
  const brief = briefResult.value;
  const localizedThemes = brief.themes;
  // Market prices remain display/scoring data; narrative generation only receives research.
  const indicatorResponse = await fetch(origin + "/api/market", { cache: "no-store" }).then((r) => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }));
  const regimeByTheme = Object.fromEntries(localizedThemes.map((theme: any) => [String(theme.themeCode), Math.max(-1, Math.min(1, Number(theme.score) || 0))]));
  const byTicker = new Map<string, any[]>();
  for (const row of uniqueStockRows) { const rows = byTicker.get(row.ticker) ?? []; rows.push(row); byTicker.set(row.ticker, rows); }
  const tickers: Array<[string, any[]]> = Array.from(byTicker.entries()).sort((a, b) => String(b[1][0]?.published_at).localeCompare(String(a[1][0]?.published_at))).slice(0, 50);
  const [krBenchmark, usBenchmark] = tickers.length ? await Promise.all([resolveTickerInput("^KS11").then(fetchTickerOhlcDaily), resolveTickerInput("^GSPC").then(fetchTickerOhlcDaily)]) : [{ bars: [] }, { bars: [] }];
  const scored = [];
  for (const [ticker, reports] of tickers) {
    try {
      const resolved = await resolveTickerInput(ticker);
      const [daily, financial] = await Promise.all([fetchTickerOhlcDaily(resolved), fetchFinancialSnapshot(resolved.symbol)]);
      const benchmark = (resolved.domesticCode ? krBenchmark : usBenchmark).bars.map((bar) => bar.close);
      const targets = reports.map((r: any) => r.target_price == null ? null : Number(r.target_price)).filter((v: number | null): v is number => v != null && Number.isFinite(v));
      const eps = reports.map((r: any) => r.eps_revision_pct == null ? null : Number(r.eps_revision_pct)).filter((v: number | null): v is number => v != null && Number.isFinite(v));
      const ratings = reports.map((r: any) => ratingValue(r.rating)).filter((v: number | null): v is number => v != null);
      const targetMean = mean(targets);
      const themes = Array.from(new Set<string>(reports.flatMap((r: any) => Array.isArray(r.themes) ? r.themes.filter((theme: unknown): theme is string => typeof theme === "string") : [])));
      const volumes = daily.bars.slice(-20).map((b) => Number(b.volume)).filter(Number.isFinite);
      const averageTurnover = (mean(volumes) ?? 0) * daily.lastPrice;
      const input: ScoreInput = { ticker, company: reports[0].company_name ?? daily.name ?? ticker, market: reports[0].market ?? daily.exchange ?? (resolved.domesticCode ? "KR" : "US"), sector: reports[0].sector ?? null, themes, research: reports.map((row: any) => reportObservation(row)), fundamental: { epsRevisionPct: mean(eps), earningsGrowthPct: financial.earningsGrowthPct, revenueGrowthPct: financial.revenueGrowthPct, roePct: financial.roePct, relativeValuationPct: null, forwardPe: financial.forwardPe, priceToBook: financial.priceToBook }, price: priceMetrics(daily.bars.map((b) => b.close), benchmark), consensus: { buyRatioPct: ratings.length ? ratings.filter((v: number) => v > 0).length / ratings.length * 100 : null, targetUpsidePct: targetMean == null ? null : pct(targetMean, daily.lastPrice), epsRevisionPct: mean(eps), targetDispersionPct: targetMean && targets.length > 1 ? (stddev(targets)! / targetMean) * 100 : null }, regimeByTheme, minimumLiquidityMet: resolved.domesticCode ? averageTurnover >= 1_000_000_000 : averageTurnover >= 1_000_000 };
      scored.push(scoreStock(input));
    } catch (error) { console.warn(`[dailyTopPicks] ${ticker} skipped`, (error as Error).message); }
  }
  const previousDateResult = await db.from("daily_top_picks").select("trade_date").lt("trade_date", tradeDate).eq("is_dropped", false).order("trade_date", { ascending: false }).limit(1).maybeSingle();
  const previousDate = previousDateResult.data?.trade_date;
  const previousResult = previousDate ? await db.from("daily_top_picks").select("ticker,rank,total_score,confidence_score,pick_type").eq("trade_date", previousDate).eq("is_dropped", false) : { data: [] as any[] };
  const previousRanks = new Map((previousResult.data ?? []).map((row: any) => [row.ticker, Number(row.rank)]));
  const previousPickByTicker = new Map((previousResult.data ?? []).map((row: any) => [row.ticker, row]));
  const previousSignalsResult = previousDate ? await db.from("daily_stock_signals").select("ticker,research_score,fundamental_score,price_score,consensus_score,regime_score,total_score,confidence_score,input_snapshot").eq("trade_date", previousDate) : { data: [] as any[] };
  const previousSignalByTicker = new Map((previousSignalsResult.data ?? []).map((row: any) => [row.ticker, row]));
  const picks = selectTopPicks(scored, previousRanks);
  const explanations = await explainResearchPicks(picks, byTicker, dependencies.generate);
  const signalRows = scored.map((stock) => ({ trade_date: tradeDate, ticker: stock.ticker, company_name: stock.company, market: stock.market, sector: stock.sector, themes: stock.themes, research_score: stock.researchScore, fundamental_score: stock.fundamentalScore, price_score: stock.priceScore, consensus_score: stock.consensusScore, regime_score: stock.regimeScore, total_score: stock.totalScore, confidence_score: stock.confidenceScore, rank: picks.find((p) => p.ticker === stock.ticker)?.rank ?? null, pick_type: stock.pickType, score_breakdown: stock.breakdown, input_snapshot: { fundamental: stock.fundamental, price: stock.price, consensus: stock.consensus }, source_document_ids: (byTicker.get(stock.ticker) ?? []).map((r) => r.document_id), scoring_version: "top-picks-v1" }));
  if (signalRows.length) { const { error } = await db.from("daily_stock_signals").upsert(signalRows, { onConflict: "trade_date,ticker" }); if (error) throw error; }
  const changeSnapshot = (ticker: string, current: any) => {
    const previous: any = previousSignalByTicker.get(ticker);
    if (!previous) return {};
    return {
      researchScore: { previous: Number(previous.research_score), current: current?.researchScore ?? null },
      fundamentalScore: { previous: Number(previous.fundamental_score), current: current?.fundamentalScore ?? null },
      priceScore: { previous: Number(previous.price_score), current: current?.priceScore ?? null },
      consensusScore: { previous: Number(previous.consensus_score), current: current?.consensusScore ?? null },
      regimeScore: { previous: Number(previous.regime_score), current: current?.regimeScore ?? null },
      totalScore: { previous: Number(previous.total_score), current: current?.totalScore ?? null },
      inputs: { previous: previous.input_snapshot ?? null, current: current ? { fundamental: current.fundamental, price: current.price, consensus: current.consensus } : null },
    };
  };
  const topRows: any[] = picks.map((pick) => { const explanation: any = explanations.get(pick.ticker) ?? {}; return { trade_date: tradeDate, ticker: pick.ticker, rank: pick.rank, previous_rank: pick.previousRank, rank_change: pick.rankChange, is_new: pick.isNew, is_dropped: false, total_score: pick.totalScore, confidence_score: pick.confidenceScore, pick_type: pick.pickType, summary: explanation.summary ?? null, key_reasons: explanation.keyReasons ?? [], risks: explanation.risks ?? [], signal_changes: changeSnapshot(pick.ticker, pick), source_document_ids: (byTicker.get(pick.ticker) ?? []).map((r) => r.document_id) }; });
  for (const ticker of droppedTickers(previousRanks, picks)) {
    const previous: any = previousPickByTicker.get(ticker);
    const current = scored.find((stock) => stock.ticker === ticker);
    topRows.push({ trade_date: tradeDate, ticker, rank: null, previous_rank: previousRanks.get(ticker)!, rank_change: null, is_new: false, is_dropped: true, total_score: current?.totalScore ?? Number(previous?.total_score), confidence_score: current?.confidenceScore ?? Number(previous?.confidence_score), pick_type: current?.pickType ?? previous?.pick_type, summary: null, key_reasons: [], risks: [], signal_changes: changeSnapshot(ticker, current), source_document_ids: (byTicker.get(ticker) ?? []).map((r) => r.document_id) });
  }
  // Remove stale selections from an earlier run on the same date, including zero-pick runs.
  const { error: resetError } = await db.from("daily_top_picks").update({ is_dropped: true, rank: null }).eq("trade_date", tradeDate);
  if (resetError) throw resetError;
  if (topRows.length) { const { error } = await db.from("daily_top_picks").upsert(topRows, { onConflict: "trade_date,ticker" }); if (error) throw error; }
  const { error: briefError } = await db.from("daily_market_briefs").upsert({ trade_date: tradeDate, headline: brief.headline, market_summary: brief.marketSummary, narrative_timeline: brief.timeline, key_issues: brief.keyIssues, themes: localizedThemes, watch_points: brief.watchPoints, asset_view: brief.assetView, indicators: indicatorResponse.items ?? [], source_document_ids: briefResult.sourceDocumentIds, model: briefResult.model }, { onConflict: "trade_date" });
  if (briefError) throw briefError;
  return { tradeDate, researchCount: prepared.reports.length, mergedResearchCount: prepared.mergedCount, excludedResearchCount: prepared.excludedCount, candidateCount: scored.length, topPickCount: picks.length, droppedCount: topRows.filter((r) => r.is_dropped).length, model: briefResult.model };
}
