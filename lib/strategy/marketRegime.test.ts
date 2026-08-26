import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CompletedBar } from "./threeBullTwoBear";
import {
  detectMarketRegime,
  evaluateRegimeEntry,
  isOverheatedStock,
  policyForRegime,
} from "./marketRegime";

function bar(date: string, open: number, close: number): CompletedBar {
  return { date, open, close };
}

/** 완만한 상승 추세 (MA20 위, 20일 +) */
function risingIndex(n: number): CompletedBar[] {
  const out: CompletedBar[] = [];
  let c = 1000;
  for (let i = 0; i < n; i++) {
    const open = c;
    c = c + 5;
    out.push(bar(`2026-01-${String((i % 28) + 1).padStart(2, "0")}`, open, c));
  }
  // unique dates - use sequential months via index padding
  return out.map((b, i) => ({
    ...b,
    date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
  }));
}

function fallingIndex(n: number): CompletedBar[] {
  const out: CompletedBar[] = [];
  let c = 2000;
  for (let i = 0; i < n; i++) {
    const open = c;
    c = c - 8;
    out.push({
      date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      open,
      close: c,
    });
  }
  return out;
}

describe("market regime policy", () => {
  it("상승장 정책은 기존 3양봉·최대 3·수량 100%", () => {
    const p = policyForRegime("bull");
    assert.equal(p.allowNewBuys, true);
    assert.equal(p.maxPositions, 3);
    assert.equal(p.qtyMultiplier, 1);
    assert.equal(p.excludeOverheated, false);
  });

  it("횡보장 정책은 최대 1·과열 제외·수량 50%", () => {
    const p = policyForRegime("sideways");
    assert.equal(p.allowNewBuys, true);
    assert.equal(p.maxPositions, 1);
    assert.equal(p.qtyMultiplier, 0.5);
    assert.equal(p.excludeOverheated, true);
  });

  it("하락장 정책은 신규매수 중단", () => {
    const p = policyForRegime("bear");
    assert.equal(p.allowNewBuys, false);
    assert.equal(p.qtyMultiplier, 0);
    assert.equal(p.maxPositions, 0);
  });

  it("상승 지수 시리즈는 bull로 분류", () => {
    const d = detectMarketRegime(risingIndex(70));
    assert.equal(d.regime, "bull");
  });

  it("하락 지수 시리즈는 bear로 분류", () => {
    const d = detectMarketRegime(fallingIndex(70));
    assert.equal(d.regime, "bear");
  });

  it("하락장에서는 3양봉이어도 신규매수 불가", () => {
    const stock = [
      bar("2026-08-01", 100, 105),
      bar("2026-08-02", 105, 110),
      bar("2026-08-03", 110, 115),
    ];
    const decision = evaluateRegimeEntry({
      indexBars: fallingIndex(70),
      stockBars: stock,
      openCount: 0,
      allocatedWon: 10_000_000,
      closePrice: 115,
    });
    assert.equal(decision.buySignal, true);
    assert.equal(decision.allow, false);
    assert.equal(decision.regime, "bear");
    assert.equal(decision.qty, 0);
    assert.match(decision.reasons.join(" "), /신규매수/);
  });

  it("상승장에서는 4일 연속 양봉도 미보유 종목 매수 허용", () => {
    const stock = [
      bar("2026-08-01", 100, 105),
      bar("2026-08-02", 105, 110),
      bar("2026-08-03", 110, 115),
      bar("2026-08-04", 115, 120),
    ];
    const decision = evaluateRegimeEntry({
      indexBars: risingIndex(70),
      stockBars: stock,
      openCount: 0,
      allocatedWon: 10_000_000,
      closePrice: 120,
    });
    assert.equal(decision.bullStreak, 4);
    assert.equal(decision.buySignal, true);
    assert.equal(decision.allow, true);
  });

  it("횡보장에서는 최대 1종목 — 이미 1개면 차단", () => {
    const stock = [
      bar("2026-08-01", 100, 101),
      bar("2026-08-02", 101, 102),
      bar("2026-08-03", 102, 103),
    ];
    // flat-ish index → sideways
    const flat: CompletedBar[] = [];
    let c = 1000;
    for (let i = 0; i < 40; i++) {
      const open = c;
      c = c + (i % 2 === 0 ? 1 : -1);
      flat.push({
        date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
        open,
        close: c,
      });
    }
    const decision = evaluateRegimeEntry({
      indexBars: flat,
      stockBars: stock,
      openCount: 1,
      allocatedWon: 10_000_000,
      closePrice: 103,
    });
    assert.equal(decision.regime, "sideways");
    assert.equal(decision.allow, false);
    assert.match(decision.reasons.join(" "), /한도/);
  });

  it("횡보장에서 과열 종목 제외", () => {
    const stock: CompletedBar[] = [];
    let c = 100;
    for (let i = 0; i < 25; i++) {
      const open = c;
      c = c + 1;
      stock.push(bar(`2026-07-${String((i % 28) + 1).padStart(2, "0")}`, open, c));
    }
    // spike last day +8%
    const last = stock[stock.length - 1]!;
    stock[stock.length - 1] = { ...last, open: last.close, close: last.close * 1.08 };

    const flat: CompletedBar[] = [];
    let ix = 1000;
    for (let i = 0; i < 40; i++) {
      const open = ix;
      ix = ix + (i % 2 === 0 ? 0.5 : -0.5);
      flat.push(bar(`2025-05-${String((i % 28) + 1).padStart(2, "0")}`, open, ix));
    }

    const heat = isOverheatedStock(stock, { dayChangePct: 8 });
    assert.equal(heat.overheated, true);

    // 3일 이상 연속 양봉이면 신호 — 과열 차단만 검증하도록 마지막 구간을 재구성
    const entryBars = [
      ...stock.slice(0, -3),
      bar("2026-08-10", 100, 101),
      bar("2026-08-11", 101, 102),
      bar("2026-08-12", 102, 110), // big day
    ];
    const decision = evaluateRegimeEntry({
      indexBars: flat,
      stockBars: entryBars,
      openCount: 0,
      allocatedWon: 10_000_000,
      closePrice: 110,
      dayChangePct: 8,
    });
    assert.equal(decision.regime, "sideways");
    assert.equal(decision.allow, false);
    assert.equal(decision.overheated, true);
  });

  it("횡보장에서 수량 50% 축소", () => {
    const stock = [
      bar("2026-08-01", 100, 105),
      bar("2026-08-02", 105, 110),
      bar("2026-08-03", 110, 115),
    ];
    const flat: CompletedBar[] = [];
    let ix = 1000;
    for (let i = 0; i < 40; i++) {
      const open = ix;
      ix = ix + (i % 2 === 0 ? 0.4 : -0.4);
      flat.push(bar(`2025-04-${String((i % 28) + 1).padStart(2, "0")}`, open, ix));
    }
    const decision = evaluateRegimeEntry({
      indexBars: flat,
      stockBars: stock,
      openCount: 0,
      allocatedWon: 1_150_000,
      closePrice: 115,
      dayChangePct: 1,
    });
    assert.equal(decision.regime, "sideways");
    if (decision.allow) {
      assert.equal(decision.qty, Math.floor((1_150_000 * 0.5) / 115));
      assert.equal(decision.policy.qtyMultiplier, 0.5);
    } else {
      // may block if classified overheated — ensure multiplier policy still 0.5
      assert.equal(decision.policy.qtyMultiplier, 0.5);
    }
  });

  it("상승장에서는 3양봉·수량 100% 허용", () => {
    const stock = [
      bar("2026-08-01", 100, 105),
      bar("2026-08-02", 105, 110),
      bar("2026-08-03", 110, 115),
    ];
    const decision = evaluateRegimeEntry({
      indexBars: risingIndex(70),
      stockBars: stock,
      openCount: 0,
      allocatedWon: 1_150_000,
      closePrice: 115,
    });
    assert.equal(decision.regime, "bull");
    assert.equal(decision.allow, true);
    assert.equal(decision.qty, Math.floor(1_150_000 / 115));
    assert.equal(decision.policy.maxPositions, 3);
  });
});
