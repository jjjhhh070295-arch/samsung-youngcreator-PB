export interface PriceQuote {
  /** 요청에 넣은 원래 심볼 (보유 ticker와 매칭) */
  ticker: string;
  /** KIS 등 프로바이더에 실제로 보낸 코드 */
  providerSymbol?: string;
  price: number | null;
  currency: "KRW" | "USD";
  /** 서버가 응답을 받은 시각 (ISO) — 거래시각이 아님 */
  as_of: string;
  /** 거래소 체결/시세 시각이 있으면 ISO 또는 HHMMSS */
  quote_time?: string | null;
  /** true = 장중 실시간으로 볼 수 있는 값. 장마감 종가는 false */
  is_live?: boolean;
  source: "kis";
  stale: boolean;
  error_code?: string | null;
  error_message?: string | null;
}

export interface PricingProvider {
  getQuotes(
    tickers: { ticker: string; currency: "KRW" | "USD" }[],
    opts?: { skipCache?: boolean },
  ): Promise<PriceQuote[]>;
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
