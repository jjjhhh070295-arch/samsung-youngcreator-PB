/** Test-only re-export of quotation kind inference without expanding ipsPurchasePlan public API. */
import type { ManualSelectedInstrument } from "../manualPortfolioDraft";

export function inferQuotationKindForTest(
  item: Pick<ManualSelectedInstrument, "symbol" | "kind" | "assetClass"> & {
    quotationKind?: ManualSelectedInstrument["quotationKind"];
  },
): "share" | "bond_face" | "unit" {
  if (item.quotationKind) return item.quotationKind;
  const kind = (item.kind || "").toLowerCase();
  if (kind.includes("etf") || kind.includes("etn")) return "share";
  if (item.assetClass === "domesticBond" || item.assetClass === "globalBond" || kind.includes("bond")) {
    return "bond_face";
  }
  if (kind.includes("wrap") || kind.includes("trust") || kind.includes("els") || kind.includes("elb")) {
    return "unit";
  }
  return "share";
}
