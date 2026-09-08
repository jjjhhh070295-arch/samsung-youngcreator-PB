/**
 * 시세·보유 매칭에 쓰는 공통 종목 식별.
 * Yahoo 스타일 접미사(.KS/.KQ)는 KIS 국내 시세 요청에서 떼고,
 * 응답·캐시·보유 매칭은 원래 심볼과도 연결한다.
 */

export type ProviderVenue = "kis_domestic" | "kis_overseas" | "unsupported";

export interface ResolvedInstrument {
  /** 호출부/보유에 저장된 원래 심볼 */
  requestSymbol: string;
  /** 프로바이더에 실제로 보낼 코드 */
  providerSymbol: string;
  venue: ProviderVenue;
  /** 캐시 키 (venue + providerSymbol + currency) */
  cacheKey: string;
  /** 보유 중복 판별용 정규화 키 */
  identityKey: string;
}

const DOMESTIC_ALIAS = /^([0-9A-Z]{6})\.(KS|KQ)$/i;
const DOMESTIC_BARE = /^[0-9A-Z]{6}$/i;

function isDomesticStockCode(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return DOMESTIC_BARE.test(normalized) && /\d/.test(normalized);
}

/** 국내 상장 코드만 추출. 외국 티커·비표준 식별자는 null. */
export function domesticProviderCode(symbol: string): string | null {
  const raw = (symbol || "").trim().toUpperCase();
  if (!raw) return null;
  const aliased = raw.match(DOMESTIC_ALIAS);
  if (aliased && isDomesticStockCode(aliased[1])) return aliased[1];
  if (isDomesticStockCode(raw)) return raw;
  return null;
}

export function identityKeyForSymbol(symbol: string, currency = "KRW"): string {
  const cur = (currency || "KRW").toUpperCase();
  const domestic = domesticProviderCode(symbol);
  if (domestic) return `KR:${domestic}`;
  return `${cur}:${(symbol || "").trim().toUpperCase()}`;
}

export function symbolsEquivalent(a: string, b: string, currency = "KRW"): boolean {
  if (!a || !b) return false;
  return identityKeyForSymbol(a, currency) === identityKeyForSymbol(b, currency);
}

/**
 * KIS 시세 조회용 해석.
 * - KRW + 국내 6자리(.KS/.KQ 포함) → kis_domestic, provider=bare
 * - USD → kis_overseas (심볼 그대로, 접미사 제거 안 함)
 * - 그 외 → unsupported (직접채권·비상장 등 — 국내주식 엔드포인트로 보내지 않음)
 */
export function resolveInstrumentForPricing(
  symbol: string,
  currency: "KRW" | "USD" | string = "KRW",
): ResolvedInstrument {
  const requestSymbol = (symbol || "").trim();
  const cur = (currency || "KRW").toUpperCase() as "KRW" | "USD";

  if (cur === "USD") {
    const providerSymbol = requestSymbol.toUpperCase();
    return {
      requestSymbol,
      providerSymbol,
      venue: "kis_overseas",
      cacheKey: `kis_overseas|${providerSymbol}|USD`,
      identityKey: identityKeyForSymbol(requestSymbol, "USD"),
    };
  }

  const domestic = domesticProviderCode(requestSymbol);
  if (domestic) {
    return {
      requestSymbol,
      providerSymbol: domestic,
      venue: "kis_domestic",
      cacheKey: `kis_domestic|${domestic}|KRW`,
      identityKey: identityKeyForSymbol(requestSymbol, "KRW"),
    };
  }

  return {
    requestSymbol,
    providerSymbol: requestSymbol,
    venue: "unsupported",
    cacheKey: `unsupported|${requestSymbol.toUpperCase()}|${cur}`,
    identityKey: identityKeyForSymbol(requestSymbol, cur),
  };
}

/** 보유 저장용 — 국내는 bare 코드로 통일해 중복(.KS)을 줄인다. */
export function canonicalHoldingTicker(symbol: string, currency = "KRW"): string {
  const cur = (currency || "KRW").toUpperCase();
  if (cur === "USD") return (symbol || "").trim().toUpperCase();
  return domesticProviderCode(symbol) ?? (symbol || "").trim();
}

/** quote 맵에서 동등 심볼로 조회 */
export function findQuoteBySymbol<T extends { ticker?: string }>(
  quotes: T[] | Map<string, T>,
  symbol: string,
  currency = "KRW",
): T | undefined {
  const key = identityKeyForSymbol(symbol, currency);
  if (quotes instanceof Map) {
    const entries = Array.from(quotes.entries());
    for (let i = 0; i < entries.length; i++) {
      const [ticker, q] = entries[i];
      if (identityKeyForSymbol(ticker, currency) === key) return q;
    }
    return undefined;
  }
  for (let i = 0; i < quotes.length; i++) {
    const q = quotes[i];
    if (q.ticker && identityKeyForSymbol(q.ticker, currency) === key) return q;
  }
  return undefined;
}
