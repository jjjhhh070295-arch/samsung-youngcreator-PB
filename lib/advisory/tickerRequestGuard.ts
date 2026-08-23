export interface TickerRequestToken {
  generation: number;
  scopeKey: string;
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
