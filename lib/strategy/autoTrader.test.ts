import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setIndexBarsOverrideForTests } from "../market/kospiBars";
import { runAutoTradeCycle } from "./autoTrader";
import { getAutoTraderState, resetAutoTraderStateForTests, setArmed } from "./positionStore";
import type { CompletedBar } from "./threeBullTwoBear";

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

describe("autoTrader cycle", () => {
  const prevDemo = process.env.TRADING_DEMO_MODE;

  beforeEach(() => {
    resetAutoTraderStateForTests();
    setIndexBarsOverrideForTests(risingIndex(70));
    process.env.TRADING_DEMO_MODE = "true";
    process.env.KIS_LIVE_TRADING_ENABLED = "false";
  });

  afterEach(() => {
    setIndexBarsOverrideForTests(null);
    resetAutoTraderStateForTests();
    process.env.TRADING_DEMO_MODE = prevDemo;
  });

  it("skips when not armed and force=false", async () => {
    const r = await runAutoTradeCycle({ force: false, ignoreSession: true });
    assert.equal(r.skipped, "not_armed");
  });

  it("dry-run buys on force cycle in demo+bull", async () => {
    setArmed(true, false);
    const r = await runAutoTradeCycle({ force: true, ignoreSession: true });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.ok(r.buys.length >= 1, `expected buys, got ${r.buys.length}; ${r.summary}`);
    assert.ok(getAutoTraderState().positions.length >= 1);
  });
});
