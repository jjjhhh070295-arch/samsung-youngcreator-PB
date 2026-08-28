import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAutoTradeCycle } from "./autoTrader";
import { getAutoTraderState, resetAutoTraderStateForTests, setArmed } from "./positionStore";

describe("autoTrader cycle", () => {
  const prevDemo = process.env.TRADING_DEMO_MODE;

  beforeEach(() => {
    resetAutoTraderStateForTests();
    process.env.TRADING_DEMO_MODE = "true";
    process.env.KIS_LIVE_TRADING_ENABLED = "false";
  });

  afterEach(() => {
    resetAutoTraderStateForTests();
    process.env.TRADING_DEMO_MODE = prevDemo;
  });

  it("skips when not armed and force=false", async () => {
    const r = await runAutoTradeCycle({ force: false, ignoreSession: true });
    assert.equal(r.skipped, "not_armed");
  });

  it("dry-run buys on a three-bull signal", async () => {
    setArmed(true, false);
    const r = await runAutoTradeCycle({ force: true, ignoreSession: true });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.ok(r.buys.length >= 1, `expected buys, got ${r.buys.length}; ${r.summary}`);
    assert.ok(getAutoTraderState().positions.length >= 1);
  });
});
