import type {
  BondEtfMetricOverride,
  BondEtfScenarioSettings,
} from "./types";

export function createDefaultBondEtfScenarioSettings(): BondEtfScenarioSettings {
  return {
    rateChangeBp: 0,
    spreadChangeBp: 0,
    allowMissingSpreadDuration: false,
    overridesBySymbol: {},
  };
}

export function bondEtfSymbolKey(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.(KS|KQ)$/, "");
}

export function findBondEtfOverride(
  settings: BondEtfScenarioSettings | null | undefined,
  symbol: string,
): BondEtfMetricOverride | undefined {
  if (!settings) return undefined;
  const exact = settings.overridesBySymbol[symbol];
  if (exact) return exact;
  const key = bondEtfSymbolKey(symbol);
  return Object.entries(settings.overridesBySymbol).find(
    ([candidate]) => bondEtfSymbolKey(candidate) === key,
  )?.[1];
}

export function emptyBondEtfMetricOverride(): BondEtfMetricOverride {
  return {
    ytmPct: null,
    effectiveDurationYears: null,
    spreadDurationYears: null,
    expenseRatioPct: null,
    asOf: "",
    sourceLabel: "",
    sourceUrl: "",
  };
}
