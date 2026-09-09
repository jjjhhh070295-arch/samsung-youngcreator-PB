import type { MarketResearchItem } from "../portfolioResearch";

export type StoredCanonicalDocument = {
  id: string;
  source_url: string | null;
  document_type: MarketResearchItem["documentType"];
};

function roundRobinBySource(items: MarketResearchItem[], limit: number): MarketResearchItem[] {
  const groups = new Map<string, MarketResearchItem[]>();
  for (const item of items) {
    const key = item.source.split(" · ")[0];
    const rows = groups.get(key) ?? [];
    rows.push(item);
    groups.set(key, rows);
  }
  const selected: MarketResearchItem[] = [];
  while (selected.length < limit && Array.from(groups.values()).some((rows) => rows.length)) {
    for (const rows of Array.from(groups.values())) {
      const item = rows.shift();
      if (item) selected.push(item);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

/** Reserve most canonical-ingest capacity for stock reports while keeping market context. */
export function selectCanonicalIngestBatch(items: MarketResearchItem[], limit = 8): MarketResearchItem[] {
  if (limit < 1) return [];
  const stocks = items.filter((item) => item.documentType === "STOCK");
  const context = items.filter((item) => item.documentType !== "STOCK");
  const stockTarget = Math.min(stocks.length, Math.ceil(limit * 0.75));
  const selected = [
    ...roundRobinBySource(stocks, stockTarget),
    ...roundRobinBySource(context, limit - stockTarget),
  ];
  if (selected.length >= limit) return selected;
  const used = new Set(selected.map((item) => item.id));
  return [...selected, ...roundRobinBySource(items.filter((item) => !used.has(item.id)), limit - selected.length)];
}

/** A document is complete only when its type-specific extraction row also exists. */
export function filterPendingCanonicalItems(
  items: MarketResearchItem[],
  documents: StoredCanonicalDocument[],
  stockDocumentIds: Iterable<string>,
  marketDocumentIds: Iterable<string>,
): MarketResearchItem[] {
  const stockComplete = new Set(stockDocumentIds);
  const marketComplete = new Set(marketDocumentIds);
  const documentsByUrl = new Map<string, StoredCanonicalDocument[]>();
  for (const document of documents) {
    if (!document.source_url) continue;
    const rows = documentsByUrl.get(document.source_url) ?? [];
    rows.push(document);
    documentsByUrl.set(document.source_url, rows);
  }
  return items.filter((item) => {
    const matches = documentsByUrl.get(item.url) ?? [];
    return !matches.some((document) => document.document_type === "STOCK"
      ? stockComplete.has(document.id)
      : marketComplete.has(document.id));
  });
}
