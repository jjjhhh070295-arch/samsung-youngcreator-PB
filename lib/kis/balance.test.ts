import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { assertBuyAffordable, mapKisHoldings, setAccountCashOverrideForTests } from "./balance";

function cash(partial: {
  ok: boolean;
  orderableCashWon: number | null;
  depositWon: number | null;
  error?: string;
}) {
  return {
    totalEvaluationWon: partial.depositWon,
    securitiesEvaluationWon: null,
    evaluationPnlWon: null,
    purchaseAmountWon: null,
    netAssetWon: partial.depositWon,
    source: "t",
    asOf: new Date().toISOString(),
    ...partial,
  };
}

describe("buy affordability guard", () => {
  beforeEach(() => setAccountCashOverrideForTests(null));

  it("blocks when cash is zero", () => {
    const r = assertBuyAffordable(100_000, cash({ ok: true, orderableCashWon: 0, depositWon: 0 }));
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /0원/);
  });

  it("blocks when cash less than order", () => {
    const r = assertBuyAffordable(
      1_000_000,
      cash({ ok: true, orderableCashWon: 500_000, depositWon: 500_000 }),
    );
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /잔고 부족/);
  });

  it("allows when enough cash", () => {
    const r = assertBuyAffordable(
      100_000,
      cash({ ok: true, orderableCashWon: 500_000, depositWon: 500_000 }),
    );
    assert.equal(r.ok, true);
  });

  it("blocks when balance lookup failed", () => {
    const r = assertBuyAffordable(
      100_000,
      cash({ ok: false, orderableCashWon: null, depositWon: null, error: "조회 실패" }),
    );
    assert.equal(r.ok, false);
  });
});

describe("KIS holdings", () => {
  it("uses ord_psbl_qty as the authoritative full-sell quantity", () => {
    const holdings = mapKisHoldings([
      {
        pdno: "007660",
        prdt_name: "이수페타시스",
        hldg_qty: "5",
        ord_psbl_qty: "3",
        pchs_avg_pric: "111900.0000",
        prpr: "112800",
      },
      { pdno: "005930", hldg_qty: "0", ord_psbl_qty: "0" },
    ]);
    assert.equal(holdings.length, 1);
    assert.equal(holdings[0]?.heldQty, 5);
    assert.equal(holdings[0]?.sellableQty, 3);
    assert.equal(holdings[0]?.averagePrice, 111900);
  });
});
