import { findBondEtfOverride } from "./bondEtfSettings";
import type { BondEtfScenarioSettings, Holding, SubType } from "./types";

interface Selection { symbol: string; name: string; currency: string; kind: string; assetClass: string; weightWithinClass: number }
export function selectionToHoldings(
  allocation: Record<string, number>,
  selected: Selection[],
  bondEtfScenarioSettings?: BondEtfScenarioSettings,
): Holding[] {
  const holdings = selected.filter(h => allocation[h.assetClass] > 0 && h.weightWithinClass > 0).map(h => {
    if (h.currency !== "KRW" && h.currency !== "USD") throw new Error(`${h.symbol}: ${h.currency} 통화는 아직 분석을 지원하지 않습니다.`);
    const kind = h.kind || "";
    const isBondClass = /Bond/i.test(h.assetClass);
    const isBondEtf = isBondClass && /ETF|ETN/i.test(kind);
    const isDirectBond =
      isBondClass &&
      !isBondEtf &&
      (/직접|bond/i.test(kind) || /^BOND-/i.test(h.symbol));
    // 직접채권을 stock 으로 두면 EPS 모델로 들어간다 — other 로 두고 수익률은 근거 부족 처리.
    const assetType = isBondEtf
      ? "etf"
      : isDirectBond
        ? "other"
        : /ETF/i.test(kind)
          ? "etf"
          : /ETN|OTHER|DR|WARRANT/i.test(kind)
            ? "other"
            : "stock";
    let subType: SubType = "equity";
    if (/cash/i.test(h.assetClass) || /머니마켓|KOFR|CD금리|초단기|money market|SGOV|BIL/i.test(`${h.name} ${h.symbol}`)) subType = "cash";
    else if (isBondClass) subType = "bond";
    else if (/골드|원유|원자재|WTI|금선물|금현물|gold|silver|commodity|oil/i.test(h.name)) subType = "commodity";
    else if (/배당|dividend|SCHD/i.test(`${h.name} ${h.symbol}`)) subType = "dividend";
    const bondEtfOverride = isBondEtf && bondEtfScenarioSettings
      ? findBondEtfOverride(bondEtfScenarioSettings, h.symbol)
      : undefined;
    const bondEtfScenario = isBondEtf && bondEtfScenarioSettings
      ? {
          rateChangeBp: bondEtfScenarioSettings.rateChangeBp,
          spreadChangeBp: bondEtfScenarioSettings.spreadChangeBp,
          allowMissingSpreadDuration: bondEtfScenarioSettings.allowMissingSpreadDuration,
          ...(bondEtfOverride ? { override: bondEtfOverride } : {}),
        }
      : undefined;
    return { ticker: h.symbol, name: h.name, currency: h.currency, assetType, subType,
      weight: allocation[h.assetClass] * h.weightWithinClass / 10000,
      ...(bondEtfScenario ? { bondEtfScenario } : {}) } as Holding;
  });
  if (allocation.cash > 0) holdings.push({ ticker: "CASH-KRW", name: "대기 현금", currency: "KRW", assetType: "cash", subType: "cash", weight: allocation.cash / 100 });
  return holdings;
}
