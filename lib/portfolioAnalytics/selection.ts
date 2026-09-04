import type { Holding, SubType } from "./types";

interface Selection { symbol: string; name: string; currency: string; kind: string; assetClass: string; weightWithinClass: number }
export function selectionToHoldings(allocation: Record<string, number>, selected: Selection[]): Holding[] {
  const holdings = selected.filter(h => allocation[h.assetClass] > 0 && h.weightWithinClass > 0).map(h => {
    if (h.currency !== "KRW" && h.currency !== "USD") throw new Error(`${h.symbol}: ${h.currency} 통화는 아직 분석을 지원하지 않습니다.`);
    const assetType = /ETF/i.test(h.kind) ? "etf" : /ETN|OTHER|DR|WARRANT/i.test(h.kind) ? "other" : "stock";
    let subType: SubType = "equity";
    if (/cash/i.test(h.assetClass) || /머니마켓|KOFR|CD금리|초단기|money market|SGOV|BIL/i.test(`${h.name} ${h.symbol}`)) subType = "cash";
    else if (/Bond/i.test(h.assetClass)) subType = "bond";
    else if (/골드|원유|원자재|WTI|금선물|금현물|gold|silver|commodity|oil/i.test(h.name)) subType = "commodity";
    else if (/배당|dividend|SCHD/i.test(`${h.name} ${h.symbol}`)) subType = "dividend";
    return { ticker: h.symbol, name: h.name, currency: h.currency, assetType, subType,
      weight: allocation[h.assetClass] * h.weightWithinClass / 10000 } as Holding;
  });
  if (allocation.cash > 0) holdings.push({ ticker: "CASH-KRW", name: "대기 현금", currency: "KRW", assetType: "cash", subType: "cash", weight: allocation.cash / 100 });
  return holdings;
}
