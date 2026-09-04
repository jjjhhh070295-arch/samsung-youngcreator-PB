import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BOND_INSTRUMENT_CATALOG, bondsForAssetClass } from "./bondInstrumentCatalog";

describe("bondInstrumentCatalog", () => {
  it("includes the eight requested bond options", () => {
    const labels = BOND_INSTRUMENT_CATALOG.map((b) => b.label);
    assert.deepEqual(labels, [
      "한국 단기채",
      "한국 중기채",
      "한국 장기채",
      "미국 단기채",
      "미국 중기채",
      "미국 장기채",
      "한전채",
      "구글 회사채",
    ]);
  });

  it("maps KR bonds to domesticBond and US/Google to globalBond", () => {
    assert.equal(bondsForAssetClass("domesticBond").length, 4);
    assert.equal(bondsForAssetClass("globalBond").length, 4);
    assert.ok(bondsForAssetClass("domesticBond").some((b) => b.label === "한전채"));
    assert.ok(bondsForAssetClass("globalBond").some((b) => b.label === "구글 회사채"));
  });

  it("marks government exposures as ETF and corp labels as direct bonds", () => {
    const kepco = BOND_INSTRUMENT_CATALOG.find((b) => b.id === "kepco-direct");
    const short = BOND_INSTRUMENT_CATALOG.find((b) => b.id === "kr-short");
    assert.equal(kepco?.kind, "직접투자 채권");
    assert.equal(short?.kind, "채권 ETF");
  });
});
