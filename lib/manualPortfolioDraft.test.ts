import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allocationExcessPctPoints,
  isAllocationTotalExact100,
  remainingPctForFinalTarget,
  updateAllocationWithCash,
  type ManualAllocation,
} from "./manualPortfolioDraft";

const empty: ManualAllocation = {
  domesticEquity: 0,
  globalEquity: 0,
  domesticBond: 0,
  globalBond: 0,
  alternatives: 0,
  cash: 100,
};

describe("updateAllocationWithCash", () => {
  it("automatically assigns the remainder to cash", () => {
    const domestic = updateAllocationWithCash(empty, "domesticEquity", 30);
    const global = updateAllocationWithCash(domestic, "globalEquity", 20);
    assert.equal(global.domesticEquity, 30);
    assert.equal(global.globalEquity, 20);
    assert.equal(global.cash, 50);
    assert.equal(Object.values(global).reduce((sum, value) => sum + value, 0), 100);
  });

  it("allows temporary totals above 100% and keeps exact inputs with cash 0", () => {
    const domestic = updateAllocationWithCash(empty, "domesticEquity", 70);
    const global = updateAllocationWithCash(domestic, "globalEquity", 50);
    assert.equal(global.domesticEquity, 70);
    assert.equal(global.globalEquity, 50);
    assert.equal(global.cash, 0);
    assert.equal(allocationExcessPctPoints(global), 20);
    assert.equal(isAllocationTotalExact100(global), false);
  });

  it("editing one class does not clamp or modify another non-cash class", () => {
    const a = updateAllocationWithCash(empty, "domesticEquity", 70);
    const b = updateAllocationWithCash(a, "globalEquity", 50);
    const c = updateAllocationWithCash(b, "domesticBond", 10);
    assert.equal(c.domesticEquity, 70);
    assert.equal(c.globalEquity, 50);
    assert.equal(c.domesticBond, 10);
    assert.equal(c.cash, 0);
  });

  it("returning to exactly 100% clears excess", () => {
    const over = updateAllocationWithCash(
      updateAllocationWithCash(empty, "domesticEquity", 70),
      "globalEquity",
      50,
    );
    const fixed = updateAllocationWithCash(over, "globalEquity", 30);
    assert.equal(fixed.domesticEquity, 70);
    assert.equal(fixed.globalEquity, 30);
    assert.equal(fixed.cash, 0);
    assert.equal(isAllocationTotalExact100(fixed), true);
  });

  it("caps a single class at 100% but not the cross-class sum", () => {
    const a = updateAllocationWithCash(empty, "domesticEquity", 120);
    assert.equal(a.domesticEquity, 100);
    assert.equal(a.cash, 0);
  });
});

describe("remainingPctForFinalTarget", () => {
  it("keeps a 50억원 holding fixed inside a 350억원 total and allocates only the remaining 300억원", () => {
    const fixedPct = 50 / 350 * 100;
    const allocationScale = 300 / 350;
    assert.equal(remainingPctForFinalTarget(fixedPct, fixedPct, allocationScale), 0);
    assert.ok(Math.abs(remainingPctForFinalTarget(50, fixedPct, allocationScale) - 41.6666666667) < 1e-9);
  });
});
