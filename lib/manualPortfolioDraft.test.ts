import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateAllocationWithCash, type ManualAllocation } from "./manualPortfolioDraft";

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

  it("caps the changed class so the allocation cannot exceed 100%", () => {
    const domestic = updateAllocationWithCash(empty, "domesticEquity", 70);
    const global = updateAllocationWithCash(domestic, "globalEquity", 50);
    assert.equal(global.globalEquity, 30);
    assert.equal(global.cash, 0);
  });
});
