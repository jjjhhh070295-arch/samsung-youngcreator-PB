import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BOND_INSTRUMENT_CATALOG,
  bondsForAssetClass,
  findBondCatalogBySymbol,
  isLegacyGenericCorpBondSymbol,
} from "./bondInstrumentCatalog";
import {
  findLegacyGenericCorpBondsInSelection,
  replaceLegacyCorpBondWithEtf,
} from "./legacyCorpBondReselection";
import { inferQuotationKindForTest } from "./ipsPurchasePlanBondEtfTestShim";

describe("bondInstrumentCatalog", () => {
  it("uses correct short-term and aggregate KODEX codes", () => {
    const short = findBondCatalogBySymbol("153130");
    const agg = findBondCatalogBySymbol("273130");
    assert.equal(short?.name, "KODEX 단기채권");
    assert.equal(agg?.name, "KODEX 종합채권(AA-이상)액티브");
    assert.notEqual(short?.symbol, agg?.symbol);
  });

  it("provides ACE and LQD corporate IG ETF representatives", () => {
    const ace = findBondCatalogBySymbol("0099L0");
    const lqd = findBondCatalogBySymbol("LQD");
    assert.equal(ace?.label, "국내 우량회사채 ETF");
    assert.equal(ace?.name, "ACE 우량회사채(AA-이상)액티브");
    assert.equal(ace?.quotationKind, "share");
    assert.equal(ace?.instrumentType, "bond_etf");
    assert.equal(lqd?.label, "미국 투자등급 회사채 ETF");
    assert.equal(lqd?.currency, "USD");
    assert.equal(lqd?.exchange, "NYSE Arca");
  });

  it("lists target-maturity KODEX separately", () => {
    const tm = findBondCatalogBySymbol("0007F0");
    assert.equal(tm?.targetMaturity, true);
    assert.equal(tm?.targetMaturityDate, "2027-12");
    assert.equal(tm?.label, "국내 만기매칭 회사채 ETF");
  });

  it("removes generic KEPCO/Google from new catalog", () => {
    assert.equal(BOND_INSTRUMENT_CATALOG.some((b) => /KEPCO|GOOGL|한전|구글/i.test(`${b.id} ${b.symbol} ${b.name}`)), false);
    assert.ok(isLegacyGenericCorpBondSymbol("BOND-KEPCO"));
    assert.ok(isLegacyGenericCorpBondSymbol("BOND-GOOGL"));
  });

  it("active corp IG cards are ACE 0099L0 and LQD only", () => {
    const corp = BOND_INSTRUMENT_CATALOG.filter((b) => b.exposure === "corporate_ig" && !b.targetMaturity);
    assert.deepEqual(
      corp.map((b) => ({ label: b.label, name: b.name, symbol: b.symbol, kind: b.kind, quotationKind: b.quotationKind })),
      [
        {
          label: "국내 우량회사채 ETF",
          name: "ACE 우량회사채(AA-이상)액티브",
          symbol: "0099L0.KS",
          kind: "채권 ETF",
          quotationKind: "share",
        },
        {
          label: "미국 투자등급 회사채 ETF",
          name: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
          symbol: "LQD",
          kind: "채권 ETF",
          quotationKind: "share",
        },
      ],
    );
    assert.equal(BOND_INSTRUMENT_CATALOG.every((b) => !isLegacyGenericCorpBondSymbol(b.symbol)), true);
  });

  it("maps domestic vs global counts", () => {
    assert.ok(bondsForAssetClass("domesticBond").length >= 5);
    assert.ok(bondsForAssetClass("globalBond").some((b) => b.symbol === "LQD"));
  });

  it("preserves alphanumeric Korean codes as strings", () => {
    const ace = findBondCatalogBySymbol("0099L0.KS");
    assert.ok(ace);
    assert.match(ace!.symbol, /0099L0/i);
    assert.equal(Number.isNaN(Number("0099L0")), true);
  });
});

describe("legacyCorpBondReselection", () => {
  it("flags draft rows and replaces weight without copying quantity", () => {
    const selected = [
      {
        symbol: "BOND-KEPCO",
        name: "한국전력공사 회사채 (직접투자)",
        exchange: "OTC",
        currency: "KRW" as const,
        kind: "직접투자 채권",
        price: null,
        changePct: null,
        asOf: null,
        source: "legacy",
        assetClass: "domesticBond" as const,
        weightWithinClass: 40,
        plannedQuantity: 100,
        quotationKind: "bond_face" as const,
      },
    ];
    const found = findLegacyGenericCorpBondsInSelection(selected);
    assert.equal(found.length, 1);
    assert.equal(found[0].suggestedReplacement?.symbol, "0099L0.KS");
    const next = replaceLegacyCorpBondWithEtf(selected, "BOND-KEPCO", found[0].suggestedReplacement!);
    assert.equal(next[0].symbol, "0099L0.KS");
    assert.equal(next[0].weightWithinClass, 40);
    assert.equal(next[0].quotationKind, "share");
    assert.equal(next[0].plannedQuantity, undefined);
  });
});

describe("bond etf quotation kind", () => {
  it("forces share for bond ETFs even without explicit quotationKind", () => {
    assert.equal(
      inferQuotationKindForTest({
        symbol: "0099L0.KS",
        kind: "채권 ETF",
        assetClass: "domesticBond",
      }),
      "share",
    );
    assert.equal(
      inferQuotationKindForTest({
        symbol: "LQD",
        kind: "채권 ETF",
        assetClass: "globalBond",
      }),
      "share",
    );
  });
});
