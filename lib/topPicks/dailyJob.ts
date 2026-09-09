import { supabase } from "@/lib/supabase";
import { fetchFinancialSnapshot, fetchTickerOhlcDaily, resolveTickerInput } from "@/lib/advisory/tickerOhlcData";
import { scoreStock } from "./scoring";
import { droppedTickers, selectTopPicks } from "./selection";
import { generateStructured } from "./researchPipeline";
import type { ResearchObservation, ScoreInput, SelectedTopPick } from "./types";
import { localizeTheme } from "./themeLabels";

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

const BRIEF_SCHEMA = { type: "object", properties: { headline: { type: "string" }, marketSummary: { type: "string" }, timeline: { type: "object", properties: { twoWeeks: { type: "string" }, threeDays: { type: "string" }, today: { type: "string" } }, required: ["twoWeeks","threeDays","today"] }, keyIssues: { type: "array", items: { type: "object", properties: { title: { type: "string" }, summary: { type: "string" }, whatChanged: { type: "string" }, marketImpact: { type: "string" }, watchPoint: { type: "string" } }, required: ["title","summary","whatChanged","marketImpact","watchPoint"] } }, themes: { type: "array", items: { type: "object", properties: { theme: { type: "string" }, score: { type: "number" }, direction: { type: "string", enum: ["POSITIVE","NEUTRAL","NEGATIVE"] }, reason: { type: "string" } }, required: ["theme","score","direction","reason"] } }, watchPoints: { type: "array", items: { type: "string" } }, assetView: { type: "object", properties: { equity: { type: "string" }, bond: { type: "string" }, usd: { type: "string" }, oil: { type: "string" } }, required: ["equity","bond","usd","oil"] } }, required: ["headline","marketSummary","timeline","keyIssues","themes","watchPoints","assetView"] };
const EXPLANATION_SCHEMA = { type: "object", properties: { explanations: { type: "array", items: { type: "object", properties: { ticker: { type: "string" }, summary: { type: "string" }, keyReasons: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } } }, required: ["ticker","summary","keyReasons","risks"] } } }, required: ["explanations"] };

async function buildMarketBrief(indicators: unknown[], marketResearch: any[], morningBrief: any | null) {
  const prompt = `PB용 오늘의 시장 브리프를 한국어로 구체적으로 구조화하라.
규칙: 최근 14일→최근 3일→오늘 사이에 무엇이 바뀌었는지 분리한다. 각 이슈에는 변화, 시장 영향, 다음 확인 포인트를 쓴다. 수치는 입력에 있는 것만 사용하고 없으면 숫자를 만들지 않는다. 과장·투자보장 표현 금지. themes의 theme은 영문 표준 코드, score는 -1~1이다.
시장지표:${JSON.stringify(indicators)}
기존 Claude 모닝 브리핑(웹검색·출처 포함):${JSON.stringify(morningBrief ? { headline: morningBrief.headline, text: String(morningBrief.text_body ?? "").slice(0, 35_000), sources: morningBrief.sources ?? [] } : null)}
최근 구조화 리서치:${JSON.stringify(marketResearch.slice(0, 60))}`;
  return generateStructured(prompt, BRIEF_SCHEMA);
}

async function explainPicks(picks: SelectedTopPick[], researchByTicker: Map<string, any[]>) {
  if (!picks.length) return new Map<string, any>();
  const payload = picks.map((pick) => ({ ticker: pick.ticker, company: pick.company, rank: pick.rank, totalScore: pick.totalScore, confidenceScore: pick.confidenceScore, scores: { research: pick.researchScore, fundamental: pick.fundamentalScore, price: pick.priceScore, consensus: pick.consensusScore, regime: pick.regimeScore }, breakdown: pick.breakdown, recentResearch: (researchByTicker.get(pick.ticker) ?? []).slice(0, 8).map((r) => ({ publishedAt: r.published_at, rating: r.rating, previousRating: r.previous_rating, targetPrice: r.target_price, previousTargetPrice: r.previous_target_price, epsRevisionPct: r.eps_revision_pct, investmentPoints: r.investment_points, risks: r.risk_factors })) }));
  const result = await generateStructured(`순위와 종목을 절대 변경하지 말고, DB 수치와 리서치만으로 PB가 고객에게 설명할 문구를 작성하라. '반드시 상승/확실한 수익/무조건 매수' 금지. 입력:${JSON.stringify(payload)}`, EXPLANATION_SCHEMA);
  const rows = (result.value as any)?.explanations;
  return new Map((Array.isArray(rows) ? rows : []).map((row: any) => [row.ticker, row]));
}

