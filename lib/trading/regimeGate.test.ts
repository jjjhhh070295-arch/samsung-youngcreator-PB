import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setIndexBarsOverrideForTests } from "../market/kospiBars";
import { enforceRegimeBuyGate } from "./regimeGate";
import type { CompletedBar } from "../strategy/threeBullTwoBear";

function risingIndex(n: number): CompletedBar[] {
  const bars: CompletedBar[] = [];
  let price = 2000;
  for (let i = 0; i < n; i += 1) {
    price += 8;
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    bars.push({ date: d, open: price - 3, close: price });
  }
  return bars;
}

function fallingIndex(n: number): CompletedBar[] {
  const bars: CompletedBar[] = [];
  let price = 3000;
  for (let i = 0; i < n; i += 1) {
    price -= 10;
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    bars.push({ date: d, open: price + 3, close: price });
  }
  return bars;
}

function threeBullStock(): CompletedBar[] {
  return [
    { date: "2024-06-01", open: 100, close: 101 },
    { date: "2024-06-02", open: 101, close: 103 },
    { date: "2024-06-03", open: 103, close: 105 },
  ];
}

describe("enforceRegimeBuyGate", () => {
  beforeEach(() => setIndexBarsOverrideForTests(null));
  afterEach(() => setIndexBarsOverrideForTests(null));

  it("allows sells without regime check", async () => {
    const r = await enforceRegimeBuyGate({
      side: "sell",
      symbol: "005930",
      quantity: 1,
      price: 70000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.allowedQuantity, 1);
  });

  it("blocks buys in bear regime", async () => {
    setIndexBarsOverrideForTests(fallingIndex(70));
    const r = await enforceRegimeBuyGate({
      side: "buy",
      symbol: "005930",
      quantity: 1,
      price: 70000,
      stockBars: threeBullStock(),
      indexBars: fallingIndex(70),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "REGIME_BEAR_NO_BUY");
  });

  it("allows buys in bull with 3-bull signal", async () => {
    const index = risingIndex(70);
    const r = await enforceRegimeBuyGate({
      side: "buy",
      symbol: "005930",
      quantity: 10,
      price: 1000,
      stockBars: threeBullStock(),
      openCount: 0,
      allocatedWon: 50_000,
      indexBars: index,
    });
    assert.equal(r.ok, true);
    assert.equal(r.regime, "bull");
    assert.ok((r.allowedQuantity ?? 0) >= 1);
  });

  it("blocks buy when stock bars missing", async () => {
    const r = await enforceRegimeBuyGate({
      side: "buy",
      symbol: "005930",
      quantity: 1,
      price: 70000,
      indexBars: risingIndex(70),
      stockBars: [],
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "STOCK_BARS_REQUIRED");
  });
});
