import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertBuyAffordable, setAccountCashOverrideForTests } from "./balance";

describe("buy affordability guard", () => {
  beforeEach(() => setAccountCashOverrideForTests(null));

  it("blocks when cash is zero", () => {
    const r = assertBuyAffordable(100_000, {
      ok: true,
      orderableCashWon: 0,
      depositWon: 0,
      source: "t",
      asOf: new Date().toISOString(),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /0원/);
  });

  it("blocks when cash less than order", () => {
    const r = assertBuyAffordable(1_000_000, {
      ok: true,
      orderableCashWon: 500_000,
      depositWon: 500_000,
      source: "t",
      asOf: new Date().toISOString(),
    });
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /잔고 부족/);
  });

  it("allows when enough cash", () => {
    const r = assertBuyAffordable(100_000, {
      ok: true,
      orderableCashWon: 500_000,
      depositWon: 500_000,
      source: "t",
      asOf: new Date().toISOString(),
    });
    assert.equal(r.ok, true);
  });

  it("blocks when balance lookup failed", () => {
    const r = assertBuyAffordable(100_000, {
      ok: false,
      orderableCashWon: null,
      depositWon: null,
      source: "t",
      asOf: new Date().toISOString(),
      error: "조회 실패",
    });
    assert.equal(r.ok, false);
  });
});
