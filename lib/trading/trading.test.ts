import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  canAuthenticate,
  requireTraderAuth,
  setAuthResolverForTests,
  AuthError,
} from "./guards";
import {
  DuplicateOrderError,
  applyPartialFill,
  placeOrderViaKis,
  previewOrder,
  resetTradingStoresForTests,
  validateLimitCashOrder,
} from "./orders";
import { isLiveTradingEnabled } from "../kis/config";
import { setAccountCashOverrideForTests } from "../kis/balance";

const ORIGINAL_ENV = { ...process.env };

function enableLiveTradingEnv(overrides: Record<string, string> = {}): void {
  process.env.KIS_LIVE_TRADING_ENABLED = "true";
  process.env.KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
  process.env.KIS_APP_KEY = "test-app-key";
  process.env.KIS_APP_SECRET = "test-app-secret";
  process.env.KIS_CANO = "12345678";
  process.env.KIS_ACNT_PRDT_CD = "01";
  process.env.KIS_MAX_ORDER_WON = "10000000";
  Object.assign(process.env, overrides);
}

function mockKisFetchSuccess(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        rt_cd: "0",
        output: { ODNO: "0000123456", KRX_FWDG_ORD_ORGNO: "00950" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
}

function mockOrderDeps(fetchImpl: typeof fetch = mockKisFetchSuccess()) {
  return {
    fetchImpl,
    getAccessToken: async () => "test-access-token",
    getBuyAvailability: async () => ({ ok: true, maxQty: 1000, maxAmt: 50_000_000 }),
  };
}

describe("trading guards and orders", () => {
  beforeEach(() => {
    resetTradingStoresForTests();
    setAuthResolverForTests(null);
    process.env = { ...ORIGINAL_ENV };
    setAccountCashOverrideForTests({
      ok: true,
      orderableCashWon: 50_000_000,
      depositWon: 50_000_000,
      totalEvaluationWon: 50_000_000,
      securitiesEvaluationWon: 0,
      evaluationPnlWon: 0,
      purchaseAmountWon: 0,
      netAssetWon: 50_000_000,
      source: "test",
      asOf: new Date().toISOString(),
    });
  });

  afterEach(() => {
    setAccountCashOverrideForTests(null);
    process.env = { ...ORIGINAL_ENV };
    setAuthResolverForTests(null);
    resetTradingStoresForTests();
  });

  it("canAuthenticate accepts trader/admin only", () => {
    assert.equal(canAuthenticate({ id: "u1", role: "trader" }), true);
    assert.equal(canAuthenticate({ id: "u2", role: "admin" }), true);
    assert.equal(canAuthenticate({ id: "u3", role: "viewer" }), false);
    assert.equal(canAuthenticate(null), false);
  });

  it("requireTraderAuth rejects unauthenticated requests", async () => {
    await assert.rejects(
      () => requireTraderAuth({ headers: { get: () => null } }),
      (error: unknown) => error instanceof AuthError,
    );
  });

  it("requireTraderAuth accepts injected trader via test resolver", async () => {
    setAuthResolverForTests(async () => ({ id: "trader-1", role: "trader" }));
    const user = await requireTraderAuth({ headers: { get: () => null } });
    assert.equal(user.id, "trader-1");
  });

  it("live disabled blocks preview and order placement", async () => {
    process.env.KIS_LIVE_TRADING_ENABLED = "false";
    const preview = previewOrder({
      symbol: "005930",
      side: "buy",
      quantity: 1,
      price: 70000,
      ordDvsn: "00",
    });
    assert.equal(preview.ok, false);
    if (!preview.ok) assert.match(preview.error, /disabled/i);

    await assert.rejects(
      () =>
        placeOrderViaKis(
          {
            symbol: "005930",
            side: "buy",
            quantity: 1,
            price: 70000,
            ordDvsn: "00",
            userId: "u1",
          },
          mockOrderDeps(),
        ),
      /disabled/i,
    );
    assert.equal(isLiveTradingEnabled(), false);
  });

  it("rejects paper KIS base URL even when flag is true", async () => {
    process.env.KIS_LIVE_TRADING_ENABLED = "true";
    process.env.KIS_BASE_URL = "https://openapivts.koreainvestment.com:29443";
    assert.equal(isLiveTradingEnabled(), false);
  });

  it("blocks duplicate idempotency keys", async () => {
    enableLiveTradingEnv();
    const fetchImpl = mockKisFetchSuccess();
    const input = {
      symbol: "005930",
      side: "buy" as const,
      quantity: 1,
      price: 70000,
      ordDvsn: "00" as const,
      userId: "u1",
      idempotencyKey: "dup-key-1",
    };

    const first = await placeOrderViaKis(input, mockOrderDeps(fetchImpl));
    assert.equal(first.status, "accepted");

    await assert.rejects(
      () => placeOrderViaKis(input, mockOrderDeps(fetchImpl)),
      (error: unknown) => error instanceof DuplicateOrderError,
    );
  });

  it("rejects orders exceeding max order won", () => {
    enableLiveTradingEnv({ KIS_MAX_ORDER_WON: "50000" });
    const result = validateLimitCashOrder({
      symbol: "005930",
      side: "buy",
      quantity: 10,
      price: 20000,
      ordDvsn: "00",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "MAX_ORDER_WON");
  });

  it("rejects non-limit ord_dvsn and short quantity", () => {
    enableLiveTradingEnv();
    const badDvsn = validateLimitCashOrder({
      symbol: "005930",
      side: "buy",
      quantity: 1,
      price: 1000,
      ordDvsn: "01" as "00",
    });
    assert.equal(badDvsn.ok, false);

    const badQty = validateLimitCashOrder({
      symbol: "005930",
      side: "buy",
      quantity: 0,
      price: 1000,
      ordDvsn: "00",
    });
    assert.equal(badQty.ok, false);
  });

  it("records partial fill quantity only", async () => {
    enableLiveTradingEnv();
    const order = await placeOrderViaKis(
      {
        symbol: "005930",
        side: "buy",
        quantity: 10,
        price: 70000,
        ordDvsn: "00",
        userId: "u1",
        idempotencyKey: "partial-1",
      },
      mockOrderDeps(),
    );

    const updated = applyPartialFill(order.id, 4);
    assert.ok(updated);
    assert.equal(updated!.filledQuantity, 4);
    assert.equal(updated!.status, "partially_filled");

    const filled = applyPartialFill(order.id, 10);
    assert.equal(filled!.filledQuantity, 10);
    assert.equal(filled!.status, "filled");
  });

  it("placeOrderViaKis uses mock fetch and never requires real network when enabled", async () => {
    enableLiveTradingEnv();
    let fetchCalled = false;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      fetchCalled = true;
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-access-token");
      assert.equal(headers.get("appkey"), "test-app-key");
      assert.equal(headers.get("appsecret"), "test-app-secret");
      assert.equal(headers.get("tr_id"), "TTTC0011U");
      return new Response(JSON.stringify({ rt_cd: "0", output: { ODNO: "99" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const order = await placeOrderViaKis(
      {
        symbol: "000660",
        side: "sell",
        quantity: 2,
        price: 150000,
        ordDvsn: "06",
        userId: "u1",
        idempotencyKey: "mock-fetch-1",
      },
      mockOrderDeps(fetchImpl),
    );

    assert.equal(fetchCalled, true);
    assert.equal(order.side, "sell");
    assert.equal(order.ordDvsn, "06");
  });

  it("blocks live buy when KIS says max buy quantity is zero", async () => {
    enableLiveTradingEnv();
    await assert.rejects(
      () =>
        placeOrderViaKis(
          {
            symbol: "005930",
            side: "buy",
            quantity: 1,
            price: 70000,
            ordDvsn: "00",
            userId: "u1",
            idempotencyKey: "cash-zero",
          },
          {
            ...mockOrderDeps(),
            getBuyAvailability: async () => ({ ok: true, maxQty: 0, maxAmt: 0 }),
          },
        ),
      /0주/,
    );
  });

  it("caps buy quantity to KIS no-margin max before submitting", async () => {
    enableLiveTradingEnv();
    let submittedQty = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      submittedQty = String(JSON.parse(String(init?.body)).ORD_QTY);
      return new Response(
        JSON.stringify({ rt_cd: "0", output: { ODNO: "100", KRX_FWDG_ORD_ORGNO: "001" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const order = await placeOrderViaKis(
      {
        symbol: "005930",
        side: "buy",
        quantity: 10,
        price: 70_000,
        ordDvsn: "00",
        userId: "u1",
        idempotencyKey: "cap-to-kis-max",
      },
      {
        ...mockOrderDeps(fetchImpl),
        getBuyAvailability: async () => ({ ok: true, maxQty: 3, maxAmt: 210_000 }),
      },
    );

    assert.equal(submittedQty, "3");
    assert.equal(order.quantity, 3);
    assert.equal(order.requestedQuantity, 10);
  });

  it("auto max-affordable mode ignores strategy quantity and uses KIS cash max", async () => {
    enableLiveTradingEnv();
    let submittedQty = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      submittedQty = String(JSON.parse(String(init?.body)).ORD_QTY);
      return new Response(
        JSON.stringify({ rt_cd: "0", output: { ODNO: "101", KRX_FWDG_ORD_ORGNO: "001" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const order = await placeOrderViaKis(
      {
        symbol: "005930",
        side: "buy",
        quantity: 2,
        price: 70_000,
        ordDvsn: "00",
        userId: "auto-trader",
        idempotencyKey: "use-kis-cash-max",
        useMaxAffordableQuantity: true,
      },
      {
        ...mockOrderDeps(fetchImpl),
        getBuyAvailability: async () => ({ ok: true, maxQty: 5, maxAmt: 350_000 }),
      },
    );

    assert.equal(submittedQty, "5");
    assert.equal(order.quantity, 5);
    assert.equal(order.requestedQuantity, 2);
  });

  it("full-cash mode uses the entire KIS no-margin quantity even above the app buy cap", async () => {
    enableLiveTradingEnv({ KIS_MAX_ORDER_WON: "50000" });
    let submittedQty = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      submittedQty = String(JSON.parse(String(init?.body)).ORD_QTY);
      return new Response(
        JSON.stringify({ rt_cd: "0", output: { ODNO: "102", KRX_FWDG_ORD_ORGNO: "001" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const order = await placeOrderViaKis(
      {
        symbol: "005930",
        side: "buy",
        quantity: 1,
        price: 70_000,
        ordDvsn: "00",
        userId: "auto-trader",
        idempotencyKey: "all-cash",
        useAllAvailableCash: true,
      },
      {
        ...mockOrderDeps(fetchImpl),
        getBuyAvailability: async () => ({ ok: true, maxQty: 5, maxAmt: 350_000 }),
      },
    );

    assert.equal(submittedQty, "5");
    assert.equal(order.quantity, 5);
    assert.equal(order.requestedQuantity, undefined);
  });

  it("full-sell mode ignores memory quantity and submits the KIS sellable quantity", async () => {
    enableLiveTradingEnv();
    let submittedQty = "";
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      submittedQty = String(JSON.parse(String(init?.body)).ORD_QTY);
      return new Response(
        JSON.stringify({ rt_cd: "0", output: { ODNO: "103", KRX_FWDG_ORD_ORGNO: "001" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const order = await placeOrderViaKis(
      {
        symbol: "007660",
        side: "sell",
        quantity: 1,
        price: 112_800,
        ordDvsn: "00",
        userId: "auto-trader",
        idempotencyKey: "all-sellable",
        useAllSellableQuantity: true,
      },
      {
        ...mockOrderDeps(fetchImpl),
        getHoldings: async () => ({
          ok: true,
          holdings: [{
            ticker: "007660",
            name: "이수페타시스",
            heldQty: 5,
            sellableQty: 4,
            averagePrice: 111_900,
            currentPrice: 112_800,
          }],
        }),
      },
    );

    assert.equal(submittedQty, "4");
    assert.equal(order.quantity, 4);
  });

});
