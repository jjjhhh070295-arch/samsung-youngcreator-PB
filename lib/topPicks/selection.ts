import type { ScoredStock, SelectedTopPick } from "./types";

export const TOP_PICK_RULES = { candidateLimit: 30, pickLimit: 10, minimumScore: 65, minimumConfidence: 60, sectorCap: 3, themeCap: 4 } as const;

export function selectTopPicks(scored: ScoredStock[], previousRanks: Map<string, number> = new Map()): SelectedTopPick[] {
  const candidates = scored
    .filter((stock) => stock.totalScore >= TOP_PICK_RULES.minimumScore && stock.confidenceScore >= TOP_PICK_RULES.minimumConfidence && stock.minimumLiquidityMet)
    .sort((a, b) => b.totalScore - a.totalScore || b.confidenceScore - a.confidenceScore || a.ticker.localeCompare(b.ticker))
    .slice(0, TOP_PICK_RULES.candidateLimit);
  const sectors = new Map<string, number>();
  const themes = new Map<string, number>();
  const selected: ScoredStock[] = [];
  for (const stock of candidates) {
    const sector = stock.sector ?? "UNKNOWN";
    if ((sectors.get(sector) ?? 0) >= TOP_PICK_RULES.sectorCap) continue;
    if (stock.themes.some((theme) => (themes.get(theme) ?? 0) >= TOP_PICK_RULES.themeCap)) continue;
    selected.push(stock);
    sectors.set(sector, (sectors.get(sector) ?? 0) + 1);
    stock.themes.forEach((theme) => themes.set(theme, (themes.get(theme) ?? 0) + 1));
    if (selected.length === TOP_PICK_RULES.pickLimit) break;
  }
  return selected.map((stock, index) => {
    const rank = index + 1;
    const previousRank = previousRanks.get(stock.ticker) ?? null;
    return { ...stock, rank, previousRank, rankChange: previousRank == null ? null : previousRank - rank, isNew: previousRank == null };
  });
}

export function droppedTickers(previousRanks: Map<string, number>, picks: Pick<SelectedTopPick, "ticker">[]): string[] {
  const current = new Set(picks.map((pick) => pick.ticker));
  return Array.from(previousRanks.keys()).filter((ticker) => !current.has(ticker));
}
