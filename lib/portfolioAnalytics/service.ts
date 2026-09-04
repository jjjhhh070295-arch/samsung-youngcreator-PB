import { analyzePortfolio, validateRequest } from "./analytics";
import { marketDataProvider, type MarketDataProvider } from "./marketData";
import type { Holding, MarketData, Options } from "./types";

export async function portfolioAnalytics(holdings: Holding[], options: Options, provider: MarketDataProvider = marketDataProvider) {
  validateRequest(holdings, options);
  const needsFx = holdings.some(h => h.currency !== options.baseCurrency);
  const fxPromise = needsFx ? provider.usdKrw(options.years).catch(() => null) : Promise.resolve(null);
  const data: MarketData[] = [];
  // Limit upstream concurrency; weights/rebalance changes reuse the same cache.
  for (let i = 0; i < holdings.length; i += 6) {
    data.push(...await Promise.all(holdings.slice(i, i + 6).map(h => provider.holding(h, options.years).catch(() => ({
      prices: [], source: [], warnings: [{ type: "DATA_UNAVAILABLE", ticker: h.ticker, message: "종목 가격 조회 실패: 과거 지표를 계산할 수 없습니다." }],
    })))));
  }
  return analyzePortfolio(holdings, data, await fxPromise, options);
}
