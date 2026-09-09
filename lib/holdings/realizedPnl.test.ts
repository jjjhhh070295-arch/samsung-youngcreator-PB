import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeGrossProceedsWon,
  computeRealizedPnlWon,
  sumRealizedPnlWon,
  validateSellInput,
  type HoldingTrade,
} from "./trades";

const today = new Date().toLocaleDateString("en-CA");

describe("realized pnl", () => {
  test("100억에 사서 300억에 팔면 실현손익 200억", () => {
    // 1주당 100만원에 100,000주 = 1000억… 규모를 줄여 10,000주로 본다.
    const pnl = computeRealizedPnlWon({
      quantity: 10_000,
      unitPrice: 3_000_000,
      costBasisUnitPrice: 1_000_000,
    });
    assert.equal(pnl, 20_000_000_000);
  });

  test("손실 매도는 음수를 그대로 돌려준다 — 0 으로 막지 않는다", () => {
    const pnl = computeRealizedPnlWon({
      quantity: 100,
      unitPrice: 50_000,
      costBasisUnitPrice: 80_000,
    });
    assert.equal(pnl, -3_000_000);
  });

  test("수수료·세금은 원화로 차감한다", () => {
    const pnl = computeRealizedPnlWon({
      quantity: 10,
      unitPrice: 20_000,
      costBasisUnitPrice: 10_000,
      feeWon: 1_500,
      taxWon: 500,
    });
    assert.equal(pnl, 100_000 - 2_000);
  });

  test("외화는 차익에 환율을 곱한다", () => {
    const pnl = computeRealizedPnlWon({
      quantity: 100,
      unitPrice: 150,
      costBasisUnitPrice: 100,
      fxRate: 1_400,
    });
    assert.equal(pnl, 100 * 50 * 1_400);
  });

  test("본전 매도는 0", () => {
    assert.equal(
      computeRealizedPnlWon({ quantity: 5, unitPrice: 1_000, costBasisUnitPrice: 1_000 }),
      0,
    );
  });

  test("매도대금은 수수료·세금 차감 전 총액", () => {
    assert.equal(computeGrossProceedsWon(10, 20_000), 200_000);
    assert.equal(computeGrossProceedsWon(100, 150, 1_400), 21_000_000);
  });

  test("실현손익 합계는 매도만 센다", () => {
    const trades = [
      { side: "sell", realizedPnlWon: 1_000 },
      { side: "buy", realizedPnlWon: null },
      { side: "sell", realizedPnlWon: -400 },
    ] as HoldingTrade[];
    assert.equal(sumRealizedPnlWon(trades), 600);
  });
});

describe("sell validation", () => {
  const base = {
    quantity: 10,
    unitPrice: 1_000,
    tradedAt: today,
    heldQuantity: 100,
    currency: "KRW",
  };

  test("정상 입력은 통과", () => {
    assert.deepEqual(validateSellInput(base), []);
  });

  test("보유수량 초과를 막는다", () => {
    const reasons = validateSellInput({ ...base, quantity: 101 });
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /보유수량/);
  });

  test("전량 매도는 허용", () => {
    assert.deepEqual(validateSellInput({ ...base, quantity: 100 }), []);
  });

  test("0 이하 수량을 막는다", () => {
    assert.match(validateSellInput({ ...base, quantity: 0 })[0], /수량/);
    assert.match(validateSellInput({ ...base, quantity: -1 })[0], /수량/);
  });

  test("매도단가 0 은 허용한다 — 상장폐지 등 실제로 0 인 경우가 있다", () => {
    assert.deepEqual(validateSellInput({ ...base, unitPrice: 0 }), []);
  });

  test("미래 매도일을 막는다", () => {
    const future = new Date(Date.now() + 86_400_000 * 2).toLocaleDateString("en-CA");
    assert.match(validateSellInput({ ...base, tradedAt: future })[0], /미래/);
  });

  test("외화 종목은 환율이 없으면 막는다 — 기본값을 몰래 넣지 않는다", () => {
    const reasons = validateSellInput({ ...base, currency: "USD" });
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /환율/);
    assert.deepEqual(validateSellInput({ ...base, currency: "USD", fxRate: 1_400 }), []);
  });
});
