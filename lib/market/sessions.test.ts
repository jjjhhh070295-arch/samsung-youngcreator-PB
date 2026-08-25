import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectMarketSessions, hm } from "./sessions";

/** Fixed Seoul local wall time → Date that formats as that in Asia/Seoul */
function seoulLocal(y: number, m: number, d: number, h: number, min: number, s = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min, s));
}

describe("market sessions Asia/Seoul", () => {
  it("weekday before 08:00 is CLOSED", () => {
    const snap = detectMarketSessions(seoulLocal(2026, 8, 25, 7, 59), { isTradingDay: true });
    assert.equal(snap.session, "CLOSED");
    assert.equal(snap.orderable, false);
  });

  it("08:00–08:50 is NXT_PRE", () => {
    const a = detectMarketSessions(seoulLocal(2026, 8, 25, 8, 0), { isTradingDay: true });
    const b = detectMarketSessions(seoulLocal(2026, 8, 25, 8, 49), { isTradingDay: true });
    assert.ok(a.activeSessions.includes("NXT_PRE"));
    assert.ok(b.activeSessions.includes("NXT_PRE"));
    const c = detectMarketSessions(seoulLocal(2026, 8, 25, 8, 50), { isTradingDay: true });
    assert.ok(!c.activeSessions.includes("NXT_PRE"));
  });

  it("09:00:00 has KRX_REGULAR but not NXT_MAIN until :30", () => {
    const open = detectMarketSessions(seoulLocal(2026, 8, 25, 9, 0, 0), { isTradingDay: true });
    assert.ok(open.activeSessions.includes("KRX_REGULAR"));
    assert.ok(!open.activeSessions.includes("NXT_MAIN"));
    const main = detectMarketSessions(seoulLocal(2026, 8, 25, 9, 0, 30), { isTradingDay: true });
    assert.ok(main.activeSessions.includes("NXT_MAIN"));
  });

  it("15:20–15:30 is KRX closing auction", () => {
    const snap = detectMarketSessions(seoulLocal(2026, 8, 25, 15, 25), { isTradingDay: true });
    assert.ok(snap.activeSessions.includes("KRX_CLOSING_AUCTION"));
    assert.ok(snap.activeSessions.includes("KRX_REGULAR"));
    assert.ok(!snap.activeSessions.includes("NXT_MAIN"));
  });

  it("15:30–20:00 is NXT_AFTER and official close confirmed", () => {
    const a = detectMarketSessions(seoulLocal(2026, 8, 25, 15, 30), { isTradingDay: true });
    const b = detectMarketSessions(seoulLocal(2026, 8, 25, 19, 59), { isTradingDay: true });
    assert.ok(a.activeSessions.includes("NXT_AFTER"));
    assert.ok(b.activeSessions.includes("NXT_AFTER"));
    assert.equal(a.krxOfficialCloseConfirmed, true);
    const c = detectMarketSessions(seoulLocal(2026, 8, 25, 20, 0), { isTradingDay: true });
    assert.ok(!c.activeSessions.includes("NXT_AFTER"));
    assert.equal(c.session, "CLOSED");
  });

  it("holiday forces CLOSED even during market hours", () => {
    const snap = detectMarketSessions(seoulLocal(2026, 8, 25, 10, 0), { isTradingDay: false });
    assert.equal(snap.session, "CLOSED");
    assert.equal(snap.orderable, false);
  });

  it("hm helper", () => {
    assert.equal(hm(15, 30), 930);
  });
});
