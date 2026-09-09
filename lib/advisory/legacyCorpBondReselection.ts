/**
 * 미승인 초안의 레거시 직접회사채 대표(BOND-KEPCO / BOND-GOOGL) 재선택 지원.
 * 실보유·승인 IPS는 자동 이관하지 않는다.
 */

import {
  findBondCatalogBySymbol,
  isLegacyGenericCorpBondSymbol,
  type BondCatalogEntry,
} from "./bondInstrumentCatalog";
import type { ManualSelectedInstrument } from "../manualPortfolioDraft";

export type LegacyCorpBondReselection = {
  legacySymbol: string;
  legacyName: string;
  assetClass: ManualSelectedInstrument["assetClass"];
  weightWithinClass: number;
  suggestedReplacement: BondCatalogEntry | null;
};

export function findLegacyGenericCorpBondsInSelection(
  selected: ManualSelectedInstrument[],
): LegacyCorpBondReselection[] {
  return selected
    .filter((row) => isLegacyGenericCorpBondSymbol(row.symbol))
    .map((row) => {
      const suggested =
        row.assetClass === "globalBond"
          ? findBondCatalogBySymbol("LQD") ?? null
          : findBondCatalogBySymbol("0099L0") ?? null;
      return {
        legacySymbol: row.symbol,
        legacyName: row.name,
        assetClass: row.assetClass,
        weightWithinClass: row.weightWithinClass,
        suggestedReplacement: suggested,
      };
    });
}

/**
 * PB 확인 후: 비중은 유지하고 심볼·이름을 ETF로 교체. 수량은 복사하지 않음(시세로 재산출).
 */
export function replaceLegacyCorpBondWithEtf<T extends ManualSelectedInstrument>(
  selected: T[],
  legacySymbol: string,
  replacement: BondCatalogEntry,
): T[] {
  return selected.map((row) => {
    if (!isLegacyGenericCorpBondSymbol(row.symbol)) return row;
    const bare = row.symbol.toUpperCase().replace(/\.(KS|KQ)$/i, "");
    const target = legacySymbol.toUpperCase().replace(/\.(KS|KQ)$/i, "");
    if (bare !== target && row.symbol.toUpperCase() !== legacySymbol.toUpperCase()) {
      return row;
    }
    return {
      ...row,
      symbol: replacement.symbol,
      name: replacement.name,
      exchange: replacement.exchange,
      currency: replacement.currency,
      kind: replacement.kind,
      quotationKind: "share" as const,
      faceValue: null,
      // 직접채권 수량을 ETF 주로 복사하지 않음
      plannedQuantity: undefined,
      designatedPrice: undefined,
    };
  });
}