export async function runDailyTopPicks(origin: string) {
  if (!supabase) throw new Error("Supabase 미설정");
  const tradeDate = todayKst();
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [{ data: stockRows, error: stockError }, { data: marketRows, error: marketError }, { data: morningBrief }] = await Promise.all([
    supabase.from("stock_research").select("*, research_documents(id,title,source,broker,analyst,source_url)").gte("published_at", cutoff).not("ticker", "is", null).order("published_at", { ascending: false }).limit(500),
    supabase.from("market_research").select("*, research_documents(id,title,source,broker,published_at)").order("created_at", { ascending: false }).limit(100),
    supabase.from("daily_reports").select("headline,text_body,sources,model").eq("report_date", tradeDate).maybeSingle(),
  ]);
  if (stockError) throw stockError;
  if (marketError) throw marketError;
  const indicatorResponse = await fetch(`${origin}/api/market`, { cache: "no-store" }).then((r) => r.json()).catch(() => ({ items: [] }));
  const briefResult = await buildMarketBrief(indicatorResponse.items ?? [], marketRows ?? [], morningBrief ?? null);
  const brief: any = briefResult.value;
  const localizedThemes = (brief.themes ?? []).map((theme: any) => localizeTheme(theme));
  await supabase.from("daily_market_briefs").upsert({ trade_date: tradeDate, headline: brief.headline, market_summary: brief.marketSummary, narrative_timeline: brief.timeline, key_issues: brief.keyIssues, themes: localizedThemes, watch_points: brief.watchPoints, asset_view: brief.assetView, indicators: indicatorResponse.items ?? [], source_document_ids: (marketRows ?? []).map((r: any) => r.document_id), model: `${briefResult.model}${morningBrief?.model ? ` + ${morningBrief.model}` : ""}` }, { onConflict: "trade_date" });
  const regimeByTheme = Object.fromEntries(localizedThemes.map((theme: any) => [String(theme.themeCode), Math.max(-1, Math.min(1, Number(theme.score) || 0))]));
  const byTicker = new Map<string, any[]>();
  for (const row of stockRows ?? []) { const rows = byTicker.get(row.ticker) ?? []; rows.push(row); byTicker.set(row.ticker, rows); }
  const tickers: Array<[string, any[]]> = Array.from(byTicker.entries()).sort((a, b) => String(b[1][0]?.published_at).localeCompare(String(a[1][0]?.published_at))).slice(0, 50);
  const [krBenchmark, usBenchmark] = await Promise.all([resolveTickerInput("^KS11").then(fetchTickerOhlcDaily), resolveTickerInput("^GSPC").then(fetchTickerOhlcDaily)]);
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
  const previousDateResult = await supabase.from("daily_top_picks").select("trade_date").lt("trade_date", tradeDate).eq("is_dropped", false).order("trade_date", { ascending: false }).limit(1).maybeSingle();
  const previousDate = previousDateResult.data?.trade_date;
  const previousResult = previousDate ? await supabase.from("daily_top_picks").select("ticker,rank,total_score,confidence_score,pick_type").eq("trade_date", previousDate).eq("is_dropped", false) : { data: [] as any[] };
  const previousRanks = new Map((previousResult.data ?? []).map((row: any) => [row.ticker, Number(row.rank)]));
  const previousPickByTicker = new Map((previousResult.data ?? []).map((row: any) => [row.ticker, row]));
  const previousSignalsResult = previousDate ? await supabase.from("daily_stock_signals").select("ticker,research_score,fundamental_score,price_score,consensus_score,regime_score,total_score,confidence_score,input_snapshot").eq("trade_date", previousDate) : { data: [] as any[] };
  const previousSignalByTicker = new Map((previousSignalsResult.data ?? []).map((row: any) => [row.ticker, row]));
  const picks = selectTopPicks(scored, previousRanks);
  const explanations = await explainPicks(picks, byTicker);
  const signalRows = scored.map((stock) => ({ trade_date: tradeDate, ticker: stock.ticker, company_name: stock.company, market: stock.market, sector: stock.sector, themes: stock.themes, research_score: stock.researchScore, fundamental_score: stock.fundamentalScore, price_score: stock.priceScore, consensus_score: stock.consensusScore, regime_score: stock.regimeScore, total_score: stock.totalScore, confidence_score: stock.confidenceScore, rank: picks.find((p) => p.ticker === stock.ticker)?.rank ?? null, pick_type: stock.pickType, score_breakdown: stock.breakdown, input_snapshot: { fundamental: stock.fundamental, price: stock.price, consensus: stock.consensus }, source_document_ids: (byTicker.get(stock.ticker) ?? []).map((r) => r.document_id), scoring_version: "top-picks-v1" }));
  if (signalRows.length) { const { error } = await supabase.from("daily_stock_signals").upsert(signalRows, { onConflict: "trade_date,ticker" }); if (error) throw error; }
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
  if (topRows.length) { const { error } = await supabase.from("daily_top_picks").upsert(topRows, { onConflict: "trade_date,ticker" }); if (error) throw error; }
  return { tradeDate, candidateCount: scored.length, topPickCount: picks.length, droppedCount: topRows.filter((r) => r.is_dropped).length, model: briefResult.model };
}
