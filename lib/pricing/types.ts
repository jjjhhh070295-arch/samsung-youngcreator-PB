export interface PriceQuote {
  ticker: string;
  price: number | null;
  currency: "KRW" | "USD";
  as_of: string;
  source: "kis" | string;
  stale?: boolean;
}

export interface PricingProvider {
  getQuotes(tickers: { ticker: string; currency: "KRW" | "USD" }[]): Promise<PriceQuote[]>;
}
