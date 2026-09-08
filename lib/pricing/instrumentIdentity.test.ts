import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalHoldingTicker,
  domesticProviderCode,
  findQuoteBySymbol,
  identityKeyForSymbol,
  resolveInstrumentForPricing,
  symbolsEquivalent,
} from "./instrumentIdentity";

describe("instrumentIdentity", () => {
  it("maps domestic .KS/.KQ aliases to bare codes and keeps leading zeros", () => {
    assert.equal(domesticProviderCode("207940.KS"), "207940");
    assert.equal(domesticProviderCode("016360.KS"), "016360");
    assert.equal(domesticProviderCode("005930"), "005930");
    assert.equal(domesticProviderCode("336260"), "336260");
    assert.equal(domesticProviderCode("0088M0.KQ"), "0088M0");
  });

  it("does not strip foreign or non-domestic identifiers", () => {
    assert.equal(domesticProviderCode("AAPL"), null);
    assert.equal(domesticProviderCode("BRK.B"), null);
    assert.equal(domesticProviderCode("MSFT.US"), null);
    const overseas = resolveInstrumentForPricing("AAPL", "USD");
    assert.equal(overseas.venue, "kis_overseas");
    assert.equal(overseas.providerSymbol, "AAPL");
  });

  it("treats suffixed and bare symbols as equivalent holdings", () => {
    assert.equal(symbolsEquivalent("207940.KS", "207940"), true);
    assert.equal(symbolsEquivalent("016360.KS", "016360"), true);
    assert.equal(symbolsEquivalent("005930", "005930.KQ"), true);
    assert.equal(symbolsEquivalent("AAPL", "AAPL", "USD"), true);
    assert.equal(symbolsEquivalent("AAPL", "MSFT", "USD"), false);
    assert.equal(identityKeyForSymbol("207940.KS"), identityKeyForSymbol("207940"));
  });

  it("canonicalizes holding tickers to bare domestic codes", () => {
    assert.equal(canonicalHoldingTicker("207940.KS"), "207940");
    assert.equal(canonicalHoldingTicker("016360.KS"), "016360");
  });

  it("resolves quotes by equivalent identity", () => {
    const map = new Map([
      ["207940", { ticker: "207940", price: 100 }],
    ]);
    const hit = findQuoteBySymbol(map, "207940.KS");
    assert.equal(hit?.price, 100);
  });

  it("marks non-listed KRW symbols unsupported for KIS domestic", () => {
    const r = resolveInstrumentForPricing("DIRECT-BOND-1", "KRW");
    assert.equal(r.venue, "unsupported");
  });
});
