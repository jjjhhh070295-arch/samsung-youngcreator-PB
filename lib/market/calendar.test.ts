import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  assertTradingDayOrThrow, isCalendarUsable, resolveTradingCalendar,
  setCalendarCacheForTests, seoulDateKey,
} from "./calendar";

describe("trading calendar fail-closed", () => {
  beforeEach(() => setCalendarCacheForTests(null));

  it("provider failure blocks orders", async () => {
    const snap = await resolveTradingCalendar({
      provider: async () => { throw new Error("kis down"); },
    });
    assert.equal(snap.ok, false);
    assert.throws(() => assertTradingDayOrThrow(snap));
  });

  it("expired calendar is not usable", () => {
    const snap = {
      ok: true, source: "test", fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      today: seoulDateKey(), isTradingDay: true, days: [],
    };
    assert.equal(isCalendarUsable(snap), false);
  });

  it("provider success marks trading day", async () => {
    const today = seoulDateKey();
    const snap = await resolveTradingCalendar({
      provider: async () => ({ source: "mock", days: [{ date: today, isTradingDay: true, reason: "개장" }] }),
    });
    assert.equal(snap.ok, true);
    assert.doesNotThrow(() => assertTradingDayOrThrow(snap));
  });

  it("holiday from provider blocks", async () => {
    const today = seoulDateKey();
    const snap = await resolveTradingCalendar({
      provider: async () => ({ source: "mock", days: [{ date: today, isTradingDay: false, reason: "공휴일" }] }),
    });
    assert.throws(() => assertTradingDayOrThrow(snap));
  });
});
