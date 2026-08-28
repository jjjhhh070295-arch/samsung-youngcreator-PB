/**
 * KIS Open API configuration (server-side only — never expose via NEXT_PUBLIC_).
 *
 * Order division codes verified against KIS domestic cash order documentation:
 *   ORD_DVSN "00" — limit (지정가)
 *   ORD_DVSN "06" — after-hours limit (장후 시간외)
 */

export const KIS_DEFAULT_BASE_URL = "https://openapi.koreainvestment.com:9443";

/** Real (live) account order TR IDs — not paper/VTS. */
export const LIVE_ORDER_TR = {
  buy: "TTTC0012U",
  sell: "TTTC0011U",
  cancel: "TTTC0013U",
} as const;

/** Limit order during regular session. */
export const ORD_DVSN_LIMIT = "00";

/** After-close (장후 시간외) limit order. */
export const ORD_DVSN_AFTER_CLOSE = "06";

const PAPER_URL_MARKERS = ["openapivts", ":29443"];

export interface KisConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  cano: string;
  acntPrdtCd: string;
  liveTradingEnabled: boolean;
  maxOrderWon: number;
  maxDailyOrderWon: number;
  conditionSeq: string | null;
}

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export function getKisConfig(): KisConfig {
  return {
    baseUrl: process.env.KIS_BASE_URL?.trim() || KIS_DEFAULT_BASE_URL,
    appKey: process.env.KIS_APP_KEY?.trim() ?? "",
    appSecret: process.env.KIS_APP_SECRET?.trim() ?? "",
    cano: process.env.KIS_CANO?.trim() ?? "",
    acntPrdtCd: process.env.KIS_ACNT_PRDT_CD?.trim() ?? "",
    liveTradingEnabled: parseBool(process.env.KIS_LIVE_TRADING_ENABLED, false),
    maxOrderWon: parsePositiveInt(process.env.KIS_MAX_ORDER_WON, 10_000_000),
    maxDailyOrderWon: parsePositiveInt(process.env.KIS_MAX_DAILY_ORDER_WON, 50_000_000),
    conditionSeq: process.env.KIS_CONDITION_SEQ?.trim() || null,
  };
}

export function isRealKisBaseUrl(baseUrl: string): boolean {
  const lower = baseUrl.toLowerCase();
  return !PAPER_URL_MARKERS.some((marker) => lower.includes(marker));
}

export function isLiveTradingEnabled(): boolean {
  const config = getKisConfig();
  return config.liveTradingEnabled && isRealKisBaseUrl(config.baseUrl);
}

export function assertLiveOrderAllowed(): void {
  const config = getKisConfig();
  if (!config.liveTradingEnabled) {
    throw new Error("KIS live trading is disabled (KIS_LIVE_TRADING_ENABLED=false).");
  }
  if (!isRealKisBaseUrl(config.baseUrl)) {
    throw new Error(
      `KIS base URL must be a real (non-paper) endpoint; rejected: ${config.baseUrl}`,
    );
  }
  if (!config.appKey || !config.appSecret) {
    throw new Error("KIS_APP_KEY and KIS_APP_SECRET are required for live orders.");
  }
  if (!config.cano || !config.acntPrdtCd) {
    throw new Error("KIS_CANO and KIS_ACNT_PRDT_CD are required for live orders.");
  }
}
