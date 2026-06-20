export interface PriceQuote {
  ticker: string;
  price: number | null;
  currency: "KRW" | "USD";
  as_of: string;
  source: "kis";
  stale: boolean;
}

export interface PricingProvider {
  getQuotes(tickers: { ticker: string; currency: "KRW" | "USD" }[]): Promise<PriceQuote[]>;
  getFxUsdKrw(): Promise<number>;
}

export function computeRow(
  h: { quantity: number; avg_price: number | null; currency: string },
  quote: { price: number | null },
  fxUsdKrw: number
) {
  if (quote.price == null) return { evalAmount: null, pnl: null, returnPct: null, priced: false };
  const evalLocal = h.quantity * quote.price;
  const evalKrw = h.currency === "USD" ? evalLocal * fxUsdKrw : evalLocal;
  const pnl = h.avg_price != null ? (quote.price - h.avg_price) * h.quantity : null;
  const returnPct = h.avg_price && h.avg_price !== 0
    ? ((quote.price - h.avg_price) / h.avg_price) * 100
    : null;
  return { evalAmount: Math.round(evalKrw), pnl: pnl != null ? Math.round(pnl) : null, returnPct, priced: true };
}
