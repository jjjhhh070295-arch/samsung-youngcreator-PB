import type { PbSelectedKoreanStock } from "./krTrendPortfolio";

export type ManualAssetClass =
  | "domesticEquity"
  | "globalEquity"
  | "domesticBond"
  | "globalBond"
  | "alternatives"
  | "cash";

export type ManualInstrument = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  kind: string;
  price: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
};

export type ManualSelectedInstrument = ManualInstrument & {
  assetClass: ManualAssetClass;
  weightWithinClass: number;
};

/** 새 종목 추가·삭제 뒤 해당 자산군의 내부 비중을 균등하게 다시 100%로 맞춘다. */
export function redistributeAssetClassWeights(
  items: ManualSelectedInstrument[],
  assetClass: ManualAssetClass,
): ManualSelectedInstrument[] {
  const classItems = items.filter((item) => item.assetClass === assetClass);
  if (classItems.length === 0) return items;
  const base = Math.floor((100 / classItems.length) * 100) / 100;
  let index = 0;
  return items.map((item) => {
    if (item.assetClass !== assetClass) return item;
    const weightWithinClass = index === classItems.length - 1
      ? Math.round((100 - base * (classItems.length - 1)) * 100) / 100
      : base;
    index += 1;
    return { ...item, weightWithinClass };
  });
}

export function normalizeTicker(symbol: string) {
  return symbol.replace(/\.(KS|KQ)$/i, "").toUpperCase();
}

export function sameInstrument(a: string, b: string) {
  return normalizeTicker(a) === normalizeTicker(b) || a.toUpperCase() === b.toUpperCase();
}

export function trendStockToInstrument(stock: PbSelectedKoreanStock): ManualInstrument {
  const bare = normalizeTicker(stock.ticker);
  const isKosdaq = /KOSDAQ/i.test(stock.exchange ?? "");
  return {
    symbol: bare.includes(".") ? bare : `${bare}.${isKosdaq ? "KQ" : "KS"}`,
    name: stock.name,
    exchange: stock.exchange ?? (isKosdaq ? "KOSDAQ" : "KOSPI"),
    currency: stock.currency ?? "KRW",
    kind: "국내 종목",
    price: stock.price ?? null,
    changePct: null,
    asOf: stock.asOf ?? null,
    source: stock.source ?? "pb-kr-trend-filter",
  };
}

/** Merge trend-filter confirmed stocks into selected instruments (no duplicates). */
export function mergeTrendConfirmedIntoSelected(
  current: ManualSelectedInstrument[],
  stocks: PbSelectedKoreanStock[],
): ManualSelectedInstrument[] {
  if (stocks.length === 0) return current;
  const next = [...current];
  for (const stock of stocks) {
    const instrument = trendStockToInstrument(stock);
    const idx = next.findIndex(
      (item) => item.assetClass === "domesticEquity" && sameInstrument(item.symbol, stock.ticker),
    );
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        name: instrument.name,
        price: instrument.price ?? next[idx].price,
        asOf: instrument.asOf ?? next[idx].asOf,
        source: instrument.source,
        exchange: instrument.exchange || next[idx].exchange,
        currency: instrument.currency || next[idx].currency,
      };
    } else {
      const count = next.filter((item) => item.assetClass === "domesticEquity").length;
      next.push({
        ...instrument,
        assetClass: "domesticEquity",
        weightWithinClass: count === 0 ? 100 : 0,
      });
    }
  }
  return next;
}
