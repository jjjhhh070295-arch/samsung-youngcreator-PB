import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { evaluateLiveSafety } from "./safety";
import { seoulDateKey } from "@/lib/market/calendar";

const baseCal = {
  ok: true,
  source: "t",
  fetchedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  today: seoulDateKey(),
  isTradingDay: true,
  days: [],
};

describe("live safety fail-closed", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.KIS_LIVE_TRADING_ENABLED = "true";
    process.env.KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
    process.env.TRADER_SUPABASE_URL = "https://example.supabase.co";
    process.env.TRADER_SUPABASE_SERVICE_ROLE_KEY = "test";
  });
  afterEach(() => { process.env = { ...env }; });

  it("blocks when emergency stop", () => {
    const r = evaluateLiveSafety({
      liveArmedDb: true, emergencyStop: true, heartbeatOk: true,
      calendar: baseCal, accountSynced: true, reconciliationRequired: false,
      maxDailyLossWon: 1, maxOrderWon: 1, maxDailyOrders: 1,
    });
    assert.equal(r.allowLiveOrders, false);
    assert.ok(r.reasons.some((x) => /비상정지/.test(x)));
  });

  it("allows when all green", () => {
    const r = evaluateLiveSafety({
      liveArmedDb: true, emergencyStop: false, heartbeatOk: true,
      calendar: baseCal, accountSynced: true, reconciliationRequired: false,
      maxDailyLossWon: 1_000_000, maxOrderWon: 1_000_000, maxDailyOrders: 10,
    });
    assert.equal(r.allowLiveOrders, true);
  });
});
