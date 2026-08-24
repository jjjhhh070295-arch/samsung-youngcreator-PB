export interface TickerRequestToken {
  generation: number;
  scopeKey: string;
}

export type TickerAvailableSubview = "momentum" | "flows";

export interface TickerAnalysisHrefOptions {
  symbol?: string;
  subview?: TickerAvailableSubview;
}

export function tickerClientScope(clientId?: string) {
  return clientId?.trim() || "global";
}

export function tickerContextClientId(routeClientId?: string, queryClientId?: string | null) {
  return routeClientId?.trim() || queryClientId?.trim() || undefined;
}

export function tickerAnalysisHref(
  pbId: string,
  clientId?: string,
  options: TickerAnalysisHrefOptions = {},
) {
  const normalizedClientId = tickerContextClientId(clientId);
  const base = `/pb/${encodeURIComponent(pbId)}/ticker`;
  const query = new URLSearchParams();
  if (normalizedClientId) query.set("clientId", normalizedClientId);
  if (options.symbol?.trim()) query.set("symbol", options.symbol.trim());
  if (options.subview) query.set("subview", options.subview);
  const encodedQuery = query.toString();
  return encodedQuery ? `${base}?${encodedQuery}` : base;
}

export function tickerSubviewFromQuery(value?: string | null): TickerAvailableSubview {
  return value === "flows" || value === "flow-short" ? "flows" : "momentum";
}

export function tickerFlowScope(clientId: string | undefined, symbol = "") {
  const normalizedSymbol = symbol.trim();
  return `${tickerClientScope(clientId)}:${normalizedSymbol}`;
}

/**
 * 느린 종목 A 응답이 더 늦게 도착해 최신 종목 B 상태를 덮지 못하게 하는 순수 guard.
 * 네트워크 취소와 별개로 모든 비동기 state commit 직전에 검사한다.
 */
export function createTickerRequestGuard(initialScopeKey = "") {
  let generation = 0;
  let scopeKey = initialScopeKey;

  return {
    begin(nextScopeKey = scopeKey): TickerRequestToken {
      scopeKey = nextScopeKey;
      generation += 1;
      return { generation, scopeKey };
    },
    current(): TickerRequestToken {
      return { generation, scopeKey };
    },
    invalidate(nextScopeKey = scopeKey): TickerRequestToken {
      scopeKey = nextScopeKey;
      generation += 1;
      return { generation, scopeKey };
    },
    isCurrent(token: TickerRequestToken) {
      return token.generation === generation && token.scopeKey === scopeKey;
    },
  };
}

export type TickerRequestGuard = ReturnType<typeof createTickerRequestGuard>;
