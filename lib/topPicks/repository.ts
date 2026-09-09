import { supabase } from "@/lib/supabase";
import { fetchTickerOhlcDaily, resolveTickerInput } from "@/lib/advisory/tickerOhlcData";
import { demoTopPickDetail } from "./demoData";
import { sharedMarketBrief } from "./sharedMarket";

const MISSING = new Set(["42P01", "PGRST205"]);
const arrays = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export async function getDashboardHome(db = supabase) {
  if (!db) return { ready: false, date: null, marketBrief: null, topPicks: [] };
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [latestResult, morningResult, researchResult] = await Promise.all([
    db.from("daily_top_picks").select("trade_date").eq("is_dropped", false).order("trade_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("daily_reports").select("report_date,headline,text_body,model,status").order("report_date", { ascending: false }).limit(1).maybeSingle(),
    db.from("research_signals").select("report_id,title,source,url,date,summary,signals,model").gte("date", cutoff).neq("model", "dummy").order("date", { ascending: false }).limit(30),
  ]);
  const errors = [latestResult, morningResult, researchResult].flatMap((result) => result.error && !MISSING.has(result.error.code) ? [result.error] : []);
  const latest = latestResult.data;
  const shared = sharedMarketBrief(morningResult.data, researchResult.data ?? []);
  const date = latest?.trade_date ?? null;
  const [picksResult, signalsResult] = date ? await Promise.all([
    db.from("daily_top_picks").select("*").eq("trade_date", date).eq("is_dropped", false).order("rank"),
    db.from("daily_stock_signals").select("ticker, company_name, market, sector, themes, research_score, fundamental_score, price_score, consensus_score, regime_score, score_breakdown").eq("trade_date", date),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  for (const result of [picksResult, signalsResult]) if (result.error) errors.push(result.error);
  const picks = picksResult.data;
  const signals = signalsResult.data;
  const marketBrief = shared;
  const ready = Boolean(marketBrief || picks?.length);
  if (!ready && errors.length) throw errors[0];
  if (errors.length) console.warn("[dashboard/home] partial data", errors.map((error) => error.code));
  const signalByTicker = new Map((signals ?? []).map((row: any) => [row.ticker, row]));
  return {
    ready, date: shared?.date ?? date, topPicksDate: date,
    warning: errors.length ? "일부 분석 결과를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요." : null,
    marketBrief,
    topPicks: (picks ?? []).map((pick: any) => {
      const signal: any = signalByTicker.get(pick.ticker) ?? {};
      return { rank: pick.rank, previousRank: pick.previous_rank, rankChange: pick.rank_change, isNew: pick.is_new, ticker: pick.ticker, company: signal.company_name ?? pick.ticker, market: signal.market ?? null, sector: signal.sector ?? null, themes: signal.themes ?? [], score: Number(pick.total_score), confidence: Number(pick.confidence_score), type: pick.pick_type, summary: pick.summary ?? "", keyReasons: arrays(pick.key_reasons), risks: arrays(pick.risks), scores: { research: Number(signal.research_score ?? 0), fundamental: Number(signal.fundamental_score ?? 0), price: Number(signal.price_score ?? 0), consensus: Number(signal.consensus_score ?? 0), regime: Number(signal.regime_score ?? 0) }, breakdown: signal.score_breakdown ?? {} };
    }),
  };
}

export async function getTopPickDetail(ticker: string) {
  if (!supabase) return demoTopPickDetail(ticker);
  const { data: latest } = await supabase.from("daily_stock_signals").select("*").eq("ticker", ticker).order("trade_date", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const [{ data: history }, { data: research }, { data: pick }] = await Promise.all([
    supabase.from("daily_stock_signals").select("trade_date, research_score, fundamental_score, price_score, consensus_score, regime_score, total_score, confidence_score, rank").eq("ticker", ticker).order("trade_date", { ascending: false }).limit(30),
    supabase.from("stock_research").select("document_id, published_at, rating, previous_rating, target_price, previous_target_price, eps_revision_pct, investment_points, risk_factors, themes, research_documents(title, source, broker, analyst, source_url)").eq("ticker", ticker).order("published_at", { ascending: false }).limit(20),
    supabase.from("daily_top_picks").select("summary, key_reasons, risks, previous_rank, rank_change, pick_type").eq("ticker", ticker).eq("trade_date", latest.trade_date).maybeSingle(),
  ]);
  const priceChart = await resolveTickerInput(ticker)
    .then(fetchTickerOhlcDaily)
    .then((daily) => ({ asOf: daily.asOf, currency: daily.currency, source: daily.historySource, bars: daily.bars.slice(-120) }))
    .catch(() => null);
  return { ticker, company: latest.company_name, market: latest.market, sector: latest.sector, themes: latest.themes ?? [], date: latest.trade_date, score: Number(latest.total_score), confidence: Number(latest.confidence_score), type: pick?.pick_type ?? latest.pick_type, scores: { research: Number(latest.research_score), fundamental: Number(latest.fundamental_score), price: Number(latest.price_score), consensus: Number(latest.consensus_score), regime: Number(latest.regime_score) }, breakdown: latest.score_breakdown, inputSnapshot: latest.input_snapshot, sourceDocumentIds: latest.source_document_ids ?? [], summary: pick?.summary ?? "", keyReasons: arrays(pick?.key_reasons), risks: arrays(pick?.risks), previousRank: pick?.previous_rank ?? null, rankChange: pick?.rank_change ?? null, history: history ?? [], research: research ?? [], priceChart };
}
