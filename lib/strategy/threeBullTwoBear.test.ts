import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STRATEGY_ID,
  MAX_STRATEGY_POSITIONS,
  canOpenNewPosition,
  computeOrderQty,
  countOpenLikePositions,
  detectBuySignal,
  detectSellSignal,
  isBullishBar,
  isBearishBar,
  isDojiBar,
  remainingUnfilledQty,
  type CompletedBar,
} from "./threeBullTwoBear";

function bar(date: string, open: number, close: number): CompletedBar {
  return { date, open, close };
}

describe("KR_THREE_BULL_TWO_BEAR strategy", () => {
  it("exports stable strategy id and max positions", () => {
    assert.equal(STRATEGY_ID, "KR_THREE_BULL_TWO_BEAR");
    assert.equal(MAX_STRATEGY_POSITIONS, 3);
  });

  it("classifies bullish, bearish, and doji bars", () => {
    assert.equal(isBullishBar(bar("d1", 100, 110)), true);
    assert.equal(isBearishBar(bar("d1", 110, 100)), true);
    assert.equal(isDojiBar(bar("d1", 100, 100)), true);
    assert.equal(isBullishBar(bar("d1", 100, 100)), false);
  });

  it("buy signal: 2 days no, 3 days yes, 4th day no duplicate", () => {
    const twoBull = [bar("d1", 100, 105), bar("d2", 105, 110)];
    const twoResult = detectBuySignal(twoBull);
    assert.equal(twoResult.signal, false);
    assert.equal(twoResult.bullStreak, 2);

    const threeBull = [...twoBull, bar("d3", 110, 115)];
    const threeResult = detectBuySignal(threeBull);
    assert.equal(threeResult.signal, true);
    assert.equal(threeResult.bullStreak, 3);

    const fourBull = [...threeBull, bar("d4", 115, 120)];
    const fourResult = detectBuySignal(fourBull);
    assert.equal(fourResult.signal, false);
    assert.equal(fourResult.bullStreak, 4);
    assert.match(fourResult.reason ?? "", /duplicate/i);
  });

  it("doji breaks bull and bear streaks", () => {
    const bullWithDoji = [
      bar("d1", 100, 105),
      bar("d2", 105, 110),
      bar("d3", 110, 110),
      bar("d4", 110, 115),
    ];
    const buy = detectBuySignal(bullWithDoji);
    assert.equal(buy.signal, false);
    assert.equal(buy.bullStreak, 1);

    const bearWithDoji = [
      bar("d1", 120, 115),
      bar("d2", 115, 110),
      bar("d3", 110, 110),
      bar("d4", 110, 105),
    ];
    const sell = detectSellSignal(bearWithDoji, true);
    assert.equal(sell.signal, false);
    assert.equal(sell.bearStreak, 1);
  });

  it("no sell without position", () => {
    const twoBear = [bar("d1", 120, 115), bar("d2", 115, 110)];
    const result = detectSellSignal(twoBear, false);
    assert.equal(result.signal, false);
    assert.match(result.reason ?? "", /no position/i);
  });

  it("sell on 2 consecutive bearish bars with position", () => {
    const twoBear = [bar("d1", 120, 115), bar("d2", 115, 110)];
    const result = detectSellSignal(twoBear, true);
    assert.equal(result.signal, true);
    assert.equal(result.bearStreak, 2);
  });

  it("allows at most 3 open-like positions", () => {
    const states = ["OPEN", "BUY_SUBMITTED", "PARTIALLY_FILLED", "WATCHING"] as const;
    const openCount = countOpenLikePositions([...states]);
    assert.equal(openCount, 3);
    assert.equal(canOpenNewPosition(openCount), false);
    assert.equal(canOpenNewPosition(2), true);
    assert.equal(canOpenNewPosition(3), false);
  });

  it("computeOrderQty floors allocated won by close price", () => {
    assert.equal(computeOrderQty(1_000_000, 72_500), 13);
    assert.equal(computeOrderQty(0, 100), 0);
    assert.equal(computeOrderQty(1000, 0), 0);
  });

  it("partial fill qty tracks remaining unfilled quantity", () => {
    assert.equal(remainingUnfilledQty(10, 4), 6);
    assert.equal(remainingUnfilledQty(10, 12), 0);
  });
});
